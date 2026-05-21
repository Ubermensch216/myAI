import { COMPLIANCE_MODE, REVIEW_TYPES, getReviewType, normalizeStringArray } from "./complianceTypes.js";

const COMPLIANCE_TRIGGER_PATTERN = /(법령\s*적합성|적합성\s*검토|컴플라이언스|compliance|준수\s*여부|위반\s*가능성|법적\s*리스크|법령\s*리스크|근거\s*보고서|보완\s*권고|상위\s*법령|충돌|저촉|맞는지\s*검토|문제\s*없는지)/iu;
const DETAILED_REPORT_PATTERN = /(상세|보고서|근거\s*보고서|표로|체크리스트|export|내보내기)/iu;
const LAW_NAME_PATTERN = /([가-힣A-Za-z0-9\s·ㆍ()]{2,40}?(?:법|시행령|시행규칙|규칙|고시|훈령|예규|조례|지침))/gu;
const TERM_EXPLANATION_PATTERN = /(뜻|의미|개념|정의|용어|무슨\s*말|무엇|뭐야|중학생|초등학생)/iu;
const REVIEW_REQUEST_PATTERN = /(검토|점검|체크리스트|준수|위반|적합성|리스크|보완|상위\s*법령|충돌|저촉|맞는지|문제\s*없는지|보고서|내보내기|export)/iu;

export function classifyComplianceIntent(prompt, { hasNotebook = false, hasDocuments = false } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return null;
  const hasMaterial = hasNotebook || hasDocuments;
  const reviewType = classifyReviewType(text);
  const hasTypeSignal = reviewType !== "general";
  const hasTrigger = COMPLIANCE_TRIGGER_PATTERN.test(text);
  if (isTermExplanationOnly(text)) {
    return null;
  }
  if (!hasTrigger && !(hasMaterial && hasTypeSignal && /검토|리스크|보완|준수|위반|맞는지|문제/u.test(text))) {
    return null;
  }

  const type = getReviewType(reviewType);
  const focusLawNames = extractFocusLawNames(text);
  focusLawNames.push(...type.suggestedLawNames.slice(0, 3));

  const dedupedFocusLawNames = [];
  const seenLawNames = new Set();
  for (const name of focusLawNames) {
    if (!name || seenLawNames.has(name)) continue;
    seenLawNames.add(name);
    dedupedFocusLawNames.push(name);
  }

  return {
    mode: COMPLIANCE_MODE,
    reviewType,
    outputStyle: DETAILED_REPORT_PATTERN.test(text) ? "detailed_report" : "summary",
    focusLawNames: dedupedFocusLawNames,
    requiresInternalMaterial: true
  };
}

function isTermExplanationOnly(text) {
  return TERM_EXPLANATION_PATTERN.test(text) && !REVIEW_REQUEST_PATTERN.test(text);
}

export function classifyReviewType(prompt) {
  const text = String(prompt || "");
  let best = { id: "general", score: 0 };
  for (const type of Object.values(REVIEW_TYPES)) {
    if (type.id === "general") continue;
    const score = type.patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
    if (score > best.score) best = { id: type.id, score };
  }
  return best.id;
}

export function extractFocusLawNames(prompt) {
  const found = [];
  const seen = new Set();
  for (const match of String(prompt || "").matchAll(LAW_NAME_PATTERN)) {
    const name = match[1].replace(/\s+/g, " ").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    found.push(name);
    if (found.length >= 5) break;
  }
  return normalizeStringArray(found);
}
