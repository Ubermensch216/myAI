import { extractLawCitations, isLawishName, normalizeArticleRef, normalizeLawName } from "./lawArticleRef.js";
import { getLawConfig } from "./lawConfig.js";

const EXPLICIT_LEGAL_PATTERNS = [
  /법령에서.{0,30}찾아/u,
  /법에서.{0,30}찾아/u,
  /조문\s*(?:검증|확인|찾아|검색)/u,
  /인용\s*(?:검증|확인)/u,
  /판례\s*(?:찾아|검색)/u,
  /해석례\s*(?:찾아|검색)/u,
  /공식\s*법령/u,
  /법률?\s*(?:검토|위반|준수|적법|컴플라이언스)/u
];

// Tokens that indicate the prompt is about an actual statute/case body, not a
// generic mention of "법" or "규정". Used to gate the broad legal-review path.
const LEGAL_KEYWORDS = /(법령|법률|시행령|시행규칙|판례|대법원|헌법재판소|행정심판|행정소송|해석례|자치법규|조례|고시|예규|불법행위|위법|적법|준법|컴플라이언스|개정이력)/u;
const NEWS_KEYWORDS = /(뉴스|최근\s*보도|보도|언론|기사|동향)/u;
const ARTICLE_TOKEN_PATTERN = /제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,2})?/u;

export function detectLawIntent(prompt, { hasNotebook = false, hasDocuments = false } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return none();
  const config = getLawConfig();
  const citations = extractLawCitations(text);
  const explicit = EXPLICIT_LEGAL_PATTERNS.some((pattern) => pattern.test(text));
  // Legal review must be grounded in either (a) an actual statute reference,
  // (b) explicit legal vocabulary, or (c) explicit "법령/법률/판례" trigger
  // words. "이 회의록이 사내규정에 맞는지" alone must NOT trigger.
  const reviewVerb = /(맞는지|준수|위반|적법|검토|리스크|보완\s*권고|컴플라이언스)/u.test(text);
  const hasGroundingContext = hasNotebook || hasDocuments;
  const legalReview = reviewVerb
    && hasGroundingContext
    && (citations.length > 0 || LEGAL_KEYWORDS.test(text) || ARTICLE_TOKEN_PATTERN.test(text));
  const verify = /(조문|인용).{0,12}(검증|확인|맞는지|실제)/u.test(text);
  const articlePattern = citations[0] || (explicit || legalReview ? extractLooseArticle(text) : null);

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
  // Reuse the hardened citation extractor so loose detection inherits the
  // false-positive denylist (방법/사용법/사내 규정/etc) instead of a separate
  // permissive regex.
  const citations = extractLawCitations(text);
  if (citations.length) {
    return {
      lawName: citations[0].lawName,
      article: citations[0].article
    };
  }
  // Fallback: explicit "제N조" with no preceding law name. Only useful when
  // the text already established legal context (caller checks `explicit`).
  const articleMatch = String(text || "").match(/제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,2})?/u);
  if (!articleMatch) return null;
  const inferred = inferLawName(text);
  if (!isLawishName(inferred)) return null;
  return {
    lawName: inferred,
    article: normalizeArticleRef(articleMatch[0]).canonical
  };
}

function inferLawName(text) {
  const match = String(text || "").match(/([가-힣A-Za-z0-9·ㆍ\s]{1,40}?(?:헌법|민법|형법|상법|법|법률|령|규칙|규정|조례|고시|예규|지침))/u);
  if (!match) return "";
  const candidate = normalizeLawName(match[1]);
  return isLawishName(candidate) ? candidate : "";
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
