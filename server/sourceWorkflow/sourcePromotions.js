import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { addNotebookDocument, getNotebook } from "../notebooks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const STORE_DIR = path.join(rootDir, "data", "source-promotions");
const STORE_PATH = path.join(STORE_DIR, "promotions.json");
const MAX_PROMOTION_TEXT_CHARS = Number(process.env.SOURCE_PROMOTION_MAX_CHARS || 180_000);

export async function createSourcePromotionRequest(input = {}) {
  const notebookId = sanitizeId(input.notebookId);
  if (!notebookId) throw new Error("승인 요청 대상 지식팩이 필요합니다.");
  const notebook = await getNotebook(notebookId);
  if (!notebook) throw new Error("지식팩을 찾을 수 없습니다.");

  const title = sanitizeInline(input.title, 160) || "AI 생성 자료";
  const markdown = normalizeMarkdown(input.markdown || input.text || "");
  if (!markdown) throw new Error("승인 요청할 내용이 없습니다.");
  if (markdown.length > MAX_PROMOTION_TEXT_CHARS) {
    throw new Error(`승인 요청 내용이 너무 깁니다. 최대 ${MAX_PROMOTION_TEXT_CHARS.toLocaleString()}자까지 가능합니다.`);
  }

  const now = new Date().toISOString();
  const record = {
    id: `promotion_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    notebookId,
    notebookName: notebook.name || "",
    title,
    summary: sanitizeMultiline(input.summary, 1200),
    sourceType: sanitizeInline(input.sourceType || "studio_output", 64),
    sourceRoomId: sanitizeInline(input.sourceRoomId, 160),
    sourceMessageId: sanitizeInline(input.sourceMessageId, 160),
    sourceOutputId: sanitizeInline(input.sourceOutputId, 160),
    generatedAt: sanitizeInline(input.generatedAt, 64),
    requestedAt: now,
    requestedBy: sanitizeInline(input.requestedBy || "browser_user", 120),
    citations: Array.isArray(input.citations) ? cloneJson(input.citations) : [],
    metadata: input.metadata && typeof input.metadata === "object" ? cloneJson(input.metadata) : {},
    markdown,
    reviewStatus: "pending",
    approvedBy: "",
    approvedAt: "",
    rejectedBy: "",
    rejectedAt: "",
    reviewNote: "",
    notebookDocumentId: ""
  };

  const store = await readPromotionStore();
  store.promotions.unshift(record);
  await writePromotionStore(store);
  return publicPromotion(record, { includeMarkdown: true });
}

export async function listSourcePromotions() {
  const store = await readPromotionStore();
  return store.promotions.map((record) => publicPromotion(record, { includeMarkdown: false }));
}

export async function reviewSourcePromotion(promotionId, input = {}) {
  const store = await readPromotionStore();
  const record = store.promotions.find((item) => item.id === promotionId);
  if (!record) return null;
  if (record.status !== "pending") {
    throw new Error("이미 검토가 완료된 승인 요청입니다.");
  }

  const action = String(input.status || input.action || "").trim().toLowerCase();
  const reviewer = sanitizeInline(input.approvedBy || input.reviewer || "admin", 120);
  const now = new Date().toISOString();
  record.reviewNote = sanitizeMultiline(input.reviewNote || input.note || "", 1200);

  if (action === "rejected" || action === "reject") {
    record.status = "rejected";
    record.reviewStatus = "rejected";
    record.rejectedBy = reviewer;
    record.rejectedAt = now;
    await writePromotionStore(store);
    return publicPromotion(record, { includeMarkdown: true });
  }

  if (action !== "approved" && action !== "approve") {
    throw new Error("승인 또는 반려 상태가 필요합니다.");
  }

  const parsedDocument = {
    id: "",
    kind: "document",
    fileName: `${sanitizeFileStem(record.title)}.md`,
    fileType: "md",
    mimeType: "text/markdown; charset=utf-8",
    text: renderPromotionNotebookText(record),
    textLength: 0,
    preview: "",
    origin: "promoted_generated_source",
    trustLevel: "reviewed_generated",
    sourceTrust: 0.75,
    labels: ["AI 생성", "관리자 승인"]
  };
  parsedDocument.textLength = parsedDocument.text.length;
  parsedDocument.preview = parsedDocument.text.slice(0, 280);

  const added = await addNotebookDocument(record.notebookId, parsedDocument);
  record.status = "approved";
  record.reviewStatus = "approved";
  record.approvedBy = reviewer;
  record.approvedAt = now;
  record.notebookDocumentId = added?.id || "";
  await writePromotionStore(store);
  return publicPromotion(record, { includeMarkdown: true });
}

async function readPromotionStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      promotions: Array.isArray(parsed.promotions) ? parsed.promotions.map(normalizeRecord).filter(Boolean) : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const store = { version: 1, promotions: [] };
    await writePromotionStore(store);
    return store;
  }
}

async function writePromotionStore(store) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  const normalized = {
    version: 1,
    promotions: Array.isArray(store.promotions) ? store.promotions.map(normalizeRecord).filter(Boolean) : []
  };
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STORE_PATH);
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const id = sanitizeInline(record.id, 120);
  const notebookId = sanitizeId(record.notebookId);
  const markdown = normalizeMarkdown(record.markdown);
  if (!id || !notebookId || !markdown) return null;
  const status = ["pending", "approved", "rejected"].includes(record.status) ? record.status : "pending";
  return {
    ...record,
    id,
    status,
    reviewStatus: ["pending", "approved", "rejected"].includes(record.reviewStatus) ? record.reviewStatus : status,
    notebookId,
    notebookName: sanitizeInline(record.notebookName, 160),
    title: sanitizeInline(record.title, 160) || "AI 생성 자료",
    markdown,
    citations: Array.isArray(record.citations) ? record.citations : [],
    metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {}
  };
}

function publicPromotion(record, { includeMarkdown = false } = {}) {
  const out = {
    id: record.id,
    status: record.status,
    reviewStatus: record.reviewStatus,
    notebookId: record.notebookId,
    notebookName: record.notebookName,
    title: record.title,
    summary: record.summary || "",
    sourceType: record.sourceType || "",
    sourceRoomId: record.sourceRoomId || "",
    sourceMessageId: record.sourceMessageId || "",
    sourceOutputId: record.sourceOutputId || "",
    generatedAt: record.generatedAt || "",
    requestedAt: record.requestedAt || "",
    requestedBy: record.requestedBy || "",
    citations: Array.isArray(record.citations) ? record.citations : [],
    metadata: record.metadata || {},
    approvedBy: record.approvedBy || "",
    approvedAt: record.approvedAt || "",
    rejectedBy: record.rejectedBy || "",
    rejectedAt: record.rejectedAt || "",
    reviewNote: record.reviewNote || "",
    notebookDocumentId: record.notebookDocumentId || ""
  };
  if (includeMarkdown) out.markdown = record.markdown;
  return out;
}

function renderPromotionNotebookText(record) {
  const meta = [
    `# ${record.title}`,
    "",
    "> 이 문서는 AI 생성 산출물을 관리자가 검토 후 부서 지식팩에 편입한 자료입니다.",
    `> 승인 요청 시각: ${record.requestedAt || "-"}`,
    record.approvedAt ? `> 승인 시각: ${record.approvedAt}` : "",
    record.approvedBy ? `> 승인자: ${record.approvedBy}` : "",
    record.sourceRoomId ? `> 원본 방 ID: ${record.sourceRoomId}` : "",
    record.sourceMessageId ? `> 원본 메시지 ID: ${record.sourceMessageId}` : "",
    ""
  ].filter(Boolean).join("\n");
  return `${meta}\n${record.markdown}`.trim();
}

function sanitizeFileStem(value) {
  return sanitizeInline(value, 80).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "AI 생성 자료";
}

function sanitizeId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function sanitizeInline(value, maxLen) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function sanitizeMultiline(value, maxLen) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, maxLen);
}

function normalizeMarkdown(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
