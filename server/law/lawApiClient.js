import { getLawConfig, maskLawSecrets } from "./lawConfig.js";
import { getCachedLawResponse, setCachedLawResponse, buildLawCacheKey } from "./lawCache.js";
import { normalizeArticleRef, normalizeLawName } from "./lawArticleRef.js";
import { LAW_ERROR_MARKERS, LawError, assertLawAvailable } from "./lawErrors.js";
import { throwIfAborted } from "../abort.js";

const LAW_TEXT_TTL_MS = 7 * 86_400_000;
const LAW_SEARCH_TTL_MS = 86_400_000;

export class LawApiClient {
  constructor(config = getLawConfig()) {
    this.config = config;
  }

  async status() {
    return {
      enabled: this.config.enabled,
      configured: this.config.configured,
      provider: this.config.apiProvider
    };
  }

  async searchLaw({ query, display } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = normalizeLawName(query);
    if (!normalizedQuery) {
      throw new LawError("Law search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100)
    };
    const cacheKey = buildLawCacheKey("search_law", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const payload = await this.requestSearch({
      target: "law",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    }, { signal });
    const results = normalizeSearchResults(payload).slice(0, normalizedInput.display);
    const response = { ok: results.length > 0, query: normalizedQuery, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getLawArticle({ lawName, lawId, mst, article, paragraph, item, subitem, effectiveDate } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    const articleRef = normalizeArticleRef(article);
    if (!articleRef.canonical || !articleRef.joCode) {
      throw new LawError("A valid article reference is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }

    let resolved = { lawName: normalizedLawName, lawId, mst, effectiveDate };
    if (!resolved.lawId && !resolved.mst) {
      const search = await this.searchLaw({ query: normalizedLawName, display: 5 }, { signal });
      resolved = chooseLawSearchResult(search.results, normalizedLawName) || resolved;
    }
    if (!resolved.lawId && !resolved.mst) {
      throw new LawError(`Law not found: ${normalizedLawName}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }

    const normalizedInput = {
      lawName: resolved.lawName || normalizedLawName,
      lawId: resolved.lawId || "",
      mst: resolved.mst || "",
      article: articleRef.canonical,
      paragraph: paragraph || "",
      item: item || "",
      subitem: subitem || ""
    };
    const cacheKey = buildLawCacheKey("article_detail", normalizedInput, effectiveDate || resolved.effectiveDate || "");
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_TEXT_TTL_MS, lastModified: resolved.lastModified || "" });
    if (cached) return { ...cached, cacheHit: true };

    const params = {
      target: "lawjosub",
      type: "JSON",
      JO: articleRef.joCode
    };
    if (resolved.lawId) params.ID = resolved.lawId;
    else params.MST = resolved.mst;
    if (paragraph?.code) params.HANG = paragraph.code;
    if (item?.code) params.HO = item.code;

    const payload = await this.requestService(params, { signal });
    const articleData = normalizeArticlePayload(payload, {
      lawName: resolved.lawName || normalizedLawName,
      lawId: resolved.lawId || "",
      mst: resolved.mst || "",
      articleRef
    });
    if (!articleData.text) {
      throw new LawError(`${normalizedInput.lawName} ${articleRef.canonical} was not found in official law data.`, {
        marker: LAW_ERROR_MARKERS.NOT_FOUND,
        statusCode: 404
      });
    }
    const response = {
      ok: true,
      citation: buildCitation(articleData, articleRef),
      text: articleData.text,
      raw: articleData.raw
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_TEXT_TTL_MS, lastModified: articleData.lastModified || "" });
    return { ...response, cacheHit: false };
  }

  async requestSearch(params, options) {
    return this.request(this.config.searchUrl, params, options);
  }

  async requestService(params, options) {
    return this.request(this.config.serviceUrl, params, options);
  }

  async request(baseUrl, params = {}, { signal } = {}) {
    throwIfAborted(signal);
    const url = new URL(baseUrl);
    url.searchParams.set("OC", this.config.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal: combinedSignal,
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: "application/json, text/plain, */*"
        }
      });
    } catch (error) {
      throw new LawError(maskLawSecrets(`Law API network error: ${error.message}`), {
        marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
        statusCode: 502,
        cause: error
      });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new LawError(maskLawSecrets(`Law API HTTP ${response.status}: ${text.slice(0, 400)}`), {
        marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
        statusCode: 502
      });
    }
    const payload = parseJson(text);
    const upstreamError = findUpstreamError(payload);
    if (upstreamError) {
      throw new LawError(maskLawSecrets(upstreamError), {
        marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
        statusCode: 502
      });
    }
    return payload;
  }
}

export function createLawApiClient() {
  return new LawApiClient();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new LawError("Law API returned invalid JSON.", {
      marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
      statusCode: 502
    });
  }
}

function findUpstreamError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.result && String(payload.result).includes("실패")) return String(payload.msg || payload.result);
  if (payload.error) return String(payload.error);
  if (payload.Error) return String(payload.Error);
  return "";
}

function normalizeSearchResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const lawName = readFirst(item, ["법령명한글", "법령명", "법령명_한글", "lawName", "name"]);
    const lawId = readFirst(item, ["법령ID", "법령아이디", "ID", "id", "lawId"]);
    const mst = readFirst(item, ["법령일련번호", "MST", "mst", "lsiSeq"]);
    return lawName && (lawId || mst);
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const lawName = stripHtml(readFirst(item, ["법령명한글", "법령명", "법령명_한글", "lawName", "name"]));
    const lawId = readFirst(item, ["법령ID", "법령아이디", "ID", "id", "lawId"]);
    const mst = readFirst(item, ["법령일련번호", "MST", "mst", "lsiSeq"]);
    const key = `${lawName}|${lawId}|${mst}`;
    if (!lawName || seen.has(key)) continue;
    seen.add(key);
    results.push({
      lawName,
      lawId: String(lawId || ""),
      mst: String(mst || ""),
      lawType: stripHtml(readFirst(item, ["법령구분명", "법령구분", "lawType"])),
      effectiveDate: normalizeDate(readFirst(item, ["시행일자", "시행일", "effectiveDate", "efYd"])),
      promulgationDate: normalizeDate(readFirst(item, ["공포일자", "promulgationDate"])),
      lastModified: normalizeDate(readFirst(item, ["개정일자", "최종수정일자", "lastModified"])),
      raw: item
    });
  }
  return results;
}

function chooseLawSearchResult(results, lawName) {
  const target = normalizeComparableLawName(lawName);
  const items = Array.isArray(results) ? results : [];
  return items.find((item) => normalizeComparableLawName(item.lawName) === target)
    || items.find((item) => normalizeComparableLawName(item.lawName).includes(target))
    || items[0]
    || null;
}

function normalizeArticlePayload(payload, { lawName, lawId, mst, articleRef }) {
  const objects = findObjects(payload);
  const articleObjects = objects.filter((item) => {
    const jo = readFirst(item, ["조문번호", "조문가지번호", "JO", "jo"]);
    const title = readFirst(item, ["조문제목", "제목", "title"]);
    const body = readFirst(item, ["조문내용", "조문내용문", "내용", "text"]);
    return jo || title || body;
  });
  const preferred = articleObjects.find((item) => {
    const code = String(readFirst(item, ["조문번호", "JO", "jo"]) || "").padStart(4, "0")
      + String(readFirst(item, ["조문가지번호"]) || "0").padStart(2, "0");
    return code === articleRef.joCode;
  }) || articleObjects[0] || {};

  const text = collectArticleText(preferred || payload);
  return {
    lawName: stripHtml(readFirst(payload, ["법령명_한글", "법령명한글", "법령명", "lawName"])) || lawName,
    lawId: readFirst(payload, ["법령ID", "ID", "lawId"]) || lawId,
    mst: readFirst(payload, ["법령일련번호", "MST", "mst"]) || mst,
    article: articleRef.canonical,
    joCode: articleRef.joCode,
    title: stripHtml(readFirst(preferred, ["조문제목", "제목", "title"])),
    effectiveDate: normalizeDate(readFirst(payload, ["시행일자", "시행일", "effectiveDate", "efYd"])),
    lastModified: normalizeDate(readFirst(payload, ["개정일자", "최종수정일자", "lastModified"])),
    text,
    raw: preferred
  };
}

function collectArticleText(value) {
  const pieces = [];
  walk(value, (item, key) => {
    if (item == null) return;
    const keyText = String(key || "");
    if (typeof item === "string" || typeof item === "number") {
      if (/^(조문내용|항내용|호내용|목내용|내용|본문|text)$/u.test(keyText)) {
        const text = stripHtml(item);
        if (text) pieces.push(text);
      }
    }
  });
  if (!pieces.length && typeof value === "string") pieces.push(stripHtml(value));
  return Array.from(new Set(pieces)).join("\n").trim();
}

function buildCitation(articleData, articleRef) {
  const locator = `${articleData.lawName} ${articleRef.canonical}`;
  return {
    citationId: "L1",
    sourceType: "law",
    lawName: articleData.lawName,
    lawId: articleData.lawId,
    mst: articleData.mst,
    article: articleRef.canonical,
    canonical: `${articleData.lawName}/${articleRef.canonical}`,
    title: articleData.title,
    locator,
    effectiveDate: articleData.effectiveDate,
    url: buildPublicLawUrl(articleData.lawName, articleRef.canonical)
  };
}

function buildPublicLawUrl(lawName, article) {
  const query = encodeURIComponent(`${lawName} ${article}`.trim());
  return `https://www.law.go.kr/법령/${query}`;
}

function findObjects(value) {
  const results = [];
  walk(value, (item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) results.push(item);
  });
  return results;
}

function walk(value, visitor, key = "") {
  visitor(value, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, String(index)));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      walk(childValue, visitor, childKey);
    }
  }
}

function readFirst(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    if (object[key] != null && object[key] !== "") return String(object[key]).trim();
  }
  return "";
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const text = String(value || "").replace(/[^\d]/g, "");
  if (text.length === 8) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return String(value || "").trim();
}

function normalizeComparableLawName(value) {
  return normalizeLawName(value).replace(/\s+/g, "").toLowerCase();
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
