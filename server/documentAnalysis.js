import { loadLocalEnv } from "./env.js";
import { analysisQueue } from "./modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const ENABLED = String(process.env.DOC_ANALYSIS_ENABLED ?? "true").toLowerCase() !== "false";
const MAX_INPUT_CHARS = clampInt(process.env.DOC_ANALYSIS_MAX_INPUT_CHARS, 12000, 1000, 60000);
const TIMEOUT_MS = clampInt(process.env.DOC_ANALYSIS_TIMEOUT_MS, 30000, 2000, 120000);
const MAX_TOPICS = 8;
const SUMMARY_HEAD_RATIO = 0.6;

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const EMPTY_RESULT = Object.freeze({ summary: "", topics: [] });

/**
 * Generate a short Korean summary and topic keywords for an uploaded document.
 * Returns { summary: string, topics: string[] }. On any failure (disabled,
 * timeout, parse error, no body text) returns the empty result so callers can
 * persist documents without analysis without special-casing.
 */
export async function analyzeDocument(parsedDocument, { model = DEFAULT_MODEL } = {}) {
  if (!ENABLED) return EMPTY_RESULT;
  if (!parsedDocument || parsedDocument.kind !== "document") return EMPTY_RESULT;

  const body = extractAnalyzableText(parsedDocument);
  if (!body) return EMPTY_RESULT;

  const sample = sampleHeadAndTail(body, MAX_INPUT_CHARS);
  const fileLabel = String(parsedDocument.fileName ?? "untitled").slice(0, 200);
  const fileType = String(parsedDocument.fileType ?? "").slice(0, 16);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await analysisQueue.run(() => fetch(`${OLLAMA_URL}/api/chat`, {
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
              "You analyze uploaded documents for a Korean RAG assistant.",
              "Return only strict JSON of the form: {\"summary\": \"...\", \"topics\": [\"...\", \"...\"]}",
              "summary: 한국어 2~4문장, 문서가 무엇이고 어떤 정보를 담고 있는지 구체적으로 서술. 추측·일반론 금지.",
              "summary 안에는 마크다운, 따옴표 강조, 줄바꿈을 넣지 마라. 평문으로 작성.",
              `topics: 문서의 핵심 키워드/엔티티/주요 개념 ${MAX_TOPICS}개 이내. 각 항목은 한국어 단어 또는 짧은 명사구.`,
              "topics는 빈도가 아니라 의미적 중요도 순으로 정렬.",
              "본문에 명시된 정보만 사용하고, 본문에 없는 사실을 추가하지 마라.",
              "출력에 다른 키, 설명, 코드블록, 마크다운을 포함하지 마라."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `파일명: ${fileLabel}`,
              fileType ? `파일 형식: ${fileType}` : "",
              "",
              "본문 (앞·뒤 일부 발췌):",
              sample,
              "",
              "위 문서를 요약하고 핵심 토픽을 JSON으로 반환하세요."
            ].filter(Boolean).join("\n")
          }
        ],
        options: { temperature: 0.2, top_p: 0.9 }
      })
    }), {
      signal: controller.signal,
      label: "document_analysis"
    });

    if (!response.ok) return EMPTY_RESULT;
    const payload = await response.json();
    return parseAnalysis(payload.message?.content ?? "");
  } catch {
    return EMPTY_RESULT;
  } finally {
    clearTimeout(timer);
  }
}

function extractAnalyzableText(documentItem) {
  if (typeof documentItem.text === "string" && documentItem.text.trim()) {
    return documentItem.text.trim();
  }
  const pageText = (documentItem.pages || [])
    .map((page) => String(page.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (pageText) return pageText;
  const sheetText = (documentItem.sheets || [])
    .map((sheet) => String(sheet.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return sheetText;
}

function sampleHeadAndTail(text, budget) {
  if (text.length <= budget) return text;
  const headChars = Math.floor(budget * SUMMARY_HEAD_RATIO);
  const tailChars = budget - headChars;
  return `${text.slice(0, headChars)}\n\n[... 중간 생략 ...]\n\n${text.slice(-tailChars)}`;
}

function parseAnalysis(rawContent) {
  const text = String(rawContent ?? "").trim();
  if (!text) return EMPTY_RESULT;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_RESULT;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_RESULT;

  const summary = cleanSummary(parsed.summary ?? parsed.요약 ?? "");
  const topics = cleanTopics(parsed.topics ?? parsed.keywords ?? parsed.키워드 ?? []);
  if (!summary && !topics.length) return EMPTY_RESULT;

  return { summary, topics };
}

function cleanSummary(value) {
  return String(value ?? "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function cleanTopics(value) {
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const topics = [];
  for (const entry of list) {
    const cleaned = String(entry ?? "")
      .replace(/^["'`#\-*\s]+|["'`\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(cleaned);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

export const DOC_ANALYSIS_ENABLED = ENABLED;
export const DOC_ANALYSIS_MAX_INPUT_CHARS = MAX_INPUT_CHARS;
