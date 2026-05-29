import { loadLocalEnv } from "./env.js";
import { createLinkedAbortController, throwIfAborted } from "./abort.js";
import { chunkDocumentSections } from "./chunking.js";
import { analysisQueue } from "./modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const INFOGRAPHIC_MODEL = String(process.env.INFOGRAPHIC_MODEL || "").trim();

const MAX_CONTEXT = clampInt(process.env.INFOGRAPHIC_MAX_CONTEXT, 12000, 2000, 80000);
const MAX_CHUNKS = clampInt(process.env.INFOGRAPHIC_MAX_CHUNKS, 10, 3, 40);
const OLLAMA_TIMEOUT_MS = clampInt(process.env.INFOGRAPHIC_OLLAMA_TIMEOUT_MS, 180000, 5000, 600000);

const MAX_BLOCKS = clampInt(process.env.INFOGRAPHIC_MAX_BLOCKS, 8, 2, 16);
const MAX_ITEMS_PER_BLOCK = clampInt(process.env.INFOGRAPHIC_MAX_ITEMS, 6, 2, 12);
const MAX_CITATIONS = 24;

const LAYOUTS = new Set(["summary", "timeline", "process", "comparison"]);
const BLOCK_TYPES = new Set(["kpi", "cards", "timeline", "steps", "comparison"]);

const LAYOUT_GUIDANCE = {
  summary: "핵심 KPI 지표 1개 블록(items 3~4개)과 주요 내용 카드 블록(cards, 4~6개)을 만드세요.",
  timeline: "시간 순서가 드러나는 timeline 블록을 만드세요. 각 item에는 when(시점), title, body를 채우세요.",
  process: "단계별 절차를 steps 블록으로 만드세요. 각 item의 label에는 단계 번호(1,2,3...), title에는 단계명을 넣으세요.",
  comparison: "현행/개선안 또는 항목 간 비교를 comparison 블록으로 만드세요. columns에 비교 축, rows에 각 항목과 cells를 채우세요."
};

export async function generateInfographicSpec({
  documents = [],
  model = DEFAULT_MODEL,
  layout = "summary",
  prompt = "",
  signal
} = {}) {
  throwIfAborted(signal);
  const usableDocs = normalizeDocuments(documents);
  if (!usableDocs.length) {
    throw new Error("infographic requires at least one document with extracted text.");
  }

  const effectiveLayout = LAYOUTS.has(layout) ? layout : "summary";
  const fallback = buildFallbackInfographic(usableDocs, effectiveLayout);
  const effectiveModel = INFOGRAPHIC_MODEL || model || DEFAULT_MODEL;

  try {
    const parsed = await analysisQueue.run(async () => {
      throwIfAborted(signal);
      return requestInfographic({
        documents: usableDocs,
        model: effectiveModel,
        layout: effectiveLayout,
        prompt,
        signal
      });
    }, { signal, label: "studio_infographic" });

    if (!parsed) return fallback;
    return normalizeInfographicSpec(parsed, usableDocs, effectiveLayout, fallback);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isQueueCapacityError(error)) {
      error.statusCode = 429;
      throw error;
    }
    console.error("[infographic] generation failed, returning fallback:", error.message);
    return {
      ...fallback,
      warnings: [...(fallback.warnings || []), `model_fallback: ${error.message}`]
    };
  }
}

async function requestInfographic({ documents, model, layout, prompt, signal }) {
  const context = buildInfographicContext(documents);
  if (!context.trim()) return null;

  const sourceList = documents
    .map((doc, i) => `S${i + 1}: ${doc.fileName}`)
    .join("\n");

  const controller = createLinkedAbortController(signal, OLLAMA_TIMEOUT_MS, "Infographic generation timed out.");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: INFOGRAPHIC_SCHEMA,
        messages: [
          {
            role: "system",
            content: [
              "You are a document analysis AI that builds grounded infographic specifications for Korean public-sector work.",
              "Output ONLY the JSON object. Use Korean for all titles, labels, and body text when the source is Korean.",
              "Every block item that states a number, date, statute, or regulation MUST include citationIds referencing the citations array.",
              "Do not invent figures. If the source does not support a claim, omit it.",
              "Each citation id must look like N1, N2, ... and map to a real source document.",
              `Produce at most ${MAX_BLOCKS} blocks and at most ${MAX_ITEMS_PER_BLOCK} items per block.`
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `요청된 레이아웃: ${layout}`,
              LAYOUT_GUIDANCE[layout] || LAYOUT_GUIDANCE.summary,
              prompt ? `사용자 요청: ${prompt}` : "",
              "",
              "사용 가능한 출처 문서:",
              sourceList,
              "",
              "아래 자료를 분석하여 근거 기반 인포그래픽 JSON을 생성하세요.",
              "title, subtitle, layout, blocks, citations 를 채우세요.",
              "각 citation의 documentName 은 위 출처 문서명 중 하나여야 합니다.",
              "",
              context
            ].filter(Boolean).join("\n")
          },
          { role: "assistant", content: "{" }
        ],
        options: { temperature: 0.1 }
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama infographic failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    return parseInfographicJson(payload?.message?.content || payload?.response || "");
  } finally {
    controller.cleanup();
  }
}

const INFOGRAPHIC_SCHEMA = {
  type: "object",
  required: ["title", "blocks"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    layout: { type: "string" },
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                note: { type: "string" },
                when: { type: "string" },
                title: { type: "string" },
                body: { type: "string" },
                citationIds: { type: "array", items: { type: "string" } }
              }
            }
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                cells: { type: "array", items: { type: "string" } },
                citationIds: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "documentName"],
        properties: {
          id: { type: "string" },
          documentName: { type: "string" },
          locator: { type: "string" },
          excerpt: { type: "string" }
        }
      }
    }
  }
};

function buildInfographicContext(documents) {
  const sections = [];
  const perDocBudget = Math.max(1200, Math.floor(MAX_CONTEXT / Math.max(1, documents.length)));

  for (const [idx, doc] of documents.entries()) {
    const header = [
      `Document S${idx + 1}: ${doc.fileName}`,
      doc.fileType ? `Type: ${doc.fileType}` : "",
      doc.summary ? `Summary: ${doc.summary}` : "",
      doc.topics.length ? `Topics: ${doc.topics.join(", ")}` : ""
    ].filter(Boolean).join("\n");

    let body = "";
    try {
      const chunks = chunkDocumentSections(doc.source, { windowChars: 1600, overlapChars: 120 });
      const sampled = sampleEvenly(chunks, MAX_CHUNKS);
      if (sampled.length) {
        body = sampled.map((chunk, i) => {
          const label = [chunk.page, chunk.label].filter(Boolean).join(" / ");
          return `[${label || `section ${i + 1}`}]\n${chunk.text}`;
        }).join("\n\n");
      }
    } catch {
      body = "";
    }
    if (!body) body = doc.text.slice(0, perDocBudget);

    sections.push(`${header}\n\n${body}`.slice(0, perDocBudget));
  }

  return sections.join("\n\n---\n\n").slice(0, MAX_CONTEXT);
}

function sampleEvenly(array, maxCount) {
  if (!array.length) return [];
  if (array.length <= maxCount) return array;
  return Array.from({ length: maxCount }, (_, i) =>
    array[Math.round(i * (array.length - 1) / (maxCount - 1))]
  );
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("not valid JSON");
  }
}

function parseInfographicJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("empty infographic response");
  // The assistant prefill seeds an opening brace; restore it if the model omitted it.
  const candidate = text.startsWith("{") ? text : `{${text}`;
  try {
    return tryParseJson(candidate);
  } catch (err) {
    console.error("[infographic] parse failed:", err.message, "| raw preview:", text.slice(0, 200));
    throw err;
  }
}

function normalizeDocuments(documents) {
  const out = [];
  for (const doc of Array.isArray(documents) ? documents : []) {
    if (!doc || doc.kind !== "document") continue;
    const text = collectDocumentText(doc).trim();
    if (!text) continue;
    out.push({
      id: String(doc.id || doc.fileName || `doc-${out.length + 1}`),
      fileName: String(doc.fileName || `document-${out.length + 1}`),
      fileType: String(doc.fileType || "").toLowerCase(),
      summary: String(doc.summary || "").trim(),
      topics: Array.isArray(doc.topics) ? doc.topics.map(t => String(t).trim()).filter(Boolean) : [],
      source: doc,
      text
    });
  }
  return out;
}

function collectDocumentText(doc) {
  if (typeof doc.text === "string" && doc.text.trim()) return doc.text;
  const pages = Array.isArray(doc.pages) ? doc.pages.map(p => p?.text).filter(Boolean).join("\n\n") : "";
  const sheets = Array.isArray(doc.sheets) ? doc.sheets.map(s => s?.text).filter(Boolean).join("\n\n") : "";
  return pages || sheets;
}

function normalizeInfographicSpec(value, documents, layout, fallback) {
  const sourceNames = new Set(documents.map(d => d.fileName));
  const { citations, citationIds } = normalizeCitations(value?.citations, sourceNames);
  const warnings = [];

  const rawBlocks = Array.isArray(value?.blocks) ? value.blocks : [];
  const blocks = [];
  for (const raw of rawBlocks) {
    if (blocks.length >= MAX_BLOCKS) break;
    const block = normalizeBlock(raw, citationIds, warnings);
    if (block) blocks.push(block);
  }

  if (!blocks.length) return fallback;

  return {
    version: "1.0",
    title: cleanText(value?.title, 80) || fallback.title,
    subtitle: cleanText(value?.subtitle, 160),
    layout: LAYOUTS.has(value?.layout) ? value.layout : layout,
    generatedAt: new Date().toISOString(),
    documentCount: documents.length,
    blocks,
    citations,
    warnings
  };
}

function normalizeBlock(raw, citationIds, warnings) {
  const type = String(raw?.type || "").trim().toLowerCase();
  if (!BLOCK_TYPES.has(type)) return null;
  const title = cleanText(raw?.title, 60);

  if (type === "comparison") {
    const columns = (Array.isArray(raw?.columns) ? raw.columns : [])
      .map(c => cleanText(c, 40)).filter(Boolean).slice(0, 4);
    if (columns.length < 2) return null;
    const rows = [];
    for (const row of Array.isArray(raw?.rows) ? raw.rows : []) {
      if (rows.length >= MAX_ITEMS_PER_BLOCK) break;
      const label = cleanText(row?.label, 60);
      const cells = (Array.isArray(row?.cells) ? row.cells : [])
        .map(c => cleanText(c, 200)).slice(0, columns.length);
      while (cells.length < columns.length) cells.push("");
      if (!label && !cells.some(Boolean)) continue;
      rows.push({ label, cells, citationIds: filterCitationIds(row?.citationIds, citationIds) });
    }
    if (!rows.length) return null;
    return { type, title, columns, rows };
  }

  const items = [];
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    if (items.length >= MAX_ITEMS_PER_BLOCK) break;
    const normalized = normalizeItem(type, item, citationIds);
    if (normalized) items.push(normalized);
  }
  if (!items.length) return null;

  const numericTypes = type === "kpi";
  if (numericTypes && !items.some(it => it.citationIds.length)) {
    warnings.push("kpi_without_citation");
  }

  return { type, title, items };
}

function normalizeItem(type, item, citationIds) {
  const citation = filterCitationIds(item?.citationIds, citationIds);
  if (type === "kpi") {
    const label = cleanText(item?.label, 48);
    const valueText = cleanText(item?.value, 48);
    if (!label && !valueText) return null;
    return { label, value: valueText, note: cleanText(item?.note, 120), citationIds: citation };
  }
  if (type === "timeline") {
    const title = cleanText(item?.title, 80);
    const when = cleanText(item?.when || item?.label, 40);
    if (!title && !when) return null;
    return { when, title, body: cleanText(item?.body, 240), citationIds: citation };
  }
  if (type === "steps") {
    const title = cleanText(item?.title, 80);
    if (!title) return null;
    return { label: cleanText(item?.label, 12), title, body: cleanText(item?.body, 240), citationIds: citation };
  }
  // cards
  const title = cleanText(item?.title || item?.label, 80);
  const body = cleanText(item?.body || item?.note, 280);
  if (!title && !body) return null;
  return { title, body, citationIds: citation };
}

function normalizeCitations(value, sourceNames) {
  const citations = [];
  const citationIds = new Set();
  const seen = new Set();
  for (const [i, c] of (Array.isArray(value) ? value : []).entries()) {
    if (citations.length >= MAX_CITATIONS) break;
    const id = sanitizeCitationId(c?.id, `N${i + 1}`);
    if (seen.has(id)) continue;
    const documentName = resolveSourceName(c?.documentName, sourceNames);
    if (!documentName) continue;
    seen.add(id);
    citationIds.add(id);
    citations.push({
      id,
      documentName,
      locator: cleanText(c?.locator, 60),
      excerpt: cleanText(c?.excerpt, 240)
    });
  }
  return { citations, citationIds };
}

function filterCitationIds(value, citationIds) {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  for (const ref of refs) {
    const id = sanitizeCitationId(ref, "");
    if (id && citationIds.has(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 5);
}

function resolveSourceName(value, sourceNames) {
  const name = cleanText(value, 120);
  if (sourceNames.has(name)) return name;
  // Loose match: ignore extension/whitespace differences.
  const key = normalizeKey(name);
  for (const source of sourceNames) {
    if (normalizeKey(source) === key) return source;
  }
  return "";
}

function buildFallbackInfographic(documents, layout) {
  const sourceNames = new Set(documents.map(d => d.fileName));
  const citations = documents.slice(0, MAX_CITATIONS).map((doc, i) => ({
    id: `N${i + 1}`,
    documentName: doc.fileName,
    locator: "",
    excerpt: cleanText(doc.summary || doc.text.slice(0, 200), 240)
  }));
  const citationIds = new Set(citations.map(c => c.id));
  const docCite = (name) => {
    const hit = citations.find(c => c.documentName === name);
    return hit ? [hit.id] : [];
  };

  const blocks = [];
  blocks.push({
    type: "kpi",
    title: "핵심 지표",
    items: [
      { label: "분석 문서 수", value: `${documents.length}건`, note: "인포그래픽 생성에 사용된 문서", citationIds: [] }
    ]
  });

  const cards = [];
  for (const doc of documents) {
    if (cards.length >= MAX_ITEMS_PER_BLOCK) break;
    const body = doc.summary || doc.text.slice(0, 200);
    if (!body.trim()) continue;
    cards.push({
      title: cleanText(stripExtension(doc.fileName), 80),
      body: cleanText(body, 280),
      citationIds: docCite(doc.fileName)
    });
    for (const topic of doc.topics.slice(0, 2)) {
      if (cards.length >= MAX_ITEMS_PER_BLOCK) break;
      cards.push({ title: cleanText(topic, 80), body: "", citationIds: docCite(doc.fileName) });
    }
  }
  if (cards.length) blocks.push({ type: "cards", title: "주요 내용", items: cards });

  void sourceNames;
  void citationIds;

  return {
    version: "1.0",
    title: documents.length > 1 ? "업로드 문서 요약 인포그래픽" : cleanText(stripExtension(documents[0].fileName), 80),
    subtitle: "문서 메타데이터 기반 자동 요약",
    layout: LAYOUTS.has(layout) ? layout : "summary",
    generatedAt: new Date().toISOString(),
    documentCount: documents.length,
    blocks,
    citations,
    warnings: ["fallback_infographic"]
  };
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "").trim();
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\.[^.]+$/, "").replace(/\s+/g, "");
}

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeCitationId(value, fallback) {
  const clean = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
  return clean || fallback;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isQueueCapacityError(error) {
  return /queue is full/i.test(String(error?.message || ""));
}

export const __test__ = {
  normalizeInfographicSpec,
  buildFallbackInfographic,
  normalizeBlock,
  normalizeCitations
};
