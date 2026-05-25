import { loadLocalEnv } from "../env.js";
import { createLinkedAbortController, throwIfAborted } from "../abort.js";
import { analysisQueue } from "../modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const TIMEOUT_MS = clampInt(process.env.LAW_WORKBENCH_REVIEW_TIMEOUT_MS, 300_000, 5_000, 600_000);
const MAX_PROMPT_CHARS = clampInt(process.env.LAW_WORKBENCH_REVIEW_MAX_PROMPT_CHARS, 90000, 10000, 200000);
const MAX_DOCUMENT_CHARS = clampInt(process.env.LAW_WORKBENCH_REVIEW_DOCUMENT_CHARS, 16000, 1000, 60000);
const OLLAMA_NUM_CTX = clampInt(process.env.LAW_WORKBENCH_REVIEW_NUM_CTX || process.env.OLLAMA_NUM_CTX, 0, 0, 131072);

const DISCLAIMER = "이 검토는 제공된 검토 대상 문서와 공식 법령 정보를 기반으로 한 업무 참고용 검토 초안입니다. 최종 법률 판단은 관련 부서 또는 전문가 검토가 필요합니다.";

export async function runLawWorkbenchReview({ query = "", conditions = {}, workbench = {}, documents = [], model = DEFAULT_MODEL } = {}, { signal } = {}) {
  throwIfAborted(signal);
  const prompt = buildLawWorkbenchReviewPrompt({ query, conditions, workbench, documents });
  const diagnostics = buildReviewDiagnostics({ prompt, model, workbench, documents });
  const raw = await analysisQueue.run(
    () => callOllamaForReview({ prompt, model, signal, diagnostics }),
    { signal, label: "law_workbench_review" }
  );
  return normalizeReviewResult(raw);
}

export function buildLawWorkbenchReviewPrompt({ query = "", conditions = {}, workbench = {}, documents = [] } = {}) {
  const lines = [
    "[검토 목적]",
    "공식근거와 사용자가 제공한 검토 대상 문서만 사용해 법령 검토보고서 초안을 작성한다.",
    "최종 법률 판단이 아니라 담당자 검토용 업무 참고 초안으로 작성한다.",
    "",
    "[사용자 검토 요청]",
    clean(query) || "(입력 없음)",
    "",
    "[상세 조건]",
    `- 검토 유형: ${clean(conditions.reviewType) || "general"}`,
    `- 산출물 유형: ${clean(conditions.outputType) || "law_review_opinion"}`,
    `- 추가 조건: ${clean(conditions.detail, 1200) || "없음"}`,
    "",
    "[검토 대상 문서]",
    formatDocuments(documents),
    "",
    "[공식근거]",
    formatWorkbenchEvidence(workbench),
    "",
    "[작성 규칙]",
    "- 제공된 공식근거와 검토 대상 문서 밖의 사실을 만들지 않는다.",
    "- 법령, 판례, 해석례, 행정규칙, 자치법규는 제공된 근거만 인용한다.",
    "- 근거가 부족한 항목은 판단 보류 또는 추가 확인 필요로 표시한다.",
    "- 주요 검토 의견은 문서 근거 또는 공식 법령 근거와 연결한다.",
    "- 한국어로 작성한다.",
    "",
    "[출력 JSON 스키마]",
    JSON.stringify({
      summary: "string",
      issues: ["string"],
      facts: ["string"],
      legalGrounds: ["string"],
      analysis: ["string"],
      risks: ["string"],
      recommendations: ["string"],
      missingEvidence: ["string"],
      draftOpinion: "string",
      disclaimer: DISCLAIMER
    }, null, 2)
  ];
  return lines.join("\n").slice(0, MAX_PROMPT_CHARS);
}

function formatDocuments(documents) {
  const list = Array.isArray(documents) ? documents : [];
  if (!list.length) return "검토 대상 문서가 제공되지 않았습니다.";
  return list.slice(0, 8).map((doc, index) => {
    const text = sampleDocumentText(doc, Math.floor(MAX_DOCUMENT_CHARS / Math.max(1, Math.min(list.length, 8))));
    return [
      `## D${index + 1}. ${clean(doc.fileName || doc.displayName || "uploaded-document")}`,
      doc.summary ? `요약: ${clean(doc.summary, 800)}` : "",
      text ? `본문 발췌:\n${text}` : "본문 발췌 없음"
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function formatWorkbenchEvidence(workbench = {}) {
  const blocks = [
    formatArticle(workbench.article),
    formatList("별표/서식", workbench.annexes?.items),
    formatStructure(workbench.structure),
    formatList("위임/하위법령", workbench.delegated?.items),
    formatList("자치법규", workbench.ordinances?.items),
    formatDecisions(workbench.decisions),
    formatHistory(workbench.history),
    workbench.internalImpact?.summary ? `## 내부자료 영향\n${clean(workbench.internalImpact.summary, 1000)}` : ""
  ].filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : "공식근거가 충분히 확인되지 않았습니다.";
}

function formatArticle(article) {
  if (!article?.ok && !article?.text) return "";
  const locator = article.citation?.locator || article.citation?.title || "조문";
  return `## 조문 본문\n${clean(locator)}\n${clean(article.text, 6000)}`;
}

function formatStructure(structure) {
  const tiers = structure?.tiers;
  if (!tiers) return "";
  if (Array.isArray(tiers)) return formatList("법체계", tiers);
  return `## 법체계\n${Object.entries(tiers).map(([key, value]) => `- ${key}: ${itemLabel(value)}`).join("\n")}`;
}

function formatDecisions(decisions = {}) {
  return [
    formatList("판례", decisions.precedents?.items),
    formatList("해석례", decisions.interpretations?.items),
    formatList("행정규칙", decisions.adminRules?.items)
  ].filter(Boolean).join("\n\n");
}

function formatHistory(history = {}) {
  const revisions = Array.isArray(history.revisions) ? history.revisions : [];
  if (!revisions.length) return "";
  return `## 개정 이력\n${revisions.slice(0, 8).map((item) => `- ${item.effectiveDate || ""} ${item.revisionType || ""}`.trim()).join("\n")}`;
}

function formatList(title, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  return `## ${title}\n${list.slice(0, 8).map((item) => `- ${itemLabel(item)}`).join("\n")}`;
}

function itemLabel(item = {}) {
  if (!item || typeof item !== "object") return clean(item);
  return clean([item.title, item.lawName, item.name, item.caseNumber, item.locator, item.effectiveDate].filter(Boolean).join(" / ") || JSON.stringify(item).slice(0, 240));
}

async function callOllamaForReview({ prompt, model, signal, diagnostics }) {
  const controller = createLinkedAbortController(signal, TIMEOUT_MS, "Law workbench review timed out.");
  const startedAt = Date.now();
  logReviewEvent("request", {
    ...diagnostics,
    timeoutMs: TIMEOUT_MS,
    maxPromptChars: MAX_PROMPT_CHARS,
    numCtx: OLLAMA_NUM_CTX || null,
    promptVsCtxRatio: OLLAMA_NUM_CTX ? round(diagnostics.estimatedTokens / OLLAMA_NUM_CTX, 3) : null
  });
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
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: prompt }
        ],
        options: {
          temperature: 0.1,
          ...(OLLAMA_NUM_CTX ? { num_ctx: OLLAMA_NUM_CTX } : {})
        }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logReviewEvent("error", {
        ...diagnostics,
        elapsedMs: Date.now() - startedAt,
        status: response.status,
        error: text.slice(0, 160)
      });
      throw new Error(`Ollama law review failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }
    const payload = await response.json();
    const raw = payload?.message?.content || payload?.response || "";
    logReviewEvent("response", {
      ...diagnostics,
      elapsedMs: Date.now() - startedAt,
      prompt_eval_count: payload.prompt_eval_count ?? null,
      eval_count: payload.eval_count ?? null,
      totalDurationMs: nsToMs(payload.total_duration),
      loadDurationMs: nsToMs(payload.load_duration),
      promptEvalDurationMs: nsToMs(payload.prompt_eval_duration),
      evalDurationMs: nsToMs(payload.eval_duration),
      responseChars: String(raw || "").length
    });
    return parseJson(raw);
  } catch (error) {
    if (error?.name === "AbortError" || /timed out/i.test(error?.message || "")) {
      logReviewEvent("timeout", {
        ...diagnostics,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: TIMEOUT_MS,
        error: error.message || "aborted"
      });
    } else if (!error?.message?.startsWith("Ollama law review failed:")) {
      logReviewEvent("error", {
        ...diagnostics,
        elapsedMs: Date.now() - startedAt,
        error: error?.message || String(error)
      });
    }
    throw error;
  } finally {
    controller.cleanup();
  }
}

function buildReviewDiagnostics({ prompt, model, workbench = {}, documents = [] }) {
  const promptChars = String(prompt || "").length;
  return {
    model,
    promptChars,
    estimatedTokens: estimateTokenCount(prompt),
    documentCount: Array.isArray(documents) ? documents.length : 0,
    articleChars: String(workbench?.article?.text || "").length,
    aiCandidates: count(workbench?.aiCandidates?.items),
    annexes: count(workbench?.annexes?.items),
    delegated: count(workbench?.delegated?.items),
    ordinances: count(workbench?.ordinances?.items),
    precedents: count(workbench?.decisions?.precedents?.items),
    interpretations: count(workbench?.decisions?.interpretations?.items),
    adminRules: count(workbench?.decisions?.adminRules?.items),
    historyRevisions: count(workbench?.history?.revisions)
  };
}

export function estimateTokenCount(value) {
  const text = String(value || "");
  if (!text) return 0;
  const cjk = (text.match(/[\u3131-\uD79D]/g) || []).length;
  const ascii = (text.match(/[A-Za-z0-9]/g) || []).length;
  const other = Math.max(0, text.length - cjk - ascii);
  // Conservative approximation for mixed Korean/legal text.
  return Math.ceil(cjk * 0.75 + ascii / 4 + other / 2);
}

function logReviewEvent(event, payload) {
  console.info(`[law-workbench-review] ${JSON.stringify({ event, ...payload })}`);
}

function nsToMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number / 1_000_000) : null;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildSystemPrompt() {
  return [
    "You write Korean public-sector legal review working drafts.",
    "Use only the provided official evidence and review documents.",
    "Do not invent statutes, cases, interpretations, administrative rules, ordinances, facts, citations, or document content.",
    "If evidence is insufficient, mark the item as 판단 보류 or 추가 확인 필요.",
    "Return strict JSON only. No markdown fences."
  ].join("\n");
}

export function normalizeReviewResult(value = {}) {
  const result = unwrapReviewResult(value);
  return {
    summary: clean(pickValue(result, ["summary", "검토 요약", "검토요약", "요약"]), 1600) || "검토 요약을 생성하지 못했습니다.",
    issues: normalizeStringArray(pickValue(result, ["issues", "keyIssues", "key_issues", "핵심 쟁점", "주요 쟁점", "쟁점"])),
    facts: normalizeStringArray(pickValue(result, ["facts", "confirmedFacts", "confirmed_facts", "확인된 사실", "사실관계", "검토 대상 사실"])),
    legalGrounds: normalizeStringArray(pickValue(result, ["legalGrounds", "legal_grounds", "grounds", "적용 법령 및 근거", "적용 법령", "법령 근거", "근거 조문", "공식근거"])),
    analysis: normalizeStringArray(pickValue(result, ["analysis", "opinion", "reviewOpinion", "review_opinion", "검토 의견", "검토의견", "법령 검토 의견"])),
    risks: normalizeStringArray(pickValue(result, ["risks", "risk", "legalRisks", "legal_risks", "리스크", "법적 리스크", "위험"])),
    recommendations: normalizeStringArray(pickValue(result, ["recommendations", "actions", "보완 권고", "권고", "조치사항", "개선 권고"])),
    missingEvidence: normalizeStringArray(pickValue(result, ["missingEvidence", "missing_evidence", "additionalChecks", "additional_checks", "추가 확인 필요", "추가확인", "보완 필요 자료"])),
    draftOpinion: clean(pickValue(result, ["draftOpinion", "draft_opinion", "검토의견 초안", "의견서 초안", "초안"]), 4000) || "공식근거와 검토 대상 문서를 기준으로 추가 검토가 필요합니다.",
    disclaimer: clean(pickValue(result, ["disclaimer", "notice", "고지", "유의사항"]), 1000) || DISCLAIMER
  };
}

function unwrapReviewResult(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  for (const candidate of [value.reviewResult, value.result, value.review, value.data]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return value;
}

function pickValue(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    if (Object.hasOwn(source, key) && source[key] != null && source[key] !== "") return source[key];
  }
  return "";
}

function objectToReadableString(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return JSON.stringify(obj);
  const LABEL_KEYS = ["point", "risk_area", "area", "title", "name", "label", "category", "항목"];
  const TEXT_KEYS = ["detail", "details", "text", "content", "description", "summary", "value", "body"];
  const EXTRA_KEYS = ["risk", "note", "비고"];
  const label = LABEL_KEYS.map((k) => obj[k]).find((v) => v && typeof v === "string");
  const text = TEXT_KEYS.map((k) => obj[k]).find((v) => v && typeof v === "string");
  const extra = EXTRA_KEYS.map((k) => obj[k]).find((v) => v && typeof v === "string");
  const parts = [];
  if (label) parts.push(label);
  if (text) parts.push(text);
  if (extra) parts.push(`(${extra})`);
  if (parts.length) return parts.join(": ").replace(/: \(/, " (");
  const allStrings = Object.values(obj).filter((v) => v && typeof v === "string");
  return allStrings.join(" / ") || JSON.stringify(obj).slice(0, 240);
}

function coerceArrayItem(item) {
  if (typeof item === "string") {
    const trimmed = item.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (_) {}
    }
    return item;
  }
  return item;
}

function normalizeStringArray(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const flat = [];
  for (const raw of list) {
    const coerced = coerceArrayItem(raw);
    if (Array.isArray(coerced)) {
      for (const inner of coerced) flat.push(coerceArrayItem(inner));
    } else {
      flat.push(coerced);
    }
  }
  return flat.map((item) => clean(typeof item === "string" ? item : objectToReadableString(item), 1200)).filter(Boolean).slice(0, 12);
}

function parseJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Law review model returned an empty response.");
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Law review model did not return JSON.");
  }
}

function sampleDocumentText(doc, budget) {
  const text = doc?.text || (doc?.pages || []).map((p) => p.text || "").join("\n\n") || (doc?.sheets || []).map((s) => s.text || "").join("\n\n");
  return clean(text, budget);
}

function clean(value, max = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
