import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.js";
import { addDocument, getDocument, listDocuments, removeDocument } from "./documentStore.js";
import { serializeDocumentForClient as serializeClientDocument } from "./documents.js";
import { normalizeUploadFileName as repairUploadFileName } from "../public/textRepair.js";
import { DEFAULT_MODEL, OLLAMA_URL, generateFollowupSuggestions, generateVisualizationSpec, listModels, streamChat } from "./ollama.js";
import { parseUpload } from "./parsers.js";
import { analyzeDocument } from "./documentAnalysis.js";
import { classifyIntent } from "./calendarAgent.js";
import { getKoreanHolidays } from "./holidays.js";
import { createAbortError } from "./abort.js";
import { getQdrantHealth } from "./indexes/qdrantVectorIndex.js";
import { getSqliteFtsHealth } from "./indexes/sqliteFtsIndex.js";
import { getModelQueueStats } from "./modelQueue.js";
import { createRateLimiter, getRateLimitConfig, rateLimitDefaults } from "./rateLimit.js";
import { resolvedDepartmentBackend } from "./rag/ragConfig.js";
import {
  listNotebooks,
  getNotebook,
  createNotebook,
  updateNotebook,
  deleteNotebook,
  addNotebookDocument,
  removeNotebookDocument
} from "./notebooks.js";
import {
  createNotebookIngestJob,
  getNotebookIngestJob,
  listNotebookIngestJobs,
  recoverNotebookIngestJobs,
  retryNotebookIngestJob
} from "./ingest/notebookIngestJobs.js";
import { isAdminConfigured, requireAdmin } from "./auth.js";

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadDir = path.join(rootDir, "uploads");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || undefined;

const app = express();
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 40 * 1024 * 1024)
  }
});

app.use(express.json({ limit: process.env.MAX_JSON_BYTES || "80mb" }));
app.use(express.static(publicDir));

function extractPersonalization(body) {
  return body.personalization && typeof body.personalization === "object" ? body.personalization : {};
}

function collectRagStatus({ models = null } = {}) {
  const backend = resolvedDepartmentBackend();
  return Promise.all([
    models ? Promise.resolve(models) : listModels().catch((error) => ({ error: error.message, models: [] })),
    getQdrantHealth().catch((error) => ({ configured: true, ok: false, error: error.message })),
    backend.lexical === "sqlite"
      ? getSqliteFtsHealth().catch((error) => ({ configured: true, ok: false, error: error.message }))
      : Promise.resolve({ configured: false, ok: false, reason: "sqlite_fts_not_enabled" })
  ]).then(([modelList, qdrant, sqlite]) => ({
    backend,
    qdrant,
    sqlite,
    queues: getModelQueueStats(),
    rateLimits: getRateLimitConfig(),
    models: modelList.models?.map((model) => model.name) ?? [],
    modelError: modelList.error || null
  }));
}

app.use("/api/chat", createRateLimiter({ name: "chat", keyPrefix: "chat:", ...rateLimitDefaults.chat }));
app.use("/api/visualize", createRateLimiter({ name: "visualize", keyPrefix: "visualize:", ...rateLimitDefaults.visualize }));
app.use("/api/upload", createRateLimiter({ name: "upload", keyPrefix: "upload:", ...rateLimitDefaults.upload }));
app.use("/api/followups", createRateLimiter({ name: "followups", keyPrefix: "followups:", ...rateLimitDefaults.lightweight }));
app.use("/api/agent/intent", createRateLimiter({ name: "calendar_intent", keyPrefix: "intent:", ...rateLimitDefaults.lightweight }));
app.use(
  ["/api/notebooks", "/api/admin/verify"],
  createRateLimiter({
    name: "admin_write",
    keyPrefix: "admin:",
    ...rateLimitDefaults.adminWrite,
    skip: (request) => request.method === "GET"
  })
);

app.get("/api/status", async (_request, response) => {
  try {
    const models = await listModels();
    const ragStatus = await collectRagStatus({ models });
    response.json({
      ok: true,
      ollamaUrl: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      models: models.models?.map((model) => model.name) ?? [],
      rag: {
        department: {
          backend: ragStatus.backend,
          qdrant: ragStatus.qdrant,
          sqlite: ragStatus.sqlite
        }
      },
      queues: ragStatus.queues,
      rateLimits: ragStatus.rateLimits
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      ollamaUrl: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      error: error.message
    });
  }
});

app.get("/api/documents", (_request, response) => {
  response.json({ documents: listDocuments() });
});

app.get("/api/holidays", async (request, response) => {
  try {
    const year = request.query.year || new Date().getFullYear();
    const result = await getKoreanHolidays(year);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message, holidays: [] });
  }
});

app.get("/api/documents/:id", (request, response) => {
  const document = getDocument(request.params.id);
  if (!document) {
    response.status(404).json({ error: "문서를 찾을 수 없습니다." });
    return;
  }
  response.json({ document: serializeClientDocument(document) });
});

app.post("/api/upload", upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "업로드된 파일이 없습니다." });
    return;
  }

  try {
    request.file.originalname = repairUploadFileName(request.file.originalname);
    const parsed = await parseUpload(request.file);
    if (parsed.kind === "document") {
      const analysis = await analyzeDocument(parsed).catch(() => ({ summary: "", topics: [] }));
      parsed.summary = analysis.summary;
      parsed.topics = analysis.topics;
    }
    const summary = addDocument(parsed);
    response.json({ document: serializeClientDocument(getDocument(summary.id)) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  } finally {
    await fs.unlink(request.file.path).catch(() => {});
  }
});

app.delete("/api/documents/:id", (request, response) => {
  const removed = removeDocument(request.params.id);
  response.json({ removed });
});

function createRequestAbortController(request, response) {
  const controller = new AbortController();
  const abort = (message) => {
    if (!controller.signal.aborted) controller.abort(createAbortError(message));
  };

  const handleRequestAborted = () => abort("Client aborted the chat request.");
  const handleResponseClosed = () => {
    if (!response.writableEnded) abort("Client disconnected before the chat response completed.");
  };

  request.on("aborted", handleRequestAborted);
  response.on("close", handleResponseClosed);

  return {
    signal: controller.signal,
    cleanup() {
      request.off("aborted", handleRequestAborted);
      response.off("close", handleResponseClosed);
    }
  };
}

app.post("/api/chat", async (request, response) => {
  const messages = Array.isArray(request.body.messages) ? request.body.messages : [];
  const documents = Array.isArray(request.body.documents) ? request.body.documents : [];
  const model = request.body.model || DEFAULT_MODEL;
  const personalization = extractPersonalization(request.body);
  const notebookId = typeof request.body.notebookId === "string" && request.body.notebookId
    ? request.body.notebookId
    : null;
  const mode = request.body.mode === "map_reduce" ? "map_reduce" : "chat";

  if (!messages.length) {
    response.status(400).json({ error: "messages가 비어 있습니다." });
    return;
  }

  const chatAbort = createRequestAbortController(request, response);
  const signal = chatAbort.signal;
  let pendingMeta = null;
  const writeHeadOnce = () => {
    if (response.headersSent) return;
    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    };
    if (pendingMeta) {
      const encoded = Buffer.from(JSON.stringify(pendingMeta), "utf8").toString("base64");
      headers["X-Notebook-Meta"] = encoded;
      headers["Access-Control-Expose-Headers"] = "X-Notebook-Meta";
    }
    response.writeHead(200, headers);
  };

  try {
    await streamChat({
      messages,
      documents,
      model,
      personalization,
      notebookId,
      mode,
      signal,
      onMeta: (meta) => {
        if (meta && (meta.notebook || (meta.citations && meta.citations.length) || meta.analysisMode)) {
          pendingMeta = {
            notebook: meta.notebook,
            analysisMode: meta.analysisMode || null,
            citations: (meta.citations || []).map((chunk) => ({
              citationId: chunk.citationId,
              documentId: chunk.documentId,
              documentName: chunk.documentName,
              documentType: chunk.documentType,
              locator: chunk.locator
            }))
          };
        }
      },
      onChunk: (chunk) => {
        if (signal.aborted || response.destroyed) return;
        writeHeadOnce();
        response.write(chunk);
      }
    });
    if (signal.aborted || response.destroyed) return;
    writeHeadOnce();
    response.end();
  } catch (error) {
    if (signal.aborted || response.destroyed) return;
    writeHeadOnce();
    response.write(`\n\n[오류] ${error.message}`);
    response.end();
  } finally {
    chatAbort.cleanup();
  }
});

app.post("/api/visualize", async (request, response) => {
  const messages = Array.isArray(request.body.messages) ? request.body.messages : [];
  const documents = Array.isArray(request.body.documents) ? request.body.documents : [];
  const model = request.body.model || DEFAULT_MODEL;
  const prompt = request.body.prompt || messages.findLast?.((message) => message.role !== "assistant")?.content || "";
  const personalization = extractPersonalization(request.body);

  if (!String(prompt).trim()) {
    response.status(400).json({ error: "prompt is required." });
    return;
  }

  try {
    const visualization = await generateVisualizationSpec({
      prompt,
      messages,
      documents,
      model,
      personalization
    });
    response.json({ visualization });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/followups", async (request, response) => {
  const messages = Array.isArray(request.body.messages) ? request.body.messages : [];
  const model = request.body.model || DEFAULT_MODEL;
  const personalization = extractPersonalization(request.body);

  if (!messages.length) {
    response.status(400).json({ error: "messages가 비어 있습니다." });
    return;
  }

  try {
    const suggestions = await generateFollowupSuggestions({ messages, model, personalization });
    response.json({ suggestions });
  } catch (error) {
    response.status(500).json({ error: error.message, suggestions: [] });
  }
});

app.post("/api/agent/intent", async (request, response) => {
  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt : "";
  const model = request.body?.model || DEFAULT_MODEL;
  const currentDate = typeof request.body?.currentDate === "string" ? request.body.currentDate : new Date().toISOString();
  const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
  const pendingAction = request.body?.pendingAction && typeof request.body.pendingAction === "object"
    ? request.body.pendingAction
    : null;

  if (!prompt.trim()) {
    response.json({ intent: "chat", payload: {} });
    return;
  }

  try {
    const result = await classifyIntent({ prompt, model, currentDate, messages, pendingAction });
    response.json(result);
  } catch (error) {
    response.json({ intent: "chat", payload: {}, fallbackReason: `server_error: ${error.message}` });
  }
});

app.get("/api/admin/status", (_request, response) => {
  response.json({ configured: isAdminConfigured() });
});

app.post("/api/admin/verify", requireAdmin, (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/notebooks", async (_request, response) => {
  try {
    const notebooks = await listNotebooks();
    response.json({ notebooks });
  } catch (error) {
    response.status(500).json({ error: error.message, notebooks: [] });
  }
});

app.get("/api/notebooks/:id", async (request, response) => {
  try {
    const notebook = await getNotebook(request.params.id);
    if (!notebook) {
      response.status(404).json({ error: "노트북을 찾을 수 없습니다." });
      return;
    }
    response.json({ notebook });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/notebooks", requireAdmin, async (request, response) => {
  try {
    const created = await createNotebook({
      name: request.body?.name,
      description: request.body?.description
    });
    response.status(201).json({ notebook: created });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/notebooks/:id", requireAdmin, async (request, response) => {
  try {
    const updated = await updateNotebook(request.params.id, {
      name: request.body?.name,
      description: request.body?.description
    });
    if (!updated) {
      response.status(404).json({ error: "노트북을 찾을 수 없습니다." });
      return;
    }
    response.json({ notebook: updated });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.delete("/api/notebooks/:id", requireAdmin, async (request, response) => {
  try {
    const removed = await deleteNotebook(request.params.id);
    response.json({ removed });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/notebooks/:id/documents", requireAdmin, upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "업로드된 파일이 없습니다." });
    return;
  }
  try {
    request.file.originalname = repairUploadFileName(request.file.originalname);
    const parsed = await parseUpload(request.file);
    const summary = await addNotebookDocument(request.params.id, parsed);
    response.status(201).json({ document: summary });
  } catch (error) {
    response.status(400).json({ error: error.message });
  } finally {
    await fs.unlink(request.file.path).catch(() => {});
  }
});

app.get("/api/admin/rag/status", requireAdmin, async (_request, response) => {
  try {
    const ragStatus = await collectRagStatus();
    response.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      ...ragStatus
    });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/notebooks/:id/ingest-jobs", requireAdmin, async (request, response) => {
  try {
    const jobs = await listNotebookIngestJobs(request.params.id);
    response.json({ jobs });
  } catch (error) {
    response.status(500).json({ error: error.message, jobs: [] });
  }
});

app.get("/api/notebooks/:id/ingest-jobs/:jobId", requireAdmin, async (request, response) => {
  try {
    const job = await getNotebookIngestJob(request.params.id, request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Ingest job not found." });
      return;
    }
    response.json({ job });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/notebooks/:id/ingest-jobs", requireAdmin, upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "업로드된 파일이 없습니다." });
    return;
  }
  try {
    request.file.originalname = repairUploadFileName(request.file.originalname);
    const job = await createNotebookIngestJob(request.params.id, request.file);
    response.status(202).json({ job });
  } catch (error) {
    await fs.unlink(request.file.path).catch(() => {});
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/notebooks/:id/ingest-jobs/:jobId/retry", requireAdmin, async (request, response) => {
  try {
    const job = await retryNotebookIngestJob(request.params.id, request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Ingest job not found." });
      return;
    }
    response.status(202).json({ job });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.delete("/api/notebooks/:id/documents/:documentId", requireAdmin, async (request, response) => {
  try {
    const removed = await removeNotebookDocument(request.params.id, request.params.documentId);
    if (!removed) {
      response.status(404).json({ error: "문서를 찾을 수 없습니다." });
      return;
    }
    response.json({ removed: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.use((_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, host, () => {
  const displayHost = host || "0.0.0.0";
  console.log(`myAI listening on http://${displayHost}:${port}`);
  recoverNotebookIngestJobs()
    .then(({ recovered, failed }) => {
      if (recovered.length || failed.length) {
        console.log(`[ingest] recovered=${recovered.length} failed=${failed.length}`);
      }
    })
    .catch((error) => {
      console.warn(`[ingest] recovery failed: ${error.message}`);
    });
});
