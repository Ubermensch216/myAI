// Studio Document model validator/normalizer. Accepts loose input from the
// LLM or the client, produces a strict, bounded document.

import { DOCUMENT_TYPES } from "./defaultTemplates.js";

const SUPPORTED_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "bullet_list",
  "numbered_list",
  "table",
  "checklist",
  "quote",
  "source_list",
  "spacer"
]);

const MAX_BLOCKS = Number(process.env.STUDIO_DOCUMENT_MAX_BLOCKS || 120);
const MAX_CHARS = Number(
  process.env.STUDIO_DOCUMENT_MAX_CHARS || process.env.EXPORT_MAX_CHARS || 180_000
);
const MAX_TABLE_ROWS = Number(process.env.STUDIO_DOCUMENT_MAX_TABLE_ROWS || 200);
const MAX_TABLE_COLS = 12;
const MAX_TEXT = 8000;
const MAX_TITLE = 200;
const MAX_LIST_ITEMS = 200;

export const DOCUMENT_LIMITS = Object.freeze({
  maxBlocks: MAX_BLOCKS,
  maxChars: MAX_CHARS,
  maxTableRows: MAX_TABLE_ROWS,
  maxTableCols: MAX_TABLE_COLS,
  maxText: MAX_TEXT
});

export function validateDocumentStructure(docType, markdown) {
  const typeDef = DOCUMENT_TYPES.find(t => t.id === docType);
  if (!typeDef || !Array.isArray(typeDef.requiredSections) || typeDef.requiredSections.length === 0) {
    return [];
  }

  const missing = [];
  const lines = String(markdown || "").split("\n").map(l => l.trim());

  for (const section of typeDef.requiredSections) {
    let found = false;
    for (const label of section.labels) {
      const escapedLabel = label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Heading pattern: e.g., "## 1. 검토 개요" or "### 검토 개요" or "1. 검토 개요"
      const regex = new RegExp(`^\\s*(?:#{1,6}\\s+)?(?:(?:\\d+\\.\\s*)?${escapedLabel}|${escapedLabel})`, 'i');
      if (lines.some(line => regex.test(line))) {
        found = true;
        break;
      }
    }
    if (!found) {
      missing.push({ id: section.id, label: section.labels[0] });
    }
  }

  return missing;
}

export function normalizeDocument(doc = {}, { source = null } = {}) {
  const id = String(doc.id || "").trim() || `draft_${Date.now()}_${randomSuffix()}`;
  const title = sanitizeInline(doc.title, MAX_TITLE) || "제목 없음";
  const templateId = String(doc.templateId || "").trim() || null;
  const now = new Date().toISOString();

  const blocks = normalizeBlocks(Array.isArray(doc.blocks) ? doc.blocks : []);
  const citations = normalizeCitations(doc.citations || {});

  const charCount = countDocumentChars({ title, blocks });
  if (charCount > MAX_CHARS) {
    const err = new Error(
      `문서 길이가 한도(${MAX_CHARS.toLocaleString()}자)를 초과했습니다. 현재 ${charCount.toLocaleString()}자.`
    );
    err.code = "DOCUMENT_TOO_LARGE";
    throw err;
  }

  const resolvedSource = source || normalizeSource(doc.source);
  const sourceType = String(resolvedSource?.sourceType || "").trim();

  let docType = String(doc.docType || "").trim() || null;
  let presentationStyle = String(doc.presentationStyle || "").trim() || null;

  // Legacy document migration
  if (!docType) {
    if (sourceType === "law_workbench_report" || sourceType === "grc_review") {
      docType = "review_report";
    } else if (templateId) {
      docType = "custom";
    } else {
      docType = "summary";
    }
  }
  if (!presentationStyle) {
    if (sourceType === "law_workbench_report" || sourceType === "grc_review") {
      presentationStyle = "working";
    } else {
      presentationStyle = "default";
    }
  }

  const parentDocumentId = String(doc.parentDocumentId || "").trim() || null;
  const sourceMarkdown = typeof doc.sourceMarkdown === "string" ? doc.sourceMarkdown : null;
  const generatedMarkdown = typeof doc.generatedMarkdown === "string" ? doc.generatedMarkdown : null;
  const versions = Array.isArray(doc.versions) ? doc.versions.map(v => ({
    id: String(v.id || ""),
    reason: String(v.reason || ""),
    createdAt: String(v.createdAt || ""),
    markdown: String(v.markdown || "")
  })) : [];

  return {
    id,
    title,
    templateId,
    docType,
    presentationStyle,
    parentDocumentId,
    sourceMarkdown,
    generatedMarkdown,
    versions,
    source: resolvedSource,
    blocks,
    citations,
    createdAt: typeof doc.createdAt === "string" && doc.createdAt ? doc.createdAt : now,
    updatedAt: now
  };
}

export function isSupportedBlockType(type) {
  return SUPPORTED_BLOCK_TYPES.has(String(type || ""));
}

function normalizeBlocks(rawBlocks) {
  const out = [];
  for (const raw of rawBlocks) {
    const block = normalizeBlock(raw, out.length);
    if (!block) continue;
    out.push(block);
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

function normalizeBlock(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").trim();
  if (!SUPPORTED_BLOCK_TYPES.has(type)) return null;
  const id = String(raw.id || "").trim() || `block_${index + 1}`;

  if (type === "heading") {
    const text = sanitizeInline(raw.text, MAX_TITLE);
    if (!text) return null;
    return { id, type, level: clampInt(raw.level, 1, 1, 6), text };
  }

  if (type === "paragraph" || type === "quote") {
    const text = sanitizeMultiline(raw.text, MAX_TEXT);
    if (!text) return null;
    return { id, type, text };
  }

  if (type === "bullet_list" || type === "numbered_list") {
    const items = normalizeStringList(raw.items, MAX_LIST_ITEMS, MAX_TEXT);
    if (!items.length) return null;
    return { id, type, items };
  }

  if (type === "checklist") {
    const items = normalizeChecklistItems(raw.items);
    if (!items.length) return null;
    return { id, type, items };
  }

  if (type === "table") {
    const columns = normalizeStringList(raw.columns, MAX_TABLE_COLS, 200);
    if (!columns.length) return null;
    const rows = normalizeTableRows(raw.rows, columns.length);
    return { id, type, columns, rows };
  }

  if (type === "source_list") {
    const items = normalizeStringList(raw.items, MAX_LIST_ITEMS, MAX_TEXT);
    if (!items.length) return null;
    return { id, type, items };
  }

  if (type === "spacer") {
    return { id, type };
  }

  return null;
}

function normalizeStringList(value, maxItems, maxLen) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    const text = sanitizeInline(item, maxLen);
    if (!text) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeChecklistItems(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    if (typeof item === "string") {
      const text = sanitizeInline(item, MAX_TEXT);
      if (text) out.push({ text, checked: false });
    } else if (item && typeof item === "object") {
      const text = sanitizeInline(item.text, MAX_TEXT);
      if (text) out.push({ text, checked: Boolean(item.checked) });
    }
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function normalizeTableRows(value, columnCount) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cells = [];
    for (let i = 0; i < columnCount; i += 1) {
      cells.push(sanitizeInline(row[i], 600));
    }
    out.push(cells);
    if (out.length >= MAX_TABLE_ROWS) break;
  }
  return out;
}

function normalizeCitations(raw) {
  const groups = ["notebook", "law", "precedent", "interpretation", "adminRule", "ordinance", "web"];
  const out = {};
  for (const key of groups) {
    out[key] = Array.isArray(raw?.[key]) ? raw[key].map(normalizeCitation).filter(Boolean) : [];
  }
  return out;
}

function normalizeCitation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const marker = sanitizeInline(raw.marker, 16);
  const label = sanitizeInline(raw.label || raw.title || raw.text, 400);
  if (!marker && !label) return null;
  const out = { marker, label };
  if (raw.url) out.url = sanitizeInline(raw.url, 1000);
  if (raw.source) out.source = sanitizeInline(raw.source, 200);
  return out;
}

function normalizeSource(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    roomId: sanitizeInline(raw.roomId, 200) || null,
    lawReviewId: sanitizeInline(raw.lawReviewId, 200) || null,
    grcReviewId: sanitizeInline(raw.grcReviewId, 200) || null,
    messageId: sanitizeInline(raw.messageId, 200) || null,
    sourceType: sanitizeInline(raw.sourceType, 64) || "assistant_answer"
  };
}

function sanitizeInline(value, maxLen) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeMultiline(value, maxLen) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLen);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function countDocumentChars({ title, blocks }) {
  let total = String(title || "").length;
  for (const block of blocks) {
    if (block.text) total += block.text.length;
    if (Array.isArray(block.items)) {
      for (const item of block.items) {
        if (typeof item === "string") total += item.length;
        else if (item && typeof item === "object" && item.text) total += item.text.length;
      }
    }
    if (Array.isArray(block.columns)) {
      for (const col of block.columns) total += String(col || "").length;
    }
    if (Array.isArray(block.rows)) {
      for (const row of block.rows) {
        for (const cell of row) total += String(cell || "").length;
      }
    }
  }
  return total;
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
