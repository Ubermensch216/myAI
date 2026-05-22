import { createLinkedAbortController, throwIfAborted } from "../abort.js";
import { analysisQueue } from "../modelQueue.js";
import { DEFAULT_MODEL, OLLAMA_URL } from "../ollama.js";

const ACTIONS = new Set(["rewrite", "summarize", "shorten", "expand", "tone"]);
const TONES = new Set(["official", "report", "plain", "friendly"]);
const TARGET_TYPES = new Set(["heading", "paragraph", "list", "checklist", "table_cell", "raw"]);
const TIMEOUT_MS = clampInt(process.env.STUDIO_DOCUMENT_AI_EDIT_TIMEOUT_MS, 120_000, 10_000, 600_000);
const MAX_TEXT_CHARS = clampInt(process.env.STUDIO_DOCUMENT_AI_EDIT_MAX_CHARS, 12_000, 200, 60_000);
const MAX_CONTEXT_CHARS = 2_000;
const CITATION_RE = /\[(?:AI-L|L-S|[NLPDIROW])\d+\]/g;

const ACTION_LABELS = Object.freeze({
  rewrite: "재작성",
  summarize: "요약",
  shorten: "더 짧게",
  expand: "더 길게",
  tone: "어조 변경"
});

const TONE_LABELS = Object.freeze({
  official: "공문체",
  report: "보고서체",
  plain: "간결한 설명체",
  friendly: "친절한 안내체"
});

const TARGET_LABELS = Object.freeze({
  heading: "제목",
  paragraph: "문단",
  list: "목록",
  checklist: "체크리스트",
  table_cell: "표 셀",
  raw: "원문 블록"
});

export async function editDocumentBlock(input = {}) {
  throwIfAborted(input.signal);
  const request = normalizeAiEditRequest(input);
  let parsed;
  try {
    parsed = await analysisQueue.run(
      () => callOllamaForAiEdit(request),
      { signal: request.signal, label: "studio_document_ai_edit" }
    );
  } catch (error) {
    if (/queue is full/i.test(String(error?.message || ""))) error.statusCode = 429;
    throw error;
  }
  return postProcessAiEditResult(parsed, request);
}

function normalizeAiEditRequest(input) {
  const action = String(input.action || "").trim();
  if (!ACTIONS.has(action)) throw clientError("지원하지 않는 AI 편집 작업입니다.", "INVALID_ACTION");

  const targetType = String(input.targetType || "").trim();
  if (!TARGET_TYPES.has(targetType)) throw clientError("지원하지 않는 편집 대상입니다.", "INVALID_TARGET");

  const tone = String(input.tone || "").trim();
  if (action === "tone" && !TONES.has(tone)) {
    throw clientError("지원하지 않는 어조입니다.", "INVALID_TONE");
  }

  const text = sanitizeMultiline(input.text, MAX_TEXT_CHARS);
  if (!text) throw clientError("편집할 내용이 없습니다.", "EMPTY_TEXT");

  return {
    action,
    tone: TONES.has(tone) ? tone : "",
    targetType,
    text,
    documentTitle: sanitizeInline(input.documentTitle, 200),
    contextBefore: sanitizeMultiline(input.contextBefore, MAX_CONTEXT_CHARS),
    contextAfter: sanitizeMultiline(input.contextAfter, MAX_CONTEXT_CHARS),
    model: sanitizeInline(input.model, 120) || DEFAULT_MODEL,
    signal: input.signal
  };
}

async function callOllamaForAiEdit(request) {
  const controller = createLinkedAbortController(
    request.signal,
    TIMEOUT_MS,
    "Studio document AI edit timed out."
  );
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(request) }
        ],
        options: { temperature: 0.2 }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`Ollama AI edit failed: ${response.status} ${text.slice(0, 160)}`.trim());
      error.statusCode = response.status >= 500 ? 502 : response.status;
      throw error;
    }
    const payload = await response.json();
    const raw = payload?.message?.content || payload?.response || "";
    return parseAiEditJson(raw);
  } catch (error) {
    if (error?.name !== "AbortError" && !error.statusCode && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String(error?.message || ""))) {
      error.statusCode = 502;
    }
    throw error;
  } finally {
    controller.cleanup();
  }
}

function buildSystemPrompt() {
  return [
    "You edit one selected block inside a Korean public-sector work document.",
    "Return strict JSON only. No markdown fences, no surrounding prose.",
    "",
    "Output schema:",
    "{ \"text\": string, \"warnings\": string[] }",
    "",
    "Rules:",
    "- Edit only the selected target text. Use surrounding context only for continuity.",
    "- Preserve every citation marker from the selected text exactly, including [N1], [L1], [P1], [D1], [I1], [R1], [O1], [W1], [AI-L1], and [L-S1].",
    "- Do not create citation markers that are not present in the selected text.",
    "- Do not invent facts, legal grounds, dates, or cited sources.",
    "- Write in Korean unless the selected text is clearly not Korean.",
    "- For heading and table_cell targets, return one concise line.",
    "- For list and checklist targets, return one item per line without bullet symbols or checkbox marks."
  ].join("\n");
}

function buildUserPrompt(request) {
  const action = ACTION_LABELS[request.action] || request.action;
  const tone = request.action === "tone" ? ` (${TONE_LABELS[request.tone] || request.tone})` : "";
  const target = TARGET_LABELS[request.targetType] || request.targetType;
  const markers = collectCitationMarkers(request.text);
  return [
    `문서 제목: ${request.documentTitle || "(제목 없음)"}`,
    `대상: ${target}`,
    `작업: ${action}${tone}`,
    `보존해야 할 인용 마커: ${markers.length ? markers.join(" ") : "(없음)"}`,
    "",
    "앞 문맥:",
    "<<<CONTEXT_BEFORE",
    request.contextBefore || "(없음)",
    "CONTEXT_BEFORE",
    "",
    "선택한 원문:",
    "<<<TARGET_TEXT",
    request.text,
    "TARGET_TEXT",
    "",
    "뒤 문맥:",
    "<<<CONTEXT_AFTER",
    request.contextAfter || "(없음)",
    "CONTEXT_AFTER",
    "",
    "위 작업을 수행한 결과만 JSON으로 반환하세요."
  ].join("\n");
}

function parseAiEditJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("AI 편집 응답이 비어 있습니다.");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try { parsed = JSON.parse(fenced); } catch { parsed = null; }
    }
    if (!parsed) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { parsed = JSON.parse(text.slice(first, last + 1)); } catch { parsed = null; }
      }
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 편집 응답을 JSON으로 해석하지 못했습니다.");
  }
  return {
    text: String(parsed.text || "").trim(),
    warnings: normalizeWarnings(parsed.warnings)
  };
}

function postProcessAiEditResult(parsed, request) {
  const warnings = [...(parsed.warnings || [])];
  let text = cleanTargetText(parsed.text, request.targetType);
  if (!text) {
    text = cleanTargetText(request.text, request.targetType);
    warnings.push("AI가 빈 결과를 반환해 원문을 유지했습니다. 다시 생성하면 다른 결과를 받을 수 있습니다.");
  }
  if (!hasEnoughKeywordOverlap(request.text, text, request.action)) {
    text = cleanTargetText(request.text, request.targetType);
    warnings.push("AI 결과가 원문의 핵심 내용을 충분히 보존하지 않아 원문을 유지했습니다.");
  }

  const originalMarkers = collectCitationMarkers(request.text);
  const resultMarkers = collectCitationMarkers(text);
  const extraMarkers = resultMarkers.filter((marker) => !originalMarkers.includes(marker));
  if (extraMarkers.length) {
    for (const marker of extraMarkers) {
      text = text.split(marker).join("");
    }
    text = cleanTargetText(text, request.targetType);
    warnings.push(`원문에 없던 인용 마커를 제거했습니다: ${extraMarkers.join(" ")}`);
  }

  const repairedMarkers = collectCitationMarkers(text);
  const missingMarkers = originalMarkers.filter((marker) => !repairedMarkers.includes(marker));
  if (missingMarkers.length) {
    text = cleanTargetText(`${text} ${missingMarkers.join(" ")}`, request.targetType);
    warnings.push(`누락된 원문 인용 마커를 결과 끝에 보존했습니다: ${missingMarkers.join(" ")}`);
  }

  return { text, warnings };
}

function cleanTargetText(value, targetType) {
  let text = String(value || "")
    .replace(/```(?:\w+)?/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (targetType === "heading" || targetType === "table_cell") {
    text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  }
  if (targetType === "list" || targetType === "checklist") {
    text = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/, "").trim())
      .filter(Boolean)
      .join("\n");
  }
  return text;
}

function normalizeWarnings(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function hasEnoughKeywordOverlap(original, result, action) {
  const terms = extractKeyTerms(original);
  if (terms.length < 6) return true;
  const resultText = String(result || "");
  const kept = terms.filter((term) => resultText.includes(term)).length;
  const ratio = kept / terms.length;
  if (action === "summarize" || action === "shorten") return ratio >= 0.25;
  if (action === "expand") return ratio >= 0.35;
  return ratio >= 0.45;
}

function extractKeyTerms(text) {
  const stopwords = new Set([
    "대한", "관련", "결과", "이에", "대한", "구체적인", "검토", "필요하다",
    "그리고", "또는", "등에", "다수의", "존재하며", "방식"
  ]);
  const seen = new Set();
  const terms = [];
  const matches = String(text || "").match(/[A-Za-z][A-Za-z0-9_-]{2,}|[가-힣A-Za-z0-9]{3,}/g) || [];
  for (const raw of matches) {
    const term = raw.trim();
    if (!term || stopwords.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= 24) break;
  }
  return terms;
}

function collectCitationMarkers(text) {
  const seen = new Set();
  const markers = [];
  for (const match of String(text || "").matchAll(CITATION_RE)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      markers.push(match[0]);
    }
  }
  return markers;
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

function clientError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
