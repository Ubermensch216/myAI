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
import { classifyIntent } from "./calendarAgent.js";
import { getKoreanHolidays } from "./holidays.js";

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
  const personalization = request.body.personalization && typeof request.body.personalization === "object"
    ? request.body.personalization
    : {};

  if (!messages.length) {
    response.status(400).json({ error: "messages가 비어 있습니다." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  try {
    await streamChat({
      messages,
      documents,
      model,
      personalization,
      onChunk: (chunk) => response.write(chunk)
    });
    response.end();
  } catch (error) {
    response.write(`\n\n[오류] ${error.message}`);
    response.end();
  }
});

app.post("/api/visualize", async (request, response) => {
  const messages = Array.isArray(request.body.messages) ? request.body.messages : [];
  const documents = Array.isArray(request.body.documents) ? request.body.documents : [];
  const model = request.body.model || DEFAULT_MODEL;
  const prompt = request.body.prompt || messages.findLast?.((message) => message.role !== "assistant")?.content || "";
  const personalization = request.body.personalization && typeof request.body.personalization === "object"
    ? request.body.personalization
    : {};

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
  const personalization = request.body.personalization && typeof request.body.personalization === "object"
    ? request.body.personalization
    : {};

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

  if (!prompt.trim()) {
    response.json({ intent: "chat", payload: {} });
    return;
  }

  try {
    const result = await classifyIntent({ prompt, model, currentDate });
    response.json(result);
  } catch (error) {
    response.json({ intent: "chat", payload: {}, fallbackReason: `server_error: ${error.message}` });
  }
});

app.use((_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, host, () => {
  const displayHost = host || "0.0.0.0";
  console.log(`myAI listening on http://${displayHost}:${port}`);
});
