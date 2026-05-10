import { extractLawCitations, normalizeArticleRef, normalizeLawName } from "./lawArticleRef.js";
import { getLawConfig } from "./lawConfig.js";

const EXPLICIT_LEGAL_PATTERNS = [
  /법령에서\s*찾아/u,
  /법에서\s*찾아/u,
  /조문\s*(?:검증|확인|찾아|검색)/u,
  /인용\s*(?:검증|확인)/u,
  /판례\s*찾아/u,
  /해석례\s*찾아/u,
  /공식\s*법령/u,
  /법률?\s*(?:검토|위반|준수|적법|컴플라이언스)/u
];

const LEGAL_KEYWORDS = /(법령|법률|조문|제\d+조|제\d+조의\d+|시행령|시행규칙|고시|예규|판례|대법원|헌법재판소|행정심판|해석례|자치법규|조례|규칙|위탁|불법행위|개정이력)/u;
const NEWS_KEYWORDS = /(뉴스|최근\s*보도|보도|언론|기사|동향)/u;

export function detectLawIntent(prompt, { hasNotebook = false, hasDocuments = false } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return none();
  const config = getLawConfig();
  const citations = extractLawCitations(text);
  const explicit = EXPLICIT_LEGAL_PATTERNS.some((pattern) => pattern.test(text));
  const legalReview = /(맞는지|준수|위반|적법|검토|리스크|보완\s*권고|컴플라이언스)/u.test(text)
    && (hasNotebook || hasDocuments || /부서노트북|문서|지침|내규|규정/u.test(text))
    && LEGAL_KEYWORDS.test(text);
  const verify = /(조문|인용).{0,12}(검증|확인|맞는지|실제)/u.test(text);
  const articlePattern = citations[0] || extractLooseArticle(text);

  if (verify) {
    return {
      isLegalQuery: true,
      mode: "verify_citations",
      extracted: { query: text, citations },
      confidence: explicit || citations.length ? 0.95 : 0.8,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  if (legalReview) {
    return {
      isLegalQuery: true,
      mode: "department_legal_review",
      extracted: buildExtracted(text, articlePattern),
      confidence: 0.9,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  if (articlePattern && (explicit || citations.length || config.autoDetect)) {
    return {
      isLegalQuery: true,
      mode: "law_article",
      extracted: buildExtracted(text, articlePattern),
      confidence: citations.length ? 0.95 : 0.85,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  if (explicit || (config.autoDetect && LEGAL_KEYWORDS.test(text))) {
    return {
      isLegalQuery: true,
      mode: "law_search",
      extracted: { query: normalizeSearchQuery(text) },
      confidence: explicit ? 0.8 : 0.55,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  return none();
}

export function isLegalPrompt(prompt, options = {}) {
  return detectLawIntent(prompt, options).isLegalQuery;
}

function buildExtracted(text, citation) {
  const fallback = extractLooseArticle(text);
  const source = citation || fallback || {};
  return {
    lawName: normalizeLawName(source.lawName || inferLawName(text)),
    article: source.article || normalizeArticleRef(text).canonical,
    paragraph: source.paragraph || "",
    item: source.item || "",
    query: text
  };
}

function extractLooseArticle(text) {
  const match = String(text || "").match(/([가-힣A-Za-z0-9·ㆍ\s]{1,60}?(?:헌법|민법|형법|상법|법|령|규칙|규정|조례|고시|예규|지침))?\s*(제?\s*\d+\s*조(?:\s*의\s*\d+)?)/u);
  if (!match) return null;
  return {
    lawName: normalizeLawName(match[1] || inferLawName(text)),
    article: normalizeArticleRef(match[2]).canonical
  };
}

function inferLawName(text) {
  const match = String(text || "").match(/([가-힣A-Za-z0-9·ㆍ\s]{1,60}?(?:헌법|민법|형법|상법|법|령|규칙|규정|조례|고시|예규|지침))/u);
  return match ? match[1] : "";
}

function normalizeSearchQuery(text) {
  return String(text || "")
    .replace(/법령에서\s*찾아줘?/gu, " ")
    .replace(/법에서\s*찾아줘?/gu, " ")
    .replace(/조문\s*(?:검색|찾아줘?|확인|검증).*/u, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function none() {
  return {
    isLegalQuery: false,
    mode: "none",
    extracted: {},
    confidence: 0,
    mayUseWebSearch: false
  };
}
