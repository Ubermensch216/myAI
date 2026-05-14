// Law name aliases (abbreviations → canonical names). 80+ entries from korean-law-mcp.
const LAW_ALIAS_MAP = new Map([
  // Safety & Labor (안전·노무)
  ["산안법", "산업안전보건법"],
  ["산안기준규칙", "산업안전보건기준에 관한 규칙"],
  ["안전보건규칙", "산업안전보건기준에 관한 규칙"],
  ["산안규칙", "산업안전보건기준에 관한 규칙"],
  ["중처법", "중대재해 처벌 등에 관한 법률"],
  ["중대재해처벌법", "중대재해 처벌 등에 관한 법률"],
  ["중대재해법", "중대재해 처벌 등에 관한 법률"],
  ["산재법", "산업재해보상보험법"],
  ["산재보험법", "산업재해보상보험법"],
  ["근기법", "근로기준법"],
  ["근로법", "근로기준법"],
  ["화관법", "화학물질관리법"],
  ["소방시설법", "소방시설 설치 및 관리에 관한 법률"],
  ["남녀고용평등법", "남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률"],

  // Core (기본법)
  ["헌법", "대한민국헌법"],
  ["행정법", "행정기본법"],
  ["상법", "상법"],
  ["상사법", "상법"],
  ["민법", "민법"],

  // Customs & Trade
  ["관시령", "관세법 시행령"],
  ["관시규", "관세법 시행규칙"],
  ["fta특례법", "자유무역협정의 이행을 위한 관세법의 특례에 관한 법률"],
  ["무역법", "대외무역법"],
  ["원산지표시법", "원산지표시법"],

  // Environment & Health
  ["대기환경법", "대기환경보전법"],
  ["감염병법", "감염병의 예방 및 관리에 관한 법률"],

  // Government & Employment
  ["지공법", "지방공무원법"],
  ["지방공무원임용령", "지방공무원 임용령"],
  ["지공보수규정", "지방공무원 보수규정"],

  // Privacy & Telecom
  ["개보법", "개인정보 보호법"],
  ["정통망법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률"],
  ["전사법", "전기통신사업법"],

  // Anti-Corruption & Public Office
  ["청탁금지법", "부정청탁 및 금품등 수수의 금지에 관한 법률"],
  ["김영란법", "부정청탁 및 금품등 수수의 금지에 관한 법률"],
  ["이해충돌방지법", "공직자의 이해충돌 방지법"],

  // Government Contracts
  ["국가계약법", "국가를 당사자로 하는 계약에 관한 법률"],
  ["지방계약법", "지방자치단체를 당사자로 하는 계약에 관한 법률"],

  // Information & Public Access
  ["정보공개법", "공공기관의 정보공개에 관한 법률"],

  // Real Estate & Housing
  ["부거법", "부동산 거래신고 등에 관한 법률"],
  ["주임법", "주택임대차보호법"],
  ["상임법", "상가건물 임대차보호법"],
  ["국계법", "국토의 계획 및 이용에 관한 법률"],
  ["도정법", "도시 및 주거환경정비법"],

  // Taxation
  ["국기법", "국세기본법"],
  ["부가세법", "부가가치세법"],

  // Competition & Consumer Protection
  ["공거법", "독점규제 및 공정거래에 관한 법률"],
  ["하도급법", "하도급거래 공정화에 관한 법률"],
  ["약관법", "약관의 규제에 관한 법률"],
  ["표시광고법", "표시ㆍ광고의 공정화에 관한 법률"],
  ["가맹법", "가맹사업거래의 공정화에 관한 법률"],
  ["전상법", "전자상거래 등에서의 소비자보호에 관한 법률"],

  // Credit & Finance
  ["신정법", "신용정보의 이용 및 보호에 관한 법률"],
  ["자시법", "자본시장과 금융투자업에 관한 법률"],
  ["특금법", "특정 금융거래정보의 보고 및 이용 등에 관한 법률"],
  ["전금법", "전자금융거래법"],

  // Procedure
  ["민소법", "민사소송법"],
  ["형소법", "형사소송법"],
  ["민집법", "민사집행법"],

  // Insurance & Transportation
  ["건보법", "국민건강보험법"],
  ["고보법", "고용보험법"],
  ["여객운수법", "여객자동차 운수사업법"],
  ["화운법", "화물자동차 운수사업법"]
]);

const CIRCLED_DIGITS = new Map([
  ["①", 1], ["②", 2], ["③", 3], ["④", 4], ["⑤", 5],
  ["⑥", 6], ["⑦", 7], ["⑧", 8], ["⑨", 9], ["⑩", 10],
  ["⑪", 11], ["⑫", 12], ["⑬", 13], ["⑭", 14], ["⑮", 15],
  ["⑯", 16], ["⑰", 17], ["⑱", 18], ["⑲", 19], ["⑳", 20]
]);

const KNOWN_LAW_SUFFIX = /(?:헌법|민법|형법|상법|법|령|규칙|규정|조례|고시|예규|지침)$/u;

// Whitelist of single-word law names that are unambiguous enough to anchor a
// citation even when the user omits the 제 prefix on the article ("민법 750조").
// Multi-word statutes still require a 제 prefix to match (see ARTICLE_NUMBER_PATTERN).
const STRONG_LAW_NAME_PATTERN = /^(?:대한민국)?(?:헌법|민법|형법|상법|민사소송법|형사소송법|행정소송법|행정심판법|행정절차법|행정기본법|국가공무원법|지방공무원법|근로기준법|노동조합법|도로교통법|개인정보\s?보호법|정보통신망법|소득세법|법인세법|부가가치세법|상속세\s?및\s?증여세법|국세기본법|관세법|상속세법|증여세법|국가배상법)$/u;

// Words that LOOK like they end in a law suffix (법/규칙/규정/령/...) but are
// common Korean nouns with non-legal meaning. These must not anchor citations.
const DENY_LAW_NAMES = /(^|[\s「『"'(])(?:방법|수법|편법|비법|용법|요법|어법|기법|묘법|화법|작법|식법|사용법|운영법|진단법|치료법|조리법|요리법|평가법|분석법|학습법|훈련법|호흡법|발성법|발음법|마사지법|구사법|회화법|표현법|행동법|사고법|소법|문법|기법|타법|장법|보법|제조법|관리법|검사법|시연법|단축키법)([\s。.,!?\)」』"']|$)/u;

const DENY_LAW_TAIL = /(?:방|수|편|비|용|요|어|기|묘|화|작|식|사용|운영|진단|치료|조리|요리|평가|분석|학습|훈련|호흡|발성|발음|마사지|구사|회화|표현|행동|사고|소|문|타|장|보|제조|관리|검사|시연|단축키)법$/u;

const DENY_RULE_PHRASES = /(?:야구|축구|농구|게임|놀이|행동|회의|운영|사내|회사|내부|자체|모임|비공식|개인|팀|클럽|동호회)\s*규칙$/u;

const NON_LAW_RULE_PHRASES = /(?:사내|회사|내부|자체|운영|모임|개인|팀|클럽|동호회|업무)\s*규정$/u;

export function normalizeArticleRef(input) {
  const raw = String(input ?? "").trim();
  const text = normalizeSpaces(raw);
  const match = findArticleMatch(text);
  if (!match) {
    return {
      raw,
      canonical: "",
      articleNumber: null,
      branchNumber: null,
      joCode: ""
    };
  }

  const articleNumber = Number(match.groups?.article);
  const branchNumber = match.groups?.branch ? Number(match.groups.branch) : null;
  const canonical = `제${articleNumber}조${branchNumber ? `의${branchNumber}` : ""}`;
  return {
    raw,
    canonical,
    articleNumber,
    branchNumber,
    joCode: formatJoCode(articleNumber, branchNumber)
  };
}

export function normalizeLawCitationParts({ lawName, article, paragraph, item, subitem } = {}) {
  const normalizedLawName = normalizeLawName(lawName);
  const normalizedArticle = normalizeArticleRef(article);
  const normalizedParagraph = normalizeUnitRef(paragraph, "항");
  const normalizedItem = normalizeUnitRef(item, "호");
  const normalizedSubitem = normalizeSubitemRef(subitem);
  const parts = [normalizedLawName, normalizedArticle.canonical, normalizedParagraph.canonical, normalizedItem.canonical, normalizedSubitem.canonical]
    .filter(Boolean);
  return {
    lawName: normalizedLawName,
    article: normalizedArticle,
    paragraph: normalizedParagraph,
    item: normalizedItem,
    subitem: normalizedSubitem,
    canonical: parts.join("/")
  };
}

export function parseArticleLocator(input) {
  const raw = String(input ?? "").trim();
  const text = normalizeSpaces(raw);
  const article = normalizeArticleRef(text);
  return {
    article,
    paragraph: normalizeUnitRef(text, "항"),
    item: normalizeUnitRef(text, "호"),
    subitem: normalizeSubitemRef(text)
  };
}

export function extractLawCitations(text) {
  const source = normalizeSpaces(String(text ?? ""));
  if (!source) return [];
  // Two anchored shapes:
  // 1. Strict — any law-name suffix family + EXPLICIT 제 prefix on the article number.
  //    "도로교통법 제44조", "사내규정 제5조" both pass this pattern; the latter is
  //    later filtered by isLawishName.
  // 2. Strong-name — whitelisted unambiguous law names may use the bare "750조" form.
  // The 제 prefix on the article number is itself a strong disambiguator, so
  // strict mode does not need a hangul boundary check after 조.
  const strictPattern = /([가-힣A-Za-z0-9·ㆍ\s]{0,60}?(?:헌법|민법|형법|상법|법|법률|령|규칙|규정|조례|고시|예규|지침))\s*제\s*0*(\d{1,4})\s*조(?:\s*의\s*0*(\d{1,2}))?(?:\s*제?\s*0*(\d{1,4})\s*항|\s*([①-⑳]))?(?:\s*제?\s*0*(\d{1,4})\s*호)?(?:\s*([가-하])\s*목|\s*([가-하])\.)?/gu;
  // Strong-name mode allows the bare "750조" form, so we must guard against
  // common Korean nouns starting with 조 (조각/조합/조약/조항/조선/...).
  const strongPattern = /([가-힣A-Za-z·\s]{0,40}?(?:헌법|민법|형법|상법|민사소송법|형사소송법|행정소송법|행정심판법|행정절차법|행정기본법|국가공무원법|지방공무원법|근로기준법|노동조합법|도로교통법|개인정보\s?보호법|정보통신망법|소득세법|법인세법|부가가치세법|상속세법|증여세법|국세기본법|관세법|국가배상법))\s*제?\s*0*(\d{1,4})\s*조(?:\s*의\s*0*(\d{1,2}))?(?:\s*제?\s*0*(\d{1,4})\s*항|\s*([①-⑳]))?(?:\s*제?\s*0*(\d{1,4})\s*호)?(?:\s*([가-하])\s*목|\s*([가-하])\.)?(?!(?:각|합|약|개|항|선|절|정|작|직|사|판|류|명|성|세|퇴|리|심|식|초|치|장|편|상|하|음|건|수|기|위|언|어|민|일|문|업|책|적|점))/gu;

  const results = [];
  const seen = new Set();
  for (const pattern of [strictPattern, strongPattern]) {
    for (const match of source.matchAll(pattern)) {
      const lawNameRaw = String(match[1] || "");
      const lawName = normalizeLawName(lawNameRaw);
      if (!isLawishName(lawName)) continue;
      const articleCanonical = match[3]
        ? `제${Number(match[2])}조의${Number(match[3])}`
        : `제${Number(match[2])}조`;
      const paragraphCanonical = match[5]
        ? `제${CIRCLED_DIGITS.get(match[5])}항`
        : (match[4] ? `제${Number(match[4])}항` : "");
      const itemCanonical = match[6] ? `제${Number(match[6])}호` : "";
      const subitemValue = match[7] || match[8] || "";
      const subitemCanonical = subitemValue ? `${subitemValue}목` : "";
      const articleRef = normalizeArticleRef(articleCanonical);
      if (!articleRef.canonical || !articleRef.joCode) continue;
      const canonicalParts = [lawName, articleRef.canonical, paragraphCanonical, itemCanonical, subitemCanonical].filter(Boolean);
      const canonical = canonicalParts.join("/");
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      results.push({
        citation: [lawName, articleRef.canonical, paragraphCanonical, itemCanonical, subitemCanonical].filter(Boolean).join(" "),
        lawName,
        article: articleRef.canonical,
        paragraph: paragraphCanonical,
        item: itemCanonical,
        subitem: subitemCanonical,
        canonical,
        joCode: articleRef.joCode
      });
    }
  }
  return results;
}

// Returns true when `value` looks like a real Korean law/ordinance/rule name.
// Filters out "방법", "수법", "사내 규칙", "야구 규칙" style false positives.
export function isLawishName(value) {
  const text = normalizeLawName(value);
  if (!text) return false;
  if (DENY_LAW_TAIL.test(text)) return false;
  if (DENY_RULE_PHRASES.test(text)) return false;
  if (NON_LAW_RULE_PHRASES.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return KNOWN_LAW_SUFFIX.test(text) || STRONG_LAW_NAME_PATTERN.test(text);
}

export function isStrongLawName(value) {
  return STRONG_LAW_NAME_PATTERN.test(normalizeLawName(value));
}

export function resolveAliasedLawName(value) {
  const raw = String(value ?? “”).trim();
  return LAW_ALIAS_MAP.get(raw) || raw;
}

export function normalizeLawName(value) {
  const text = normalizeSpaces(String(value ?? “”))
    .replace(/[“’`””’’]/g, “”)
    .replace(/^.*?(?:법령에서|법에서)\s*/u, “”)
    .replace(/^(?:와|과|및|그리고|또는|,|:)\s*/u, “”)
    .replace(/^(?:법령|법|조문|판례|해석례|공식)\s*/u, “”)
    .replace(/\s*(?:에서|의|에|를|을|은|는|이|가)$/u, “”)
    .trim();
  return resolveAliasedLawName(text);
}

export function formatJoCode(articleNumber, branchNumber = null) {
  const article = Number(articleNumber);
  const branch = Number(branchNumber || 0);
  if (!Number.isInteger(article) || article < 1 || article > 9999) return "";
  if (!Number.isInteger(branch) || branch < 0 || branch > 99) return "";
  return `${String(article).padStart(4, "0")}${String(branch).padStart(2, "0")}`;
}

export function formatUnitCode(number) {
  const value = Number(number);
  if (!Number.isInteger(value) || value < 1 || value > 9999) return "";
  return `${String(value).padStart(4, "0")}00`;
}

export function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findArticleMatch(text) {
  const normalized = String(text ?? "").replace(/\s+/g, "");
  return normalized.match(/제?0*(?<article>\d{1,4})조(?:의0*(?<branch>\d{1,2}))?/u)
    || normalized.match(/(?<!\d)0*(?<article>\d{1,4})(?:조)?(?:의0*(?<branch>\d{1,2}))?(?!\d)/u);
}

function normalizeUnitRef(input, unit) {
  const raw = String(input ?? "").trim();
  if (!raw) return { raw, canonical: "", number: null, code: "" };
  if (unit === "항") {
    for (const [symbol, number] of CIRCLED_DIGITS) {
      if (raw.includes(symbol)) {
        return { raw, canonical: `제${number}항`, number, code: formatUnitCode(number) };
      }
    }
  }
  const re = unit === "항"
    ? /제?\s*0*(\d{1,4})\s*항/u
    : /제?\s*0*(\d{1,4})\s*호/u;
  const match = raw.match(re);
  if (!match) return { raw, canonical: "", number: null, code: "" };
  const number = Number(match[1]);
  return {
    raw,
    canonical: `제${number}${unit}`,
    number,
    code: formatUnitCode(number)
  };
}

function normalizeSubitemRef(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { raw, canonical: "", value: "" };
  const match = raw.match(/([가-하])\s*(?:목|\.)/u);
  if (!match) return { raw, canonical: "", value: "" };
  return { raw, canonical: `${match[1]}목`, value: match[1] };
}

function formatLocatorFromParts(parts) {
  return [
    parts.article?.canonical,
    parts.paragraph?.canonical,
    parts.item?.canonical,
    parts.subitem?.canonical
  ].filter(Boolean).join(" ");
}

export function looksLikeLawName(value) {
  return KNOWN_LAW_SUFFIX.test(normalizeLawName(value));
}

// Normalizes an effective-date input into ISO (YYYY-MM-DD) and law.go.kr's
// upstream YYYYMMDD form. Invalid input returns empty fields so the caller can
// fall back to current-version retrieval.
export function normalizeEffectiveDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { iso: "", compact: "", raw };
  const digits = raw.replace(/\D+/g, "");
  if (digits.length !== 8) return { iso: "", compact: "", raw };
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1948 || year > 2999) return { iso: "", compact: "", raw };
  if (month < 1 || month > 12) return { iso: "", compact: "", raw };
  if (day < 1 || day > 31) return { iso: "", compact: "", raw };
  return {
    iso: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`,
    compact: digits,
    raw
  };
}
