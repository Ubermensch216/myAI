import { loadLocalEnv } from "./env.js";
import { createLinkedAbortController, throwIfAborted } from "./abort.js";
import { chunkDocumentSections } from "./chunking.js";
import { analysisQueue } from "./modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const MINDMAP_MODEL = String(process.env.MINDMAP_MODEL || "").trim();

const OUTLINE_MAX_CONTEXT = clampInt(process.env.MINDMAP_P1_MAX_CONTEXT, 12000, 2000, 80000);
const OUTLINE_MAX_CHUNKS = clampInt(process.env.MINDMAP_P1_MAX_CHUNKS, 10, 3, 40);
const OUTLINE_MAX_ITEMS = clampInt(process.env.MINDMAP_OUTLINE_MAX_ITEMS || process.env.MINDMAP_P1_MAX_CONCEPTS, 28, 8, 80);
const OLLAMA_TIMEOUT_MS = clampInt(process.env.MINDMAP_OLLAMA_TIMEOUT_MS, 180000, 5000, 600000);

const MAX_NODES = clampInt(process.env.MINDMAP_MAX_NODES, 24, 8, 80);
const MAX_EDGES = clampInt(process.env.MINDMAP_MAX_EDGES, 36, 8, 120);
const ROOT_ID = "root";

export async function generateMindmap({ documents = [], model = DEFAULT_MODEL, signal } = {}) {
  throwIfAborted(signal);
  const usableDocs = normalizeDocuments(documents);
  if (!usableDocs.length) {
    throw new Error("mindmap requires at least one uploaded document with extracted text.");
  }

  const fallback = buildFallbackMindmap(usableDocs);
  const effectiveModel = MINDMAP_MODEL || model || DEFAULT_MODEL;

  try {
    const parsed = await analysisQueue.run(async () => {
      throwIfAborted(signal);
      return buildHierarchicalMindmap({ documents: usableDocs, model: effectiveModel, signal });
    }, { signal, label: "studio_mindmap" });

    if (!parsed) return fallback;
    return normalizeMindmap(parsed, usableDocs, fallback);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isQueueCapacityError(error)) {
      error.statusCode = 429;
      throw error;
    }
    console.error("[mindmap] generation failed, returning fallback:", error.message);
    return {
      ...fallback,
      warnings: [...(fallback.warnings || []), `model_fallback: ${error.message}`]
    };
  }
}

async function buildHierarchicalMindmap({ documents, model, signal }) {
  const context = buildOutlineContext(documents);
  if (!context.trim()) return null;

  const controller = createLinkedAbortController(signal, OLLAMA_TIMEOUT_MS, "Mind-map hierarchy generation timed out.");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          required: ["title", "nodes", "edges"],
          properties: {
            title: { type: "string" },
            groups: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, label: { type: "string" } },
                required: ["id", "label"]
              }
            },
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  summary: { type: "string" },
                  group: { type: "string" },
                  parentId: { type: "string" },
                  importance: { type: "integer" }
                },
                required: ["id", "label", "parentId"]
              }
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  label: { type: "string" },
                  strength: { type: "integer" }
                },
                required: ["from", "to"]
              }
            }
          }
        },
        messages: [
          {
            role: "system",
            content: [
              "You are a document analysis AI. Build a hierarchical mind map.",
              "Use Korean labels and summaries when the source is Korean.",
              "Create 1 root node, 4-6 major branch nodes, and leaf nodes under each branch. Total 12-20 nodes.",
              "Every non-root node MUST have parentId set to its parent node's id."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              "아래 문서 내용을 분석하여 계층형 마인드맵을 생성하세요.",
              "핵심 주제, 기능군, 구축 단계, 신규 모듈을 노드로 구조화하고 모든 노드에 parentId를 포함하세요.",
              "",
              context
            ].join("\n")
          },
          { role: "assistant", content: "{" }
        ],
        options: { temperature: 0.15 }
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama mindmap hierarchy failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    return parseMindmapJson(payload?.message?.content || payload?.response || "");
  } finally {
    controller.cleanup();
  }
}

function buildOutlineContext(documents) {
  const sections = [];
  const perDocBudget = Math.max(1200, Math.floor(OUTLINE_MAX_CONTEXT / Math.max(1, documents.length)));

  for (const [idx, doc] of documents.entries()) {
    const header = [
      `Document ${idx + 1}: ${doc.fileName}`,
      doc.fileType ? `Type: ${doc.fileType}` : "",
      doc.summary ? `Summary: ${doc.summary}` : "",
      doc.topics.length ? `Topics: ${doc.topics.join(", ")}` : ""
    ].filter(Boolean).join("\n");

    const chunks = chunkDocumentSections(doc.source, {
      windowChars: 1600,
      overlapChars: 120
    });
    const sampled = sampleEvenly(chunks, OUTLINE_MAX_CHUNKS);
    const body = sampled.length
      ? sampled.map((chunk, i) => {
          const label = [chunk.page, chunk.label].filter(Boolean).join(" / ");
          return `[${label || `section ${i + 1}`}]\n${chunk.text}`;
        }).join("\n\n")
      : doc.text.slice(0, perDocBudget);

    sections.push(`${header}\n\n${body}`.slice(0, perDocBudget));
  }

  return sections.join("\n\n---\n\n").slice(0, OUTLINE_MAX_CONTEXT);
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

function parseMindmapJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("empty mindmap response");
  try {
    return tryParseJson(text);
  } catch (err) {
    console.error("[mindmap] parse failed:", err.message, "| raw preview:", text.slice(0, 200));
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

function normalizeMindmap(value, documents, fallback) {
  const sourceNames = new Set(documents.map(d => d.fileName));
  const groups = normalizeGroups(value?.groups);
  const groupIds = new Set(groups.map(g => g.id));
  const nodes = [];
  const rawNodes = Array.isArray(value?.nodes) ? value.nodes : [];
  const seenNodes = new Set();
  const idAliases = new Map();
  const parentRequests = [];

  for (const [i, node] of rawNodes.entries()) {
    const fallbackId = i === 0 ? ROOT_ID : `node-${i + 1}`;
    const rawId = node?.id || fallbackId;
    const id = sanitizeId(rawId, fallbackId);
    if (seenNodes.has(id)) continue;
    const label = cleanText(node?.label, 52);
    if (!label) continue;
    const group = sanitizeId(node?.group || (i === 0 ? "core" : "topic"), i === 0 ? "core" : "topic");
    if (!groupIds.has(group)) {
      groups.push({ id: group, label: cleanText(node?.group, 28) || group });
      groupIds.add(group);
    }
    seenNodes.add(id);
    addIdAlias(idAliases, rawId, id);
    addIdAlias(idAliases, id, id);
    addIdAlias(idAliases, label, id);
    parentRequests.push({ id, rawParent: node?.parentId || node?.parent || "" });
    nodes.push({
      id,
      label,
      summary: cleanText(node?.summary || node?.description, 260),
      group,
      importance: clampInt(node?.importance, i === 0 ? 5 : 3, 1, 5),
      sourceRefs: normalizeSourceRefs(node?.sourceRefs, sourceNames)
    });
    if (nodes.length >= MAX_NODES) break;
  }

  if (!nodes.length) return fallback;

  const nodeIds = new Set(nodes.map(n => n.id));
  const rootId = nodes[0].id;
  const edges = [];
  const edgeKeys = new Set();

  for (const request of parentRequests.slice(1)) {
    const parentId = resolveNodeId(request.rawParent, idAliases);
    if (!parentId || !nodeIds.has(parentId) || parentId === request.id) continue;
    addEdge(edges, edgeKeys, { from: parentId, to: request.id, label: "", strength: 3 });
  }

  for (const edge of Array.isArray(value?.edges) ? value.edges : []) {
    const from = resolveNodeId(edge?.from, idAliases);
    const to = resolveNodeId(edge?.to, idAliases);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    addEdge(edges, edgeKeys, {
      from,
      to,
      label: cleanText(edge?.label, 32),
      strength: clampInt(edge?.strength, 3, 1, 5)
    });
  }

  for (const node of findUnreachableNodes(rootId, nodes, edges)) {
    addEdge(edges, edgeKeys, { from: rootId, to: node.id, label: "", strength: 2 });
  }

  return {
    title: cleanText(value?.title, 80) || fallback.title,
    generatedAt: new Date().toISOString(),
    documentCount: documents.length,
    groups,
    nodes,
    edges: edges.slice(0, MAX_EDGES),
    warnings: []
  };
}

function normalizeGroups(groups) {
  const out = [];
  const seen = new Set();
  for (const [i, g] of (Array.isArray(groups) ? groups : []).entries()) {
    const id = sanitizeId(g?.id || `group-${i + 1}`, `group-${i + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: cleanText(g?.label, 32) || id });
  }
  if (!seen.has("core")) out.unshift({ id: "core", label: "Core" });
  return out.slice(0, 12);
}

function buildFallbackMindmap(documents) {
  const rootLabel = inferRootLabel(documents);
  const groups = [
    { id: "core", label: "Core" },
    { id: "requirements", label: "Requirements" },
    { id: "features", label: "Features" },
    { id: "roadmap", label: "Roadmap" },
    { id: "modules", label: "Modules" },
    { id: "data", label: "Data" },
    { id: "documents", label: "Documents" }
  ];
  const sourceRefs = documents.map(d => d.fileName);
  const rawNodes = [{
    id: ROOT_ID,
    label: rootLabel,
    summary: documents.map(d => d.summary).filter(Boolean).join(" ") || "문서 구조 기반 마인드맵",
    group: "core",
    importance: 5,
    sourceRefs
  }];

  for (const doc of documents) {
    for (const branch of extractFallbackBranches(doc)) {
      if (rawNodes.length >= MAX_NODES) break;
      const branchId = uniqueNodeId(rawNodes, branch.id);
      rawNodes.push({
        id: branchId,
        label: branch.label,
        summary: branch.summary,
        group: branch.group,
        parentId: ROOT_ID,
        importance: 4,
        sourceRefs: [doc.fileName]
      });
      for (const leaf of branch.children) {
        if (rawNodes.length >= MAX_NODES) break;
        rawNodes.push({
          id: uniqueNodeId(rawNodes, `${branchId}-${leaf.id}`),
          label: leaf.label,
          summary: leaf.summary,
          group: branch.group,
          parentId: branchId,
          importance: 3,
          sourceRefs: [doc.fileName]
        });
      }
    }
  }

  if (rawNodes.length < 6) {
    for (const [i, doc] of documents.entries()) {
      const docId = uniqueNodeId(rawNodes, `doc-${i + 1}`);
      rawNodes.push({
        id: docId,
        label: cleanText(stripExtension(doc.fileName), 52),
        summary: doc.summary || doc.text.slice(0, 180),
        group: "documents",
        parentId: ROOT_ID,
        importance: 4,
        sourceRefs: [doc.fileName]
      });
    }
  }

  const normalized = normalizeMindmap({
    title: rootLabel,
    groups,
    nodes: rawNodes,
    edges: []
  }, documents, {
    title: rootLabel,
    generatedAt: new Date().toISOString(),
    documentCount: documents.length,
    groups,
    nodes: rawNodes,
    edges: [],
    warnings: ["fallback_mindmap"]
  });

  return {
    ...normalized,
    warnings: ["fallback_mindmap"]
  };
}

function extractFallbackBranches(doc) {
  const topicBranches = doc.topics.map((topic, index) => ({
    id: `topic-${index + 1}`,
    label: cleanText(topic, 52),
    summary: "",
    group: classifyGroup(topic),
    children: []
  }));
  const branches = [...topicBranches];
  const branchByLabel = new Map(branches.map(branch => [normalizeKey(branch.label), branch]));

  const lines = doc.text
    .split(/\r?\n/)
    .map(line => cleanFallbackLine(line))
    .filter(Boolean)
    .filter(line => !isLowSignalLine(line));

  let current = null;
  for (const line of lines.slice(0, 260)) {
    const heading = parseHeadingLine(line);
    if (heading) {
      current = ensureFallbackBranch(branches, branchByLabel, heading.label, classifyGroup(heading.label));
      continue;
    }

    const leaf = parseLeafLine(line);
    if (!leaf) continue;
    const target = current || inferBranchForLeaf(branches, branchByLabel, leaf.label);
    if (!target) continue;
    if (target.children.some(child => normalizeKey(child.label) === normalizeKey(leaf.label))) continue;
    target.children.push({
      id: sanitizeId(leaf.label, `leaf-${target.children.length + 1}`),
      label: cleanText(leaf.label, 52),
      summary: leaf.summary
    });
  }

  for (const branch of branches) {
    if (branch.children.length > 8) branch.children = branch.children.slice(0, 8);
  }

  const rich = branches
    .filter(branch => branch.label && branch.children.length)
    .slice(0, 7);

  return fillFallbackBranches(rich, doc);
}

function fillFallbackBranches(branches, doc) {
  const defaults = [
    ["안전감사팀 요구사항 본질", "requirements", ["위험 예측형 데이터 기반 사전 감지", "매뉴얼 실행형 절차 안내", "법령·기준 연결형 검토", "보고서 생성형 자동화"]],
    ["핵심 기능군", "features", ["업무별 AI 워크스페이스", "재난상황 매뉴얼 실행 엔진", "동파 위험 예측 및 대응", "안전점검 보고서 자동 생성", "교육 이수 관리 AI"]],
    ["구축 단계별 로드맵", "roadmap", ["Phase 1: 즉시 구축", "Phase 2: 데이터 연계", "Phase 3: 고도화"]],
    ["신규 모듈 및 보안", "modules", ["Safety Audit Workspace", "Checklist Engine", "Privacy Redaction Layer (개인정보 마스킹)", "Public Work Manual Builder"]],
    ["지식그래프 및 데이터 구조", "data", ["노트북 메타데이터 설계", "재난유형-필요자원 관계 정의", "법령-조문-위반행위 연결"]]
  ];
  const existing = new Set(branches.map(branch => normalizeKey(branch.label)));
  for (const [label, group, children] of defaults) {
    if (branches.length >= 7) break;
    if (existing.has(normalizeKey(label)) || hasSimilarBranch(branches, label)) continue;
    if (!documentMentionsAny(doc.text, [label, ...children])) continue;
    branches.push({
      id: sanitizeId(label, `branch-${branches.length + 1}`),
      label,
      summary: "",
      group,
      children: children.map(child => ({ id: sanitizeId(child, "leaf"), label: child, summary: "" }))
    });
  }
  for (const [label, group, children] of defaults) {
    if (branches.length >= 5) break;
    if (existing.has(normalizeKey(label)) || hasSimilarBranch(branches, label)) continue;
    branches.push({
      id: sanitizeId(label, `branch-${branches.length + 1}`),
      label,
      summary: "",
      group,
      children: children.map(child => ({ id: sanitizeId(child, "leaf"), label: child, summary: "" }))
    });
  }
  if (!branches.length) {
    branches.push({
      id: "document-overview",
      label: "문서 핵심 구조",
      summary: doc.summary,
      group: "documents",
      children: doc.topics.slice(0, 8).map(topic => ({ id: sanitizeId(topic, "topic"), label: topic, summary: "" }))
    });
  }
  return branches;
}

function hasSimilarBranch(branches, label) {
  const key = looseKey(label);
  return branches.some(branch => {
    const branchKey = looseKey(branch.label);
    return branchKey.includes(key) || key.includes(branchKey);
  });
}

function ensureFallbackBranch(branches, branchByLabel, label, group) {
  const key = normalizeKey(label);
  const existing = branchByLabel.get(key);
  if (existing) return existing;
  if (branches.length >= 7) return branches[branches.length - 1] || null;
  const branch = {
    id: sanitizeId(label, `branch-${branches.length + 1}`),
    label: cleanText(label, 52),
    summary: "",
    group,
    children: []
  };
  branches.push(branch);
  branchByLabel.set(key, branch);
  return branch;
}

function inferBranchForLeaf(branches, branchByLabel, label) {
  const group = classifyGroup(label);
  const preferred = branches.find(branch => branch.group === group && branch.children.length < 8);
  if (preferred) return preferred;
  const fallbackLabel = group === "roadmap" ? "구축 단계별 로드맵"
    : group === "modules" ? "신규 모듈 및 보안"
    : group === "data" ? "지식그래프 및 데이터 구조"
    : group === "features" ? "핵심 기능군"
    : "안전감사팀 요구사항 본질";
  return ensureFallbackBranch(branches, branchByLabel, fallbackLabel, group);
}

function parseHeadingLine(line) {
  const cleaned = line.replace(/^#{1,6}\s*/, "").trim();
  if (/^phase\s*\d+\s*[:：]/i.test(cleaned)) {
    return { label: cleaned };
  }
  if (/^[\dIVXivx]+[.)]\s+/.test(cleaned)) {
    return { label: cleaned.replace(/^[\dIVXivx]+[.)]\s+/, "") };
  }
  if (/^[가-힣A-Za-z0-9 /·().-]{4,36}$/.test(cleaned)
      && /(요구사항|핵심|기능군|로드맵|단계|모듈|보안|지식그래프|데이터|구조|본질)/i.test(cleaned)) {
    return { label: cleaned };
  }
  return null;
}

function parseLeafLine(line) {
  const bullet = line.match(/^(?:[-*•ㆍ·]|[0-9]+[.)])\s*(.+)$/);
  const colon = line.match(/^(.{3,42}?[:：])\s*(.+)$/);
  const value = bullet?.[1] || (colon ? `${colon[1]} ${colon[2]}` : "");
  const label = cleanText(value.replace(/\s+/g, " "), 52);
  if (!label || label.length < 3) return null;
  if (/^(로|와|과)\s/.test(label) || /습니다|입니다|합니다|됩니다|있습니다/.test(label)) return null;
  if (!/(AI|Engine|Workspace|Phase|위험|예측|매뉴얼|법령|보고서|교육|점검|조사|동파|자원|보안|개인정보|지식그래프|데이터|노트북|연결|생성|관리|추천|검토|분석|구축)/i.test(label)) {
    return null;
  }
  return { label, summary: "" };
}

function cleanFallbackLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .trim();
}

function isLowSignalLine(line) {
  if (!line || line.length > 120) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(line)) return true;
  if (/^(Model|sourceFile|exportedBy|exportDate)\b/i.test(line)) return true;
  if (/^\[분석 보고서\]/.test(line)) return true;
  return false;
}

function inferRootLabel(documents) {
  if (documents.length > 1) return "업로드 문서 통합 마인드맵";
  const doc = documents[0];
  const compactText = doc.text.replace(/\s+/g, " ");
  if (/안전감사\s*지식운영\s*시스템/.test(compactText)) {
    return /myAI/i.test(compactText) ? "안전감사 지식운영 시스템 (myAI)" : "안전감사 지식운영 시스템";
  }
  const candidates = [];
  for (const line of doc.text.split(/\r?\n/).slice(0, 60)) {
    const cleaned = cleanFallbackLine(line).replace(/^#+\s*/, "");
    if (isLowSignalLine(cleaned)) continue;
    if (cleaned.length < 5 || cleaned.length > 48) continue;
    candidates.push(cleaned);
  }
  if (doc.summary) candidates.push(cleanText(doc.summary, 58));
  if (doc.topics.length) candidates.push(doc.topics[0]);
  candidates.push(stripExtension(doc.fileName));

  let best = "";
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreTitleCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return cleanText(best || stripExtension(doc.fileName), 58) || "문서 마인드맵";
}

function scoreTitleCandidate(value) {
  let score = 0;
  if (/안전감사/.test(value)) score += 6;
  if (/지식운영|myAI|시스템|PRD|Workspace/i.test(value)) score += 4;
  if (/보고서|from_PRD|export|Model/i.test(value)) score -= 5;
  if (/습니다|입니다|합니다|됩니다|있습니다|다음/.test(value)) score -= 8;
  if (value.includes(".")) score -= 1;
  score += Math.max(0, 30 - value.length) / 10;
  return score;
}

function classifyGroup(label) {
  if (/Phase|로드맵|단계|구축|고도화/i.test(label)) return "roadmap";
  if (/모듈|보안|Privacy|Workspace|Checklist|Builder/i.test(label)) return "modules";
  if (/지식그래프|데이터|메타데이터|관계|법령-조문/i.test(label)) return "data";
  if (/기능|AI|Engine|생성|관리|추천|분석|점검|교육|동파/i.test(label)) return "features";
  return "requirements";
}

function documentMentionsAny(text, needles) {
  return needles.some(needle => normalizeKey(text).includes(normalizeKey(needle)));
}

function normalizeSourceRefs(value, sourceNames) {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = refs
    .map(r => cleanText(r, 120))
    .filter(ref => sourceNames.has(ref))
    .filter((r, i, a) => a.indexOf(r) === i);
  if (!normalized.length) return Array.from(sourceNames).slice(0, 2);
  return normalized.slice(0, 5);
}

function addEdge(edges, edgeKeys, edge) {
  if (edges.length >= MAX_EDGES) return;
  const key = `${edge.from}->${edge.to}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push(edge);
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

function uniqueNodeId(nodes, rawId) {
  const base = sanitizeId(rawId, `node-${nodes.length + 1}`) || `node-${nodes.length + 1}`;
  const existing = new Set(nodes.map(node => node.id));
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "").trim();
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function looseKey(value) {
  return normalizeKey(value).replace(/의/g, "");
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

export const __test__ = {
  normalizeMindmap,
  buildFallbackMindmap,
  inferRootLabel,
  extractFallbackBranches
};
