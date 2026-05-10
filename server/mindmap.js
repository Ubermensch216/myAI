import { loadLocalEnv } from "./env.js";
import { createLinkedAbortController, throwIfAborted } from "./abort.js";
import { chunkDocumentSections } from "./chunking.js";
import { analysisQueue } from "./modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";

// Pass 1 — concept extraction (wider coverage)
const P1_MAX_CONTEXT = Number(process.env.MINDMAP_P1_MAX_CONTEXT || 18000);
const P1_MAX_CHUNKS  = Number(process.env.MINDMAP_P1_MAX_CHUNKS  || 8);
const P1_MAX_CONCEPTS = Number(process.env.MINDMAP_P1_MAX_CONCEPTS || 20);
const OLLAMA_TIMEOUT_MS = clampInt(process.env.MINDMAP_OLLAMA_TIMEOUT_MS, 60000, 5000, 300000);

// Pass 2 — mindmap structure
const MAX_NODES = Number(process.env.MINDMAP_MAX_NODES || 16);
const MAX_EDGES = Number(process.env.MINDMAP_MAX_EDGES || 24);

export async function generateMindmap({ documents = [], model = DEFAULT_MODEL, signal } = {}) {
  throwIfAborted(signal);
  const usableDocs = normalizeDocuments(documents);
  if (!usableDocs.length) {
    throw new Error("mindmap requires at least one uploaded document with extracted text.");
  }

  const fallback = buildFallbackMindmap(usableDocs);

  try {
    const parsed = await analysisQueue.run(async () => {
      throwIfAborted(signal);

      // Pass 1: extract concepts spanning the full document
      const concepts = await extractConcepts({ documents: usableDocs, model, signal });
      if (!concepts.length) return null;

      throwIfAborted(signal);

      // Pass 2: derive relationships from concept list only
      return buildMindmapFromConcepts({ concepts, documents: usableDocs, model, signal });
    }, { signal, label: "studio_mindmap" });

    if (!parsed) return fallback;
    return normalizeMindmap(parsed, usableDocs, fallback);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isQueueCapacityError(error)) {
      error.statusCode = 429;
      throw error;
    }
    return {
      ...fallback,
      warnings: [...(fallback.warnings || []), `model_fallback: ${error.message}`]
    };
  }
}

// ─── Pass 1 ─────────────────────────────────────────────────────────────────

async function extractConcepts({ documents, model, signal }) {
  const context = buildP1Context(documents);
  if (!context.trim()) return [];

  const controller = createLinkedAbortController(signal, OLLAMA_TIMEOUT_MS, "Mind-map concept extraction timed out.");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content: [
            "Extract key concepts from the provided document(s).",
            "Return JSON only.",
            "Labels and descriptions should be Korean when possible.",
            `Schema: {"concepts": [{"id": string, "label": string, "description": string, "category": string}]}`,
            `Extract at most ${P1_MAX_CONCEPTS} distinct, important concepts.`,
            "Each label should be 1–5 words. Each description should be 1–2 sentences."
          ].join("\n")
        },
        {
          role: "user",
          content: `문서에서 핵심 개념을 추출하세요:\n\n${context}`
        }
      ],
      options: { temperature: 0.1 }
    })
  });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama concept extraction failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    return parseConceptsJson(payload?.message?.content || payload?.response || "");
  } finally {
    controller.cleanup();
  }
}

function buildP1Context(documents) {
  const sections = [];
  const perDocBudget = Math.max(360, Math.floor(P1_MAX_CONTEXT / Math.max(1, documents.length)));

  for (const [idx, doc] of documents.entries()) {
    const header = [
      `Document ${idx + 1}: ${doc.fileName}`,
      doc.fileType  ? `Type: ${doc.fileType}`            : "",
      doc.summary   ? `Summary: ${doc.summary}`          : "",
      doc.topics.length ? `Topics: ${doc.topics.join(", ")}` : ""
    ].filter(Boolean).join("\n");

    const allChunks = chunkDocumentSections(doc.source, {
      windowChars: 1500,
      overlapChars: 100
    });

    // Evenly sample across the whole document (not just the first N)
    const sampled = sampleEvenly(allChunks, P1_MAX_CHUNKS);

    const body = sampled.length
      ? sampled.map((chunk, i) => {
          const label = [chunk.page, chunk.label].filter(Boolean).join(" / ");
          return `[${label || `section ${i + 1}`}]\n${chunk.text}`;
        }).join("\n\n")
      : doc.text.slice(0, 6000);

    const entry = `${header}\n\n${body}`.slice(0, perDocBudget);
    sections.push(entry);
  }

  return sections.join("\n\n---\n\n").slice(0, P1_MAX_CONTEXT);
}

function sampleEvenly(array, maxCount) {
  if (!array.length) return [];
  if (array.length <= maxCount) return array;
  return Array.from({ length: maxCount }, (_, i) =>
    array[Math.round(i * (array.length - 1) / (maxCount - 1))]
  );
}

function parseConceptsJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = tryParseJson(text);
    return (Array.isArray(parsed?.concepts) ? parsed.concepts : [])
      .map((c, i) => ({
        id:          sanitizeId(c?.id || `concept-${i + 1}`, `concept-${i + 1}`),
        label:       cleanText(c?.label, 42),
        description: cleanText(c?.description, 200),
        category:    cleanText(c?.category, 32) || "general"
      }))
      .filter(c => c.label)
      .slice(0, P1_MAX_CONCEPTS);
  } catch {
    return [];
  }
}

// ─── Pass 2 ─────────────────────────────────────────────────────────────────

async function buildMindmapFromConcepts({ concepts, documents, model, signal }) {
  const conceptList = concepts
    .map(c => `- [${c.id}] ${c.label}${c.description ? `: ${c.description}` : ""}${c.category ? ` (${c.category})` : ""}`)
    .join("\n");

  const docNames = documents.map(d => d.fileName).join(", ");

  const controller = createLinkedAbortController(signal, OLLAMA_TIMEOUT_MS, "Mind-map structuring timed out.");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content: [
            "Build a knowledge mind map from the provided concept list.",
            "Return JSON only.",
            "Labels and summaries should be Korean when possible.",
            `Schema: {"title": string, "nodes": [{"id": string, "label": string, "summary": string, "group": string, "importance": 1-5, "sourceRefs": [string]}], "edges": [{"from": string, "to": string, "label": string, "strength": 1-5}], "groups": [{"id": string, "label": string}]}`,
            "Include one central root node. Connect concepts with meaningful, labeled relationships.",
            `Use at most ${MAX_NODES} nodes and ${MAX_EDGES} edges.`,
            "Prefer using the provided concept IDs for node IDs."
          ].join("\n")
        },
        {
          role: "user",
          content: `문서: ${docNames}\n\n추출된 개념 목록:\n${conceptList}\n\n개념들 간의 관계를 분석하여 마인드맵을 생성하세요.`
        }
      ],
      options: { temperature: 0.2 }
    })
  });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama mindmap build failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    return parseMindmapJson(payload?.message?.content || payload?.response || "");
  } finally {
    controller.cleanup();
  }
}

// ─── JSON helpers ────────────────────────────────────────────────────────────

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const first = text.indexOf("{");
    const last  = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("not valid JSON");
  }
}

function parseMindmapJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("empty mindmap response");
  return tryParseJson(text);
}

// ─── Document helpers ────────────────────────────────────────────────────────

function normalizeDocuments(documents) {
  const out = [];
  for (const doc of Array.isArray(documents) ? documents : []) {
    if (!doc || doc.kind !== "document") continue;
    const text = collectDocumentText(doc).trim();
    if (!text) continue;
    out.push({
      id:       String(doc.id || doc.fileName || `doc-${out.length + 1}`),
      fileName: String(doc.fileName || `document-${out.length + 1}`),
      fileType: String(doc.fileType || "").toLowerCase(),
      summary:  String(doc.summary || "").trim(),
      topics:   Array.isArray(doc.topics) ? doc.topics.map(t => String(t).trim()).filter(Boolean) : [],
      source:   doc,
      text
    });
  }
  return out;
}

function collectDocumentText(doc) {
  if (typeof doc.text === "string" && doc.text.trim()) return doc.text;
  const pages  = Array.isArray(doc.pages)  ? doc.pages.map(p => p?.text).filter(Boolean).join("\n\n")  : "";
  const sheets = Array.isArray(doc.sheets) ? doc.sheets.map(s => s?.text).filter(Boolean).join("\n\n") : "";
  return pages || sheets;
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeMindmap(value, documents, fallback) {
  const sourceNames = new Set(documents.map(d => d.fileName));
  const groups  = normalizeGroups(value?.groups);
  const groupIds = new Set(groups.map(g => g.id));
  const nodes   = [];
  const seenNodes = new Set();
  const idAliases = new Map();

  for (const [i, node] of (Array.isArray(value?.nodes) ? value.nodes : []).entries()) {
    const fallbackId = `node-${i + 1}`;
    const rawId = node?.id || fallbackId;
    const id = sanitizeId(rawId, fallbackId);
    if (seenNodes.has(id)) continue;
    const label = cleanText(node?.label, 42);
    if (!label) continue;
    const group = sanitizeId(node?.group || "core", "core");
    if (!groupIds.has(group)) {
      groups.push({ id: group, label: cleanText(node?.group, 24) || group });
      groupIds.add(group);
    }
    seenNodes.add(id);
    addIdAlias(idAliases, rawId, id);
    addIdAlias(idAliases, id, id);
    addIdAlias(idAliases, label, id);
    nodes.push({
      id,
      label,
      summary:    cleanText(node?.summary, 240),
      group,
      importance: clampInt(node?.importance, i === 0 ? 5 : 3, 1, 5),
      sourceRefs: normalizeSourceRefs(node?.sourceRefs, sourceNames)
    });
    if (nodes.length >= MAX_NODES) break;
  }
  if (!nodes.length) return fallback;

  const nodeIds = new Set(nodes.map(n => n.id));
  const rootId  = nodes[0].id;
  const edges   = [];
  const edgeKeys = new Set();

  for (const edge of Array.isArray(value?.edges) ? value.edges : []) {
    const from = resolveNodeId(edge?.from, idAliases);
    const to   = resolveNodeId(edge?.to, idAliases);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from, to, label: cleanText(edge?.label, 32), strength: clampInt(edge?.strength, 3, 1, 5) });
    if (edges.length >= MAX_EDGES) break;
  }

  // Ensure every non-root node is reachable from the root in the directed graph.
  for (const node of findUnreachableNodes(rootId, nodes, edges)) {
    edges.push({ from: rootId, to: node.id, label: "", strength: 2 });
  }

  return {
    title:         cleanText(value?.title, 64) || fallback.title,
    generatedAt:   new Date().toISOString(),
    documentCount: documents.length,
    groups,
    nodes,
    edges,
    warnings: []
  };
}

function normalizeGroups(groups) {
  const out  = [];
  const seen = new Set();
  for (const [i, g] of (Array.isArray(groups) ? groups : []).entries()) {
    const id = sanitizeId(g?.id || `group-${i + 1}`, `group-${i + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: cleanText(g?.label, 28) || id });
  }
  if (!seen.has("core")) out.unshift({ id: "core", label: "Core" });
  return out.slice(0, 10);
}

function buildFallbackMindmap(documents) {
  const rootId = "root";
  const nodes  = [{
    id: rootId, label: "Mind Map", summary: "Uploaded document overview",
    group: "core", importance: 5, sourceRefs: documents.map(d => d.fileName)
  }];
  const edges  = [];
  const groups = [{ id: "core", label: "Core" }, { id: "documents", label: "Documents" }, { id: "topics", label: "Topics" }];

  for (const [i, doc] of documents.entries()) {
    const docId = `doc-${i + 1}`;
    nodes.push({ id: docId, label: doc.fileName.slice(0, 42), summary: doc.summary || doc.text.slice(0, 180), group: "documents", importance: 4, sourceRefs: [doc.fileName] });
    edges.push({ from: rootId, to: docId, label: "", strength: 3 });
    for (const [ti, topic] of doc.topics.slice(0, 4).entries()) {
      const tid = `doc-${i + 1}-topic-${ti + 1}`;
      nodes.push({ id: tid, label: topic.slice(0, 42), summary: "", group: "topics", importance: 3, sourceRefs: [doc.fileName] });
      edges.push({ from: docId, to: tid, label: "", strength: 2 });
    }
  }

  return {
    title: documents.length === 1 ? documents[0].fileName : "Uploaded Documents",
    generatedAt:   new Date().toISOString(),
    documentCount: documents.length,
    groups,
    nodes: nodes.slice(0, MAX_NODES),
    edges: edges.slice(0, MAX_EDGES),
    warnings: ["fallback_mindmap"]
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizeSourceRefs(value, sourceNames) {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = refs
    .map(r => cleanText(r, 120))
    .filter(ref => sourceNames.has(ref))
    .filter((r, i, a) => a.indexOf(r) === i);
  if (!normalized.length) return Array.from(sourceNames).slice(0, 2);
  return normalized.slice(0, 5);
}

function addIdAlias(map, value, id) {
  const keys = [
    String(value ?? "").trim(),
    sanitizeId(value, "")
  ].filter(Boolean);
  for (const key of keys) map.set(key, id);
}

function resolveNodeId(value, aliases) {
  const raw = String(value ?? "").trim();
  return aliases.get(raw) || aliases.get(sanitizeId(raw, "")) || "";
}

function findUnreachableNodes(rootId, nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge.to);
  }
  const reachable = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of outgoing.get(id) || []) stack.push(next);
  }
  return nodes.slice(1).filter((node) => !reachable.has(node.id));
}

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeId(value, fallback) {
  const clean = String(value ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
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
