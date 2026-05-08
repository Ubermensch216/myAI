import { loadLocalEnv } from "./env.js";
import { throwIfAborted } from "./abort.js";

loadLocalEnv();

const NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search";
const DEFAULT_TYPES = ["news", "webkr"];
const TYPE_ALIASES = new Map([
  ["news", "news"],
  ["newskr", "news"],
  ["web", "webkr"],
  ["webkr", "webkr"],
  ["blog", "blog"],
  ["doc", "doc"],
  ["kin", "kin"],
  ["local", "local"],
  ["book", "book"],
  ["shop", "shop"],
  ["cafe", "cafearticle"],
  ["cafearticle", "cafearticle"]
]);

const TYPE_LABELS = {
  news: "Naver News",
  webkr: "Naver Web",
  blog: "Naver Blog",
  doc: "Naver Doc",
  kin: "Naver Knowledge iN",
  local: "Naver Local",
  book: "Naver Book",
  shop: "Naver Shopping",
  cafearticle: "Naver Cafe"
};

export function isNaverSearchConfigured() {
  return Boolean(
    String(process.env.NAVER_SEARCH_CLIENT_ID || "").trim() &&
    String(process.env.NAVER_SEARCH_CLIENT_SECRET || "").trim()
  );
}

export function shouldUseNaverSearch(prompt) {
  if (!isNaverSearchEnabled()) return false;
  const text = String(prompt || "").trim();
  if (!text) return false;
  return (
    /네이버.{0,12}(검색|뉴스|웹|조회|찾아|알아)/i.test(text) ||
    /(검색|검색해서|검색해|검색해줘|조회|찾아봐|찾아줘|알아봐|웹에서|인터넷에서|뉴스)/i.test(text) ||
    /(최신|오늘|현재|실시간).{0,20}(정보|뉴스|동향|현황|조회|검색|찾아)/i.test(text)
  );
}

export async function buildNaverSearchContext(prompt, { signal } = {}) {
  throwIfAborted(signal);
  if (!shouldUseNaverSearch(prompt)) return null;
  if (!isNaverSearchConfigured()) {
    return {
      ok: false,
      query: normalizeSearchQuery(prompt),
      citations: [],
      contextText: "",
      error: "Naver search is requested, but NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET are not configured."
    };
  }

  const query = normalizeSearchQuery(prompt);
  if (!query) return null;

  const types = chooseSearchTypes(prompt);
  const perTypeDisplay = clampNumber(process.env.NAVER_SEARCH_DISPLAY, 5, 1, 20);
  const maxResults = clampNumber(process.env.NAVER_SEARCH_MAX_RESULTS, 8, 1, 30);
  const timeoutMs = clampNumber(process.env.NAVER_SEARCH_TIMEOUT_MS, 4500, 500, 15000);

  const results = [];
  const errors = [];
  for (const type of types) {
    try {
      const payload = await requestNaverSearch({
        type,
        query,
        display: perTypeDisplay,
        sort: sortForType(type, prompt),
        timeoutMs,
        signal
      });
      results.push(...normalizeItems(payload.items, type));
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${type}: ${error.message}`);
    }
  }

  const unique = dedupeResults(results).slice(0, maxResults);
  const citations = unique.map((item, index) => ({
    citationId: `W${index + 1}`,
    sourceType: "naver",
    documentName: item.title || item.link || TYPE_LABELS[item.type] || "Naver search result",
    documentType: item.type,
    locator: item.date || TYPE_LABELS[item.type] || "Naver",
    url: item.link,
    sourceName: item.sourceName || TYPE_LABELS[item.type] || "Naver"
  }));

  return {
    ok: unique.length > 0,
    query,
    types,
    citations,
    contextText: formatNaverContext(query, unique),
    error: unique.length ? "" : errors.join("; ") || "Naver search returned no usable results."
  };
}

export function isNaverSearchEnabled() {
  const value = String(process.env.NAVER_SEARCH_ENABLED ?? "true").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

function normalizeSearchQuery(prompt) {
  const text = String(prompt || "")
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .trim();
  if (!text) return "";

  const cleaned = text
    .replace(/^(네이버에서|네이버로|네이버)\s*/i, "")
    .replace(/(네이버에서|네이버로|네이버)\s*/gi, "")
    .replace(/(검색을\s*통해|검색해서|검색해줘|검색해|검색|조회해줘|조회해|조회|찾아봐줘|찾아봐|찾아줘|알아봐줘|알아봐)/gi, " ")
    .replace(/(설명해줘|설명해|설명|알려줘|정리해줘|정리해|요약해줘|요약해|정보를|정보|결과를|결과|관련|대해서|에\s*대해|해줘|줘)$/gi, " ")
    .replace(/\b(about|explain|summarize|summary|search|find)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*(을|를|은|는|이|가)\s*$/u, "")
    .trim();

  return (cleaned || text).slice(0, 180);
}

function chooseSearchTypes(prompt) {
  const configured = String(process.env.NAVER_SEARCH_TYPES || "")
    .split(",")
    .map((item) => TYPE_ALIASES.get(item.trim().toLowerCase()))
    .filter(Boolean);
  if (configured.length) return [...new Set(configured)].slice(0, 4);

  const text = String(prompt || "");
  if (/뉴스|최신|오늘|현재|실시간|동향/i.test(text)) return ["news", "webkr"];
  if (/블로그|후기|리뷰/i.test(text)) return ["blog", "webkr"];
  if (/논문|보고서|전문자료|자료/i.test(text)) return ["doc", "webkr"];
  if (/지역|주소|맛집|장소|업체|매장|병원|식당/i.test(text)) return ["local", "webkr"];
  if (/책|도서|서적/i.test(text)) return ["book", "webkr"];
  if (/쇼핑|가격|상품|구매/i.test(text)) return ["shop", "webkr"];
  return DEFAULT_TYPES;
}

function sortForType(type, prompt) {
  if (!["news", "blog"].includes(type)) return null;
  return /최신|오늘|현재|실시간|뉴스|동향/i.test(String(prompt || "")) ? "date" : "sim";
}

async function requestNaverSearch({ type, query, display, sort, timeoutMs, signal }) {
  throwIfAborted(signal);
  const clientId = String(process.env.NAVER_SEARCH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.NAVER_SEARCH_CLIENT_SECRET || "").trim();
  const url = new URL(`${NAVER_SEARCH_URL}/${type}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("start", "1");
  if (sort) url.searchParams.set("sort", sort);

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    method: "GET",
    signal: combinedSignal,
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Naver search returned invalid JSON.");
  }
}

function normalizeItems(items, type) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const title = cleanNaverText(item.title || "");
    const description = cleanNaverText(item.description || "");
    const link = String(item.originallink || item.link || "").trim();
    const sourceName = cleanNaverText(item.bloggername || item.author || item.publisher || "");
    return {
      type,
      title,
      description,
      link,
      sourceName,
      date: normalizeDate(item.pubDate || item.postdate || item.datetime || "")
    };
  }).filter((item) => item.title && item.link);
}

function cleanNaverText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<\/?b>/gi, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return text.slice(0, 40);
}

function dedupeResults(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = normalizeDedupeKey(item.link || item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function normalizeDedupeKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").toLowerCase().trim();
  }
}

function formatNaverContext(query, items) {
  if (!items.length) return "";
  const lines = [
    "[Naver Search Results]",
    `Query: ${query}`,
    "Use these results only as external web evidence. Cite supporting items with [W1], [W2], etc. If the results do not verify a claim, say that the search results do not confirm it."
  ];

  items.forEach((item, index) => {
    const parts = [
      `[W${index + 1}] ${item.title}`,
      `Source: ${TYPE_LABELS[item.type] || item.type}${item.sourceName ? ` / ${item.sourceName}` : ""}`,
      `URL: ${item.link}`
    ];
    if (item.date) parts.push(`Date: ${item.date}`);
    if (item.description) parts.push(`Summary: ${item.description.slice(0, 500)}`);
    lines.push(parts.join("\n"));
  });

  return lines.join("\n\n");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}
