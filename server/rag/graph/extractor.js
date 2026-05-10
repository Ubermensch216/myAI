import {
  ENTITY_TYPES,
  ENTITY_TYPE_DESCRIPTIONS,
  RELATION_TYPES,
  isValidEntityType,
  isValidRelationType
} from "./ontology.js";
import { loadLocalEnv } from "../../env.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.KG_EXTRACT_MODEL || "gemma4:e2b";
const DEFAULT_TEMPERATURE = Number(process.env.KG_EXTRACT_TEMPERATURE || 0.1);
const DEFAULT_TIMEOUT_MS = Number(process.env.KG_EXTRACT_TIMEOUT_MS || 180000);
const MAX_CHUNK_TEXT = Number(process.env.KG_EXTRACT_MAX_CHARS || 4000);
const CONFIDENCE_INSTRUCTION = [
  "Return a confidence field for every entity and relation.",
  "The confidence must be a number from 0.0 to 1.0.",
  "Use lower confidence when the evidence is short, ambiguous, or indirectly implied."
].join("\n");

function buildSystemPrompt() {
  const entityList = ENTITY_TYPES.map((t) => `${t}=${ENTITY_TYPE_DESCRIPTIONS[t]}`).join("\n  ");
  const relationList = RELATION_TYPES.map((r) => `${r.id}=${r.label}`).join(", ");
  return [
    "당신은 한국어 행정/법령 문서에서 지식그래프를 추출하는 전문가입니다.",
    "주어진 문서 조각에서 엔티티(개체)와 관계만 추출해 JSON으로 반환하세요.",
    "",
    "**엔티티 타입 (반드시 이 목록만 사용):**",
    "  " + entityList,
    "",
    "**관계 타입 (반드시 이 목록만 사용):** " + relationList,
    "",
    "**규칙(엄수):**",
    "1. 엔티티 type과 관계 type은 위 목록에 있는 식별자(영문)만 사용. 새로 만들지 말 것.",
    "2. 추측하지 말고 원문에 명시된 관계만 추출하세요.",
    "3. 각 엔티티/관계마다 evidence(원문 인용 80자 이내)를 반드시 포함하세요.",
    "4. 일반 단어(예: '공무원', '규정')만 추출하지 말고 구체적 명칭을 추출하세요.",
    "5. 출력은 오직 JSON만. 설명·마크다운·주석 금지.",
    "",
    "**JSON 스키마:**",
    "{",
    '  "entities": [',
    '    { "tempId": "e1", "type": "<EntityType>", "label": "<한글명>", "aliases": ["<별칭>"], "evidence": "<원문 인용>" }',
    "  ],",
    '  "relations": [',
    '    { "src": "e1", "dst": "e2", "type": "<RELATION_TYPE>", "evidence": "<원문 인용>" }',
    "  ]",
    "}"
  ].join("\n");
}

function buildUserPrompt(chunkText) {
  return [
    "다음 문서 조각을 분석하여 위 규칙에 따른 JSON을 반환하세요.",
    "",
    "<문서조각>",
    chunkText.trim(),
    "</문서조각>"
  ].join("\n");
}

export function parseExtractionJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateExtraction(parsed) {
  const entities = [];
  const relations = [];
  const tempIdMap = new Map();
  if (Array.isArray(parsed?.entities)) {
    for (const e of parsed.entities) {
      if (!e || typeof e !== "object") continue;
      const type = String(e.type || "").trim();
      const label = String(e.label || "").trim();
      if (!isValidEntityType(type)) continue;
      if (!label || label.length > 80) continue;
      const tempId = String(e.tempId || `e${entities.length + 1}`);
      const aliases = Array.isArray(e.aliases)
        ? e.aliases.map(String).map((s) => s.trim()).filter((s) => s && s.length <= 80).slice(0, 6)
        : [];
      const evidence = String(e.evidence || "").slice(0, 200);
      const confidence = Number.isFinite(Number(e.confidence))
        ? Math.max(0, Math.min(1, Number(e.confidence)))
        : null;
      const cleaned = { tempId, type, label, aliases, evidence, confidence };
      tempIdMap.set(tempId, cleaned);
      entities.push(cleaned);
    }
  }
  if (Array.isArray(parsed?.relations)) {
    for (const r of parsed.relations) {
      if (!r || typeof r !== "object") continue;
      const type = String(r.type || "").trim();
      if (!isValidRelationType(type)) continue;
      const src = String(r.src || "").trim();
      const dst = String(r.dst || "").trim();
      if (!tempIdMap.has(src) || !tempIdMap.has(dst)) continue;
      if (src === dst) continue;
      const evidence = String(r.evidence || "").slice(0, 200);
      const confidence = Number.isFinite(Number(r.confidence))
        ? Math.max(0, Math.min(1, Number(r.confidence)))
        : null;
      relations.push({ src, dst, type, evidence, confidence });
    }
  }
  return { entities, relations };
}

export async function extractFromChunkText({
  chunkText,
  model = DEFAULT_MODEL,
  temperature = DEFAULT_TEMPERATURE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
} = {}) {
  if (!chunkText || !chunkText.trim()) {
    return { ok: false, reason: "empty_chunk", entities: [], relations: [] };
  }
  const trimmed = chunkText.trim().slice(0, MAX_CHUNK_TEXT);
  const body = {
    model,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: `${buildSystemPrompt()}\n\n${CONFIDENCE_INSTRUCTION}` },
      { role: "user", content: buildUserPrompt(trimmed) }
    ],
    options: { temperature, top_p: 0.8 }
  };

  const externalSignal = signal || null;
  const ctrl = externalSignal ? null : new AbortController();
  const finalSignal = externalSignal || ctrl.signal;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: finalSignal
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: err.name === "AbortError" ? "timeout" : "fetch_failed", error: err.message, entities: [], relations: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    return { ok: false, reason: `ollama_${response.status}`, error: err.slice(0, 200), entities: [], relations: [] };
  }
  const payload = await response.json();
  const raw = payload.message?.content || "";
  const parsed = parseExtractionJson(raw);
  if (!parsed) return { ok: false, reason: "parse_failure", raw: raw.slice(0, 400), entities: [], relations: [] };
  const validated = validateExtraction(parsed);
  return {
    ok: true,
    model,
    entities: validated.entities,
    relations: validated.relations,
    rawByteSize: raw.length
  };
}
