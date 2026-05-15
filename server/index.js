import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.js";
import { addDocument, getCachedDocumentUnsafe, getDocument, removeDocument } from "./documentStore.js";
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
import { getRerankHealth, getRerankConfig } from "./reranker.js";
import { createRateLimiter, getRateLimitConfig, rateLimitDefaults } from "./rateLimit.js";
import { resolvedDepartmentBackend } from "./rag/ragConfig.js";
import { isNaverSearchConfigured, isNaverSearchEnabled } from "./naverSearch.js";
import { createExportFile, listExportFormats } from "./exportFiles.js";
import { generateMindmap } from "./mindmap.js";
import { lawApiRouter } from "./law/lawApi.js";
import { getLawConfig, getLawRateLimitDefaults } from "./law/lawConfig.js";
import {
  listNotebooks,
  getNotebook,
  createNotebook,
  updateNotebook,
  updateNotebookAccess,
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
import { isAdminConfigured, isAdminRequest, requireAdmin } from "./auth.js";
import { ragEvalRouter } from "./ragEvalApi.js";
import { graphAdminRouter } from "./graphAdminApi.js";
import { graphStudioRouter } from "./graphStudioApi.js";
import { studioDocumentRouter } from "./studioDocument/studioDocumentApi.js";
import { generatedSourceRouter } from "./sourceWorkflow/generatedSourceApi.js";
import { buildSourceGuide } from "./sourceWorkflow/sourceGuide.js";
import {
  createSourcePromotionRequest,
  listSourcePromotions,
  reviewSourcePromotion
} from "./sourceWorkflow/sourcePromotions.js";
import { statsApiRouter } from "./stats/statsApi.js";
import { logUsageEvent } from "./stats/statsLogger.js";
import {
  canAccessNotebook,
  getAccessConfiguration,
  getAccessFromRequest,
  getAccessLoginOptions,
  isAccessControlConfigured,
  loginAccess,
  createAccessGroup,
  updateAccessGroup,
  deleteAccessGroup,
  setGroupLevelPassword,
  clearGroupLevelPassword,
  updateGroupLevel,
  setSuperPassword,
  updateSuperAccess,
  normalizeNotebookAccessPolicy,
  redactNotebookAccessForClient,
  requireNotebookAccess
} from "./accessControl.js";

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadDir = path.join(rootDir, "uploads");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || undefined;
const httpsKeyPath = process.env.HTTPS_KEY_PATH || "";
const httpsCertPath = process.env.HTTPS_CERT_PATH || "";
const httpsCaPath = process.env.HTTPS_CA_PATH || "";

function loadHttpsOptions() {
  if (!httpsKeyPath || !httpsCertPath) return null;
  try {
    const options = {
      key: readFileSync(httpsKeyPath),
      cert: readFileSync(httpsCertPath)
    };
    if (httpsCaPath) options.ca = readFileSync(httpsCaPath);
    return options;
  } catch (error) {
    console.error(`[https] failed to load certificate (${error.code || error.name}): ${error.message}`);
    console.error(`[https] HTTPS_KEY_PATH=${httpsKeyPath}`);
    console.error(`[https] HTTPS_CERT_PATH=${httpsCertPath}`);
    process.exit(1);
  }
}

const app = express();
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== false) app.set("trust proxy", trustProxy);
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

function extractDocumentOwnerKey(request) {
  return String(request.get("x-myai-document-key") || "").trim();
}

function parseTrustProxy(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "false" || text === "0") return false;
  if (text.toLowerCase() === "true") return true;
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

function contentDisposition(filename) {
  const fallback = String(filename || "myai-export")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename || "myai-export").replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function collectRagStatus({ models = null } = {}) {
  const backend = resolvedDepartmentBackend();
  const rerankEnabled = getRerankConfig().enabled;
  return Promise.all([
    models ? Promise.resolve(models) : listModels().catch((error) => ({ error: error.message, models: [] })),
    getQdrantHealth().catch((error) => ({ configured: true, ok: false, error: error.message })),
    backend.lexical === "sqlite"
      ? getSqliteFtsHealth().catch((error) => ({ configured: true, ok: false, error: error.message }))
      : Promise.resolve({ configured: false, ok: false, reason: "sqlite_fts_not_enabled" }),
    rerankEnabled
      ? getRerankHealth().catch((error) => ({ enabled: true, ok: false, error: error.message }))
      : Promise.resolve({ enabled: false, ok: false, reason: "reranker_disabled" })
  ]).then(([modelList, qdrant, sqlite, reranker]) => ({
    backend,
    qdrant,
    sqlite,
    reranker,
    queues: getModelQueueStats(),
    rateLimits: getRateLimitConfig(),
    models: modelList.models?.map((model) => model.name) ?? [],
    modelError: modelList.error || null
  }));
}

app.use("/api/chat", createRateLimiter({ name: "chat", keyPrefix: "chat:", ...rateLimitDefaults.chat }));
app.use("/api/visualize", createRateLimiter({ name: "visualize", keyPrefix: "visualize:", ...rateLimitDefaults.visualize }));
app.use("/api/upload", createRateLimiter({ name: "upload", keyPrefix: "upload:", ...rateLimitDefaults.upload }));
app.use("/api/export", createRateLimiter({ name: "export", keyPrefix: "export:", ...rateLimitDefaults.lightweight }));
app.use("/api/source-workflow", createRateLimiter({ name: "source_workflow", keyPrefix: "source_workflow:", ...rateLimitDefaults.lightweight }));
app.use("/api/studio/mindmap", createRateLimiter({ name: "studio_mindmap", keyPrefix: "studio_mindmap:", ...rateLimitDefaults.chat }));
app.use("/api/studio/document", createRateLimiter({ name: "studio_document", keyPrefix: "studio_document:", ...rateLimitDefaults.chat }));
app.use("/api/followups", createRateLimiter({ name: "followups", keyPrefix: "followups:", ...rateLimitDefaults.lightweight }));
app.use("/api/agent/intent", createRateLimiter({ name: "calendar_intent", keyPrefix: "intent:", ...rateLimitDefaults.lightweight }));
app.use(
  ["/api/notebooks", "/api/admin/verify", "/api/admin/access"],
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
          sqlite: ragStatus.sqlite,
          reranker: ragStatus.reranker
        }
      },
      search: {
        naver: {
          enabled: isNaverSearchEnabled(),
          configured: isNaverSearchConfigured()
        },
        law: {
          enabled: getLawConfig().enabled,
          configured: getLawConfig().configured
        }
      },
      queues: ragStatus.queues,
      rateLimits: {
        ...ragStatus.rateLimits,
        law: getLawRateLimitDefaults()
      }
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
  response.status(404).json({ error: "Runtime document listing is disabled." });
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

app.get("/api/export/formats", (_request, response) => {
  response.json({ formats: listExportFormats() });
});

app.post("/api/export", async (request, response) => {
  try {
    const { format, title, content } = request.body || {};
    const file = await createExportFile({ format, title, content });
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Length", file.buffer.length);
    response.setHeader("Content-Disposition", contentDisposition(file.filename));
    response.send(file.buffer);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/studio/mindmap", async (request, response) => {
  const documents = Array.isArray(request.body.documents) ? request.body.documents : [];
  const model = request.body.model || DEFAULT_MODEL;
  const studioAbort = createRequestAbortController(request, response);
  try {
    const mindmap = await generateMindmap({
      documents,
      model,
      signal: studioAbort.signal
    });
    if (studioAbort.signal.aborted || response.destroyed) return;
    response.json({ mindmap });
  } catch (error) {
    if (studioAbort.signal.aborted || response.destroyed) return;
    const status = error.statusCode || (/requires at least one uploaded document/i.test(error.message) ? 400 : 500);
    response.status(status).json({ error: error.message });
  } finally {
    studioAbort.cleanup();
  }
});

app.get("/api/documents/:id", (request, response) => {
  const document = getDocument(request.params.id, { ownerKey: extractDocumentOwnerKey(request) });
  if (!document) {
    response.status(404).json({ error: "臾몄꽌瑜?李얠쓣 ???놁뒿?덈떎." });
    return;
  }
  response.json({ document: serializeClientDocument(document) });
});

app.post("/api/upload", upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "?낅줈?쒕맂 ?뚯씪???놁뒿?덈떎." });
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
    const ownerKey = extractDocumentOwnerKey(request);
    const summary = addDocument(parsed, { ownerKey });
    response.json({ document: serializeClientDocument(getCachedDocumentUnsafe(summary.id)) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  } finally {
    await fs.unlink(request.file.path).catch(() => {});
  }
});

app.delete("/api/documents/:id", (request, response) => {
  const removed = removeDocument(request.params.id, { ownerKey: extractDocumentOwnerKey(request) });
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
  const lawSearchMode = Boolean(request.body.lawSearchMode);
  const mode = request.body.mode === "map_reduce" && !lawSearchMode ? "map_reduce" : "chat";

  if (!messages.length) {
    response.status(400).json({ error: "messages媛 鍮꾩뼱 ?덉뒿?덈떎." });
    return;
  }

  if (notebookId && await isAccessControlConfigured()) {
    const notebook = await getNotebook(notebookId);
    if (!notebook) {
      response.status(404).json({ error: "?명듃遺곸쓣 李얠쓣 ???놁뒿?덈떎." });
      return;
    }
    const access = await requireNotebookAccess(request, response, notebook);
    if (!access) return;
  }

  const chatAbort = createRequestAbortController(request, response);
  const signal = chatAbort.signal;
  const chatStart = Date.now();
  let pendingMeta = null;
  let chatErrored = false;
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
      lawSearchMode,
      signal,
      onMeta: (meta) => {
        if (meta && (
          meta.notebook ||
          (meta.citations && meta.citations.length) ||
          (meta.webSearch?.citations && meta.webSearch.citations.length) ||
          meta.webSearch?.error ||
          meta.law ||
          meta.compliance ||
          meta.analysisMode
        )) {
          pendingMeta = {
            notebook: meta.notebook,
            analysisMode: meta.analysisMode || null,
            citations: (meta.citations || []).map((chunk) => ({
              citationId: chunk.citationId,
              sourceType: "notebook",
              documentId: chunk.documentId,
              documentName: chunk.documentName,
              documentType: chunk.documentType,
              locator: chunk.locator
            })),
            webSearch: meta.webSearch
              ? {
                  ok: Boolean(meta.webSearch.ok),
                  query: meta.webSearch.query || "",
                  error: meta.webSearch.error || "",
                  citations: (meta.webSearch.citations || []).map((item) => ({
                    citationId: item.citationId,
                    sourceType: item.sourceType || "naver",
                    documentName: item.documentName,
                    documentType: item.documentType,
                    locator: item.locator,
                    url: item.url,
                    sourceName: item.sourceName
                  }))
                }
              : null,
            law: meta.law
              ? {
                  ok: Boolean(meta.law.ok),
                  query: meta.law.query || "",
                  mode: meta.law.mode || "none",
                  error: meta.law.error || "",
                  errorMessage: meta.law.errorMessage || "",
                  disclaimer: meta.law.disclaimer || null,
                  citations: (meta.law.citations || []).map((item) => ({
                    citationId: item.citationId,
                    sourceType: item.sourceType || "law",
                    recordType: item.recordType || (item.sourceType === "law" ? "statute" : item.sourceType?.replace("law_", "")) || "statute",
                    lawName: item.lawName,
                    lawId: item.lawId,
                    mst: item.mst,
                    article: item.article,
                    canonical: item.canonical,
                    title: item.title,
                    documentName: item.lawName || item.title || item.documentName,
                    documentType: "law",
                    locator: item.locator,
                    effectiveDate: item.effectiveDate,
                    url: item.url,
                    excerpt: item.excerpt,
                    excerptTruncated: item.excerptTruncated,
                    excerptLength: item.excerptLength,
                    caseNumber: item.caseNumber,
                    court: item.court,
                    date: item.date,
                    caseType: item.caseType,
                    agency: item.agency,
                    kind: item.kind,
                    issueDate: item.issueDate,
                    region: item.region,
                    promulgationDate: item.promulgationDate
                  })),
                  verification: meta.law.verification || { checked: false, failCount: 0, results: [] }
                }
              : null,
            compliance: meta.compliance
              ? {
                  ok: Boolean(meta.compliance.ok),
                  mode: meta.compliance.mode || "department_legal_review",
                  reviewType: meta.compliance.reviewType || "general",
                  outputStyle: meta.compliance.outputStyle || "summary",
                  title: meta.compliance.title || "Compliance Review",
                  disclaimer: meta.compliance.disclaimer || "short",
                  evidenceFamilies: Array.isArray(meta.compliance.evidenceFamilies)
                    ? meta.compliance.evidenceFamilies.map((item) => String(item || "").slice(0, 40)).filter(Boolean)
                    : [],
                  error: meta.compliance.error || ""
                }
              : null
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
    chatErrored = true;
    if (signal.aborted || response.destroyed) return;
    writeHeadOnce();
    response.write(`\n\n[?ㅻ쪟] ${error.message}`);
    response.end();
  } finally {
    if (!signal.aborted) {
      logUsageEvent({
        rawToken: String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim() || null,
        eventType: "chat_query",
        endpoint: "/api/chat",
        notebookId: notebookId || null,
        features: {
          rag: Boolean(notebookId),
          law: Boolean(pendingMeta?.law?.ok),
          compliance: Boolean(pendingMeta?.compliance?.ok),
          kg: false,
          calendar: false,
          documentStudio: false
        },
        model,
        latencyMs: Date.now() - chatStart,
        success: !chatErrored
      });
    }
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
    response.status(400).json({ error: "messages媛 鍮꾩뼱 ?덉뒿?덈떎." });
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

app.get("/api/access/options", async (_request, response) => {
  try {
    response.json(await getAccessLoginOptions());
  } catch (error) {
    response.status(500).json({ error: error.message, groups: [], super: { enabled: false } });
  }
});

app.get("/api/access/status", async (request, response) => {
  try {
    const access = await getAccessFromRequest(request);
    response.json({
      configured: await isAccessControlConfigured(),
      authenticated: Boolean(access),
      access
    });
  } catch (error) {
    response.status(500).json({ error: error.message, authenticated: false, access: null });
  }
});

app.post("/api/access/login", async (request, response) => {
  try {
    const result = await loginAccess(request.body || {});
    if (!result) {
      response.status(401).json({ ok: false, error: "Access authentication failed." });
      return;
    }
    response.json({ ok: true, ...result });
    logUsageEvent({
      groupId: result.access?.groupId || "anon",
      level: result.access?.level != null ? `L${result.access.level}` : "anon",
      eventType: "login",
      endpoint: "/api/access/login",
      success: true
    });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/access/logout", (_request, response) => {
  response.json({ ok: true });
  logUsageEvent({ eventType: "logout", endpoint: "/api/access/logout", success: true });
});

app.get("/api/admin/access/groups", requireAdmin, async (_request, response) => {
  try {
    response.json(await getAccessConfiguration());
  } catch (error) {
    response.status(500).json({ error: error.message, groups: [] });
  }
});

app.post("/api/admin/access/groups", requireAdmin, async (request, response) => {
  try {
    const group = await createAccessGroup(request.body || {});
    response.status(201).json({ group });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/access/groups/:groupId", requireAdmin, async (request, response) => {
  try {
    const group = await updateAccessGroup(request.params.groupId, request.body || {});
    if (!group) {
      response.status(404).json({ error: "Access group not found." });
      return;
    }
    response.json({ group });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.delete("/api/admin/access/groups/:groupId", requireAdmin, async (request, response) => {
  try {
    response.json({ removed: await deleteAccessGroup(request.params.groupId) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/access/groups/:groupId/levels/:level/password", requireAdmin, async (request, response) => {
  try {
    const group = await setGroupLevelPassword(request.params.groupId, request.params.level, request.body?.password);
    if (!group) {
      response.status(404).json({ error: "Access group not found." });
      return;
    }
    response.json({ group });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.delete("/api/admin/access/groups/:groupId/levels/:level/password", requireAdmin, async (request, response) => {
  try {
    const group = await clearGroupLevelPassword(request.params.groupId, request.params.level);
    if (!group) {
      response.status(404).json({ error: "Access group not found." });
      return;
    }
    response.json({ group });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/access/groups/:groupId/levels/:level", requireAdmin, async (request, response) => {
  try {
    const group = await updateGroupLevel(request.params.groupId, request.params.level, request.body || {});
    if (!group) {
      response.status(404).json({ error: "Access group not found." });
      return;
    }
    response.json({ group });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/access/super/password", requireAdmin, async (request, response) => {
  try {
    response.json({
      super: await setSuperPassword(request.body?.password, {
        currentPassword: request.body?.currentPassword,
        confirmPassword: request.body?.confirmPassword,
        requireConfirmation: true
      })
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/access/super", requireAdmin, async (request, response) => {
  try {
    response.json({ super: await updateSuperAccess(request.body || {}) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/notebooks", async (request, response) => {
  try {
    const notebooks = await listNotebooks();
    const includeAccess = isAdminRequest(request);
    if (includeAccess) {
      response.json({ notebooks: notebooks.map((notebook) => redactNotebookAccessForClient(notebook, { includeAccess: true })) });
      return;
    }
    if (!await isAccessControlConfigured()) {
      response.json({ notebooks: notebooks.map((notebook) => redactNotebookAccessForClient(notebook)) });
      return;
    }
    const access = await getAccessFromRequest(request);
    response.json({
      notebooks: notebooks
        .filter((notebook) => canAccessNotebook(access, notebook))
        .map((notebook) => redactNotebookAccessForClient(notebook))
    });
  } catch (error) {
    response.status(500).json({ error: error.message, notebooks: [] });
  }
});

app.get("/api/notebooks/:id", async (request, response) => {
  try {
    const notebook = await getNotebook(request.params.id);
    if (!notebook) {
      response.status(404).json({ error: "?명듃遺곸쓣 李얠쓣 ???놁뒿?덈떎." });
      return;
    }
    const includeAccess = isAdminRequest(request);
    if (!includeAccess && await isAccessControlConfigured()) {
      const access = await requireNotebookAccess(request, response, notebook);
      if (!access) return;
    }
    response.json({ notebook: redactNotebookAccessForClient(notebook, { includeAccess }) });
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
      response.status(404).json({ error: "?명듃遺곸쓣 李얠쓣 ???놁뒿?덈떎." });
      return;
    }
    response.json({ notebook: updated });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/notebooks/:id/access", requireAdmin, async (request, response) => {
  try {
    const updated = await updateNotebookAccess(request.params.id, normalizeNotebookAccessPolicy(request.body?.access || request.body || null));
    if (!updated) {
      response.status(404).json({ error: "?명듃遺곸쓣 李얠쓣 ???놁뒿?덈떎." });
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
    response.status(400).json({ error: "?낅줈?쒕맂 ?뚯씪???놁뒿?덈떎." });
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

app.use("/api/admin/rag-eval", ragEvalRouter);
app.use("/api/admin/graph", graphAdminRouter);
app.use("/api/admin/stats", requireAdmin, statsApiRouter);
app.use("/api/studio/graph", graphStudioRouter);
app.use("/api/studio/document", studioDocumentRouter);

app.post("/api/source-workflow/source-guide", async (request, response) => {
  try {
    const notebookId = String(request.body?.notebookId || "").trim();
    if (notebookId) {
      const notebook = await getNotebook(notebookId);
      if (!notebook) {
        response.status(404).json({ ok: false, error: "프로젝트를 찾을 수 없습니다." });
        return;
      }
      if (!isAdminRequest(request) && await isAccessControlConfigured()) {
        const access = await requireNotebookAccess(request, response, notebook);
        if (!access) return;
      }
    }
    const guide = await buildSourceGuide({
      title: request.body?.title,
      documents: request.body?.documents,
      notebookId,
      model: request.body?.model || DEFAULT_MODEL,
      signal: request.signal
    });
    response.json({ ok: true, guide });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/source-workflow/promotions", async (request, response) => {
  try {
    const notebookId = String(request.body?.notebookId || "").trim();
    const notebook = notebookId ? await getNotebook(notebookId) : null;
    if (!notebook) {
      response.status(404).json({ ok: false, error: "프로젝트를 찾을 수 없습니다." });
      return;
    }
    if (!isAdminRequest(request) && await isAccessControlConfigured()) {
      const access = await requireNotebookAccess(request, response, notebook);
      if (!access) return;
    }
    const promotion = await createSourcePromotionRequest(request.body || {});
    response.status(201).json({ ok: true, promotion });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/source-promotions", requireAdmin, async (_request, response) => {
  try {
    response.json({ ok: true, promotions: await listSourcePromotions() });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message, promotions: [] });
  }
});

app.patch("/api/admin/source-promotions/:id", requireAdmin, async (request, response) => {
  try {
    const promotion = await reviewSourcePromotion(request.params.id, request.body || {});
    if (!promotion) {
      response.status(404).json({ ok: false, error: "승인 요청을 찾을 수 없습니다." });
      return;
    }
    response.json({ ok: true, promotion });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message });
  }
});

app.use("/api/source-workflow", generatedSourceRouter);
app.use("/api/law", lawApiRouter);

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
    response.status(400).json({ error: "?낅줈?쒕맂 ?뚯씪???놁뒿?덈떎." });
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
      response.status(404).json({ error: "臾몄꽌瑜?李얠쓣 ???놁뒿?덈떎." });
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

const httpsOptions = loadHttpsOptions();
const server = httpsOptions ? https.createServer(httpsOptions, app) : http.createServer(app);
const scheme = httpsOptions ? "https" : "http";

server.listen(port, host, () => {
  const displayHost = host || "0.0.0.0";
  console.log(`myAI listening on ${scheme}://${displayHost}:${port}`);
  if (!httpsOptions) {
    console.log("[https] disabled — set HTTPS_KEY_PATH and HTTPS_CERT_PATH to enable. Browsers block crypto.subtle on plain http://<lan-ip>, which breaks the UI from remote PCs.");
  }
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
