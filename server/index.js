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
import {
  listNotebooks,
  getNotebook,
  createNotebook,
  updateNotebook,
  deleteNotebook,
  addNotebookDocument,
  removeNotebookDocument,
  queryNotebook
} from "./notebooks.js";
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

app.get("/api/status", async (_request, response) => {
  try {
    const models = await listModels();
    response.json({
      ok: true,
      ollamaUrl: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      models: models.models?.map((model) => model.name) ?? []
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
        writeHeadOnce();
        response.write(chunk);
      }
    });
    writeHeadOnce();
    response.end();
  } catch (error) {
    writeHeadOnce();
    response.write(`\n\n[오류] ${error.message}`);
    response.end();
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
});
