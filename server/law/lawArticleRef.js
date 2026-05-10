const CIRCLED_DIGITS = new Map([
  ["①", 1], ["②", 2], ["③", 3], ["④", 4], ["⑤", 5],
  ["⑥", 6], ["⑦", 7], ["⑧", 8], ["⑨", 9], ["⑩", 10],
  ["⑪", 11], ["⑫", 12], ["⑬", 13], ["⑭", 14], ["⑮", 15],
  ["⑯", 16], ["⑰", 17], ["⑱", 18], ["⑲", 19], ["⑳", 20]
]);

const KNOWN_LAW_SUFFIX = /(?:헌법|민법|형법|상법|법|령|규칙|규정|조례|고시|예규|지침)$/u;

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
  const pattern = /([가-힣A-Za-z0-9·ㆍ\s]{1,80}?(?:헌법|민법|형법|상법|법|령|규칙|규정|조례|고시|예규|지침))\s*(제?\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제?\s*\d+\s*항|[①-⑳])?(?:\s*제?\s*\d+\s*호)?(?:\s*[가-하]\s*목|[가-하]\.)?)/gu;
  const results = [];
  const seen = new Set();
  for (const match of source.matchAll(pattern)) {
    const lawName = normalizeLawName(match[1]);
    const locator = match[2].trim();
    const parts = normalizeLawCitationParts({
      lawName,
      article: locator,
      paragraph: locator,
      item: locator,
      subitem: locator
    });
    if (!lawName || !parts.article.canonical) continue;
    const key = parts.canonical;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      citation: `${lawName} ${formatLocatorFromParts(parts)}`.trim(),
      lawName,
      article: parts.article.canonical,
      paragraph: parts.paragraph.canonical,
      item: parts.item.canonical,
      subitem: parts.subitem.canonical,
      canonical: parts.canonical,
      joCode: parts.article.joCode
    });
  }
  return results;
}

export function normalizeLawName(value) {
  const text = normalizeSpaces(String(value ?? ""))
    .replace(/["'`“”‘’]/g, "")
    .replace(/^.*?(?:법령에서|법에서)\s*/u, "")
    .replace(/^(?:와|과|및|그리고|또는|,|:)\s*/u, "")
    .replace(/^(?:법령|법|조문|판례|해석례|공식)\s*/u, "")
    .replace(/\s*(?:에서|의|에|를|을|은|는|이|가)$/u, "")
    .trim();
  return text;
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
