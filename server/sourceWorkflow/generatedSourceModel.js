import crypto from "node:crypto";

export const GENERATED_SOURCE_LABELS = Object.freeze(["AI 생성", "검증 필요"]);
export const GENERATED_SOURCE_TRUST = 0.5;
export const MAX_GENERATED_SOURCE_CHARS = Number(process.env.GENERATED_SOURCE_MAX_CHARS || 180_000);
export const GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES = Number(process.env.GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES || 750_000);

export const SOURCE_WORKFLOW_FORMATS = Object.freeze({
  md: {
    extension: "md",
    mimeType: "text/markdown; charset=utf-8"
  },
  pdf: {
    extension: "pdf",
    mimeType: "application/pdf"
  },
  docx: {
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  hwpx: {
    extension: "hwpx",
    mimeType: "application/vnd.hancom.hwpx"
  }
});

export function normalizeGeneratedSourceRequest(input = {}) {
  const format = String(input.format || "md").trim().toLowerCase();
  const config = SOURCE_WORKFLOW_FORMATS[format];
  if (!config) {
    const supported = Object.keys(SOURCE_WORKFLOW_FORMATS).join(", ");
    throw new Error(`Unsupported generated source format. Supported formats: ${supported}`);
  }

  const answerMarkdown = normalizeText(input.answerMarkdown);
  if (!answerMarkdown) throw new Error("Generated source content is empty.");
  if (answerMarkdown.length > MAX_GENERATED_SOURCE_CHARS) {
    throw new Error(`Generated source content is too large. Limit is ${MAX_GENERATED_SOURCE_CHARS.toLocaleString()} characters.`);
  }

  const title = sanitizeTitle(input.title || "myAI generated source");
  const messageId = typeof input.messageId === "string" && input.messageId.trim()
    ? input.messageId.trim().slice(0, 160)
    : "";
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};

  return {
    format,
    title,
    answerMarkdown,
    messageId,
    metadata
  };
}

export function buildGeneratedSource({ request, exportFile, now = new Date() } = {}) {
  if (!request || typeof request !== "object") throw new Error("Generated source request is required.");
  const formatConfig = SOURCE_WORKFLOW_FORMATS[request.format];
  if (!formatConfig) throw new Error("Generated source format is required.");

  const id = `generated_doc_${now.getTime()}_${crypto.randomUUID().slice(0, 8)}`;
  const text = normalizeText(request.answerMarkdown);
  const buffer = Buffer.isBuffer(exportFile?.buffer) ? exportFile.buffer : null;
  const fileName = exportFile?.filename || `${sanitizeTitle(request.title)}.${formatConfig.extension}`;
  const mimeType = exportFile?.contentType || formatConfig.mimeType;
  const sourceMetadata = normalizeSourceMetadata(request.metadata);

  return {
    id,
    kind: "document",
    fileName,
    fileType: request.format,
    mimeType,
    text,
    textLength: text.length,
    preview: text.slice(0, 280),
    origin: "assistant_answer",
    sourceMessageId: request.messageId || "",
    generatedBy: "assistant",
    generatedAt: now.toISOString(),
    trustLevel: "generated",
    sourceTrust: GENERATED_SOURCE_TRUST,
    labels: [...GENERATED_SOURCE_LABELS],
    citations: Array.isArray(request.metadata?.citations) ? structuredCloneSafe(request.metadata.citations) : [],
    sourceMetadata,
    dataBase64: buffer && buffer.length <= GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES ? buffer.toString("base64") : ""
  };
}

function normalizeSourceMetadata(metadata = {}) {
  return {
    notebook: metadata.notebook && typeof metadata.notebook === "object" ? structuredCloneSafe(metadata.notebook) : null,
    law: metadata.law && typeof metadata.law === "object" ? structuredCloneSafe(metadata.law) : null,
    compliance: metadata.compliance && typeof metadata.compliance === "object" ? structuredCloneSafe(metadata.compliance) : null,
    webSearch: metadata.webSearch && typeof metadata.webSearch === "object" ? structuredCloneSafe(metadata.webSearch) : null
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function sanitizeTitle(value) {
  const title = String(value || "myAI generated source")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return title || "myAI generated source";
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
