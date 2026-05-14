import { extractLawCitations, isLawishName, normalizeArticleRef, normalizeLawName } from "./lawArticleRef.js";
import { getLawConfig } from "./lawConfig.js";
import { classifyComplianceIntent } from "../compliance/complianceIntent.js";

const EXPLICIT_LEGAL_PATTERNS = [
  /법령에서.{0,30}찾아/u,
  /법에서.{0,30}찾아/u,
  /조문\s*(?:검증|확인|찾아|검색)/u,
  /인용\s*(?:검증|확인)/u,
  /판례\s*(?:찾아|검색)/u,
  /해석례\s*(?:찾아|검색)/u,
  /공식\s*법령/u,
  /법률?\s*(?:검토|위반|준수|적법|컴플라이언스)/u,
  // 잘 알려진 법령 이름 + "에는/에서" → 해당 법의 내용을 묻는 쿼리
  /(?:대한민국\s*)?(?:헌법|민법|형법|상법|민사소송법|형사소송법|행정소송법|행정심판법|행정절차법|행정기본법|국가공무원법|지방공무원법|근로기준법|노동조합법|도로교통법|개인정보\s?보호법|정보통신망법|소득세법|법인세법|부가가치세법|국세기본법|관세법|국가배상법)에[는서]/u
];

// Tokens that indicate the prompt is about an actual statute/case body, not a
// generic mention of "법" or "규정". Used to gate the broad legal-review path.
const LEGAL_KEYWORDS = /(법령|법률|시행령|시행규칙|판례|대법원|헌법재판소|행정심판|행정소송|해석례|자치법규|조례|고시|예규|불법행위|위법|적법|준법|컴플라이언스|개정이력|헌법|근로기준법|개인정보\s?보호법|도로교통법|국가공무원법|국세기본법)/u;
const NEWS_KEYWORDS = /(뉴스|최근\s*보도|보도|언론|기사|동향)/u;
const ARTICLE_TOKEN_PATTERN = /제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,2})?/u;

const PRECEDENT_INTENT_PATTERN = /(판례|판결|대법원\s*판결|선고\s*판결)/u;
const INTERPRETATION_INTENT_PATTERN = /(법령\s*해석례|해석례|법제처\s*해석)/u;
const ADMIN_RULE_INTENT_PATTERN = /(행정규칙|고시|예규|훈령|행정\s*지침)/u;
const ORDINANCE_INTENT_PATTERN = /(자치법규|조례|지방자치단체\s*규칙)/u;
const RESEARCH_VERB_PATTERN = /(찾아|검색|조회|알려|보여|살펴|어떤\s*것|있어\??)/u;

// action_plan: 법령에 근거한 단계별 조치/이행/대응 계획을 요구하는 의도.
// 단순 일정·여행·프로젝트 "계획"은 LEGAL_KEYWORDS 또는 article 근거가 없어 통과되지 않는다.
const ACTION_PLAN_PATTERN = /(단계별\s*(?:대응|조치|이행|실행|준수)|조치\s*(?:방안|계획|절차|매뉴얼|체크리스트|로드맵)|이행\s*(?:계획|방안|로드맵|절차)|대응\s*(?:방안|계획|매뉴얼|체크리스트|로드맵|절차)|실행\s*(?:계획|방안|로드맵)|컴플라이언스\s*(?:체크리스트|이행|대응|로드맵)|준수\s*(?:체크리스트|로드맵|매뉴얼|절차|계획))/u;

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
  const compliance = classifyComplianceIntent(text, { hasNotebook, hasDocuments });
  const legalReview = reviewVerb
    && (hasGroundingContext || compliance)
    && (citations.length > 0 || LEGAL_KEYWORDS.test(text) || ARTICLE_TOKEN_PATTERN.test(text) || compliance);
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

  // action_plan must be checked before legal_review because prompts like "위반 시
  // 단계별 대응 방안" hit both review verb and action-plan verb. Action plan is
  // more specific (it asks for structured steps grounded in a statute article).
  const actionPlanArticle = articlePattern || null;
  const actionPlan = ACTION_PLAN_PATTERN.test(text)
    && (citations.length > 0 || (LEGAL_KEYWORDS.test(text) && actionPlanArticle));
  if (actionPlan) {
    return {
      isLegalQuery: true,
      mode: "action_plan",
      extracted: buildExtracted(text, actionPlanArticle),
      confidence: citations.length ? 0.9 : 0.8,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  if (legalReview || compliance) {
    return {
      isLegalQuery: true,
      mode: "department_legal_review",
      extracted: {
        ...buildExtracted(text, articlePattern),
        reviewType: compliance?.reviewType || "general",
        outputStyle: compliance?.outputStyle || "summary",
        focusLawNames: compliance?.focusLawNames || [],
        requiresInternalMaterial: true
      },
      reviewType: compliance?.reviewType || "general",
      outputStyle: compliance?.outputStyle || "summary",
      focusLawNames: compliance?.focusLawNames || [],
      requiresInternalMaterial: true,
      confidence: 0.9,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  const research = detectResearchIntent(text, citations, articlePattern);
  if (research) return research;

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
    const query = normalizeSearchQuery(text);
    // Topic search (key word) vs law name search: if query doesn't end with law suffix,
    // treat as topic and use aiSearch + parallel search (law_topic_search mode)
    const isTopicSearch = query && !/(법|령|규칙|규정|조례|고시|예규|지침)$/u.test(query);
    return {
      isLegalQuery: true,
      mode: isTopicSearch ? "law_topic_search" : "law_search",
      extracted: { query },
      isTopicSearch,
      confidence: explicit ? 0.8 : 0.55,
      mayUseWebSearch: NEWS_KEYWORDS.test(text)
    };
  }

  return none();
}

export function isLegalPrompt(prompt, options = {}) {
  return detectLawIntent(prompt, options).isLegalQuery;
}

function detectResearchIntent(text, citations, articlePattern) {
  const wantPrecedents = PRECEDENT_INTENT_PATTERN.test(text);
  const wantInterpretations = INTERPRETATION_INTENT_PATTERN.test(text);
  const wantAdminRules = ADMIN_RULE_INTENT_PATTERN.test(text);
  const wantOrdinances = ORDINANCE_INTENT_PATTERN.test(text);
  if (!(wantPrecedents || wantInterpretations || wantAdminRules || wantOrdinances)) return null;
  // Require a research verb (찾아/검색/...) or a known law name to avoid
  // triggering on stray mentions like "판례를 만들었다" or "고시 가격" (price).
  if (!RESEARCH_VERB_PATTERN.test(text) && citations.length === 0 && !articlePattern) return null;
  const researchQuery = normalizeResearchQuery(text);
  return {
    isLegalQuery: true,
    mode: "legal_research",
    extracted: {
      query: researchQuery || text,
      lawName: articlePattern?.lawName || (citations[0]?.lawName ?? ""),
      article: articlePattern?.article || (citations[0]?.article ?? ""),
      wantPrecedents,
      wantInterpretations,
      wantAdminRules,
      wantOrdinances
    },
    confidence: 0.85,
    mayUseWebSearch: NEWS_KEYWORDS.test(text)
  };
}

function normalizeResearchQuery(text) {
  return String(text || "")
    .replace(/관련\s*(?:판례|해석례|행정규칙|고시|예규|훈령|조례|자치법규)/gu, " ")
    .replace(/(?:판례|해석례|행정규칙|고시|예규|훈령|조례|자치법규)\s*(?:찾아|검색|조회|알려|보여|살펴)?\s*(?:줘|주세요)?/gu, " ")
    .replace(/^(?:관련|있는|어떤|있어\??|있나요\??)\s*/u, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
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

// 알려진 법령명 목록 (normalizeSearchQuery와 extractLawPrefix에서 공유)
const KNOWN_LAW_NAMES =
  "헌법|민법|형법|상법|민사소송법|형사소송법|행정소송법|행정심판법|행정절차법|행정기본법|" +
  "국가공무원법|지방공무원법|근로기준법|노동조합법|도로교통법|개인정보보호법|개인정보\\s?보호법|" +
  "정보통신망법|소득세법|법인세법|부가가치세법|국세기본법|관세법|국가배상법";

function normalizeSearchQuery(text) {
  const raw = String(text || "");

  // "법명에[는서] + 내용 질문" 패턴 → 법령명 + 핵심 목적어만 추출
  const lawPrefixRe = new RegExp(
    `^(?:대한민국\\s*)?(${KNOWN_LAW_NAMES}|[가-힣]{2,20}법)에[는서]`,
    "u"
  );
  const lawMatch = raw.match(lawPrefixRe);
  if (lawMatch) {
    const lawName = lawMatch[1].trim();
    const after = raw.slice(lawMatch[0].length);
    // 을/를 앞에 오는 명사(목적어)를 핵심 키워드로 추출
    const keywords = [...after.matchAll(/([가-힣]{2,10})(?=을|를)/gu)]
      .map((m) => m[1])
      .filter((w) => !/^(?:경우|방법|내용|사항|규정|사람|것|여부)$/.test(w))
      .slice(0, 2);
    return [lawName, ...keywords].join(" ").trim().slice(0, 80);
  }

  return raw
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
