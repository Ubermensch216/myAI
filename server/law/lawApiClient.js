import { getLawConfig, maskLawSecrets } from "./lawConfig.js";
import { getCachedLawResponse, setCachedLawResponse, buildLawCacheKey } from "./lawCache.js";
import { normalizeArticleRef, normalizeLawName } from "./lawArticleRef.js";
import { LAW_ERROR_MARKERS, LawError, assertLawAvailable } from "./lawErrors.js";
import { throwIfAborted } from "../abort.js";
import {
  buildAdminRuleCitation,
  buildCitation,
  buildInterpretationCitation,
  buildOrdinanceCitation,
  buildPrecedentCitation,
  buildPublicLawUrl,
  chooseLawSearchResult,
  findUpstreamError,
  normalizeAdminRulePayload,
  normalizeAdminRuleResults,
  normalizeArticlePayload,
  normalizeInterpretationPayload,
  normalizeInterpretationResults,
  normalizeOrdinancePayload,
  normalizeOrdinanceResults,
  normalizePrecedentPayload,
  normalizePrecedentResults,
  normalizeSearchResults
} from "./lawApiParser.js";

const LAW_TEXT_TTL_MS = 7 * 86_400_000;
const LAW_SEARCH_TTL_MS = 86_400_000;
const PRECEDENT_TTL_MS = 30 * 86_400_000;
const INTERPRETATION_TTL_MS = 30 * 86_400_000;
const ADMIN_RULE_TTL_MS = 7 * 86_400_000;
const ORDINANCE_TTL_MS = 7 * 86_400_000;

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
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const payload = await this.requestSearch({
      target: "law",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    }, { signal });
    const results = stripLawPrivateFields(normalizeSearchResults(payload).slice(0, normalizedInput.display));
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
    if (cached) {
      const stripped = stripLawPrivateFields(cached);
      if (stripped.citation) {
        stripped.citation = { ...stripped.citation, url: buildPublicLawUrl(stripped.citation.lawName, stripped.citation.article, stripped.citation.mst) };
      }
      return { ...stripped, cacheHit: true };
    }

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
      text: articleData.text
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_TEXT_TTL_MS, lastModified: articleData.lastModified || "" });
    return { ...response, cacheHit: false };
  }

  async searchPrecedents({ query, display, court, caseType } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("Precedent search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      court: court || "",
      caseType: caseType || ""
    };
    const cacheKey = buildLawCacheKey("search_precedent", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const params = {
      target: "prec",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    };
    if (court) params.curt = court;
    if (caseType) params.caseClass = caseType;

    const payload = await this.requestSearch(params, { signal });
    const results = stripLawPrivateFields(normalizePrecedentResults(payload).slice(0, normalizedInput.display));
    const response = { ok: results.length > 0, query: normalizedQuery, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getPrecedentDetail({ precId, caseNumber } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    let resolvedId = String(precId || "").trim();
    if (!resolvedId && caseNumber) {
      const search = await this.searchPrecedents({ query: caseNumber, display: 5 }, { signal });
      const exact = search.results.find((item) => item.caseNumber === String(caseNumber).trim());
      resolvedId = (exact || search.results[0])?.precId || "";
    }
    if (!resolvedId) {
      throw new LawError("Precedent ID is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("precedent_detail", { precId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: PRECEDENT_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const payload = await this.requestService({
      target: "prec",
      type: "JSON",
      ID: resolvedId
    }, { signal });
    const data = normalizePrecedentPayload(payload);
    if (!data.text && !data.title) {
      throw new LawError(`Precedent not found: ${resolvedId}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }
    if (!data.precId) data.precId = resolvedId;
    const response = {
      ok: true,
      citation: buildPrecedentCitation(data),
      text: data.text
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: PRECEDENT_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async searchInterpretations({ query, display, agency } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("Interpretation search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      agency: agency || ""
    };
    const cacheKey = buildLawCacheKey("search_interpretation", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached && !hasStaleInterpretationSearchCache(cached)) {
      return { ...stripLawPrivateFields(cached), cacheHit: true };
    }

    const params = {
      target: "expc",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    };
    if (agency) params.org = agency;

    const payload = await this.requestSearch(params, { signal });
    const results = stripLawPrivateFields(normalizeInterpretationResults(payload).slice(0, normalizedInput.display));
    const response = { ok: results.length > 0, query: normalizedQuery, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getInterpretationDetail({ expcId, query } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    let resolvedId = String(expcId || "").trim();
    if (!resolvedId && query) {
      const search = await this.searchInterpretations({ query, display: 1 }, { signal });
      resolvedId = search.results[0]?.expcId || "";
    }
    if (!resolvedId) {
      throw new LawError("Interpretation ID is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("interpretation_detail", { expcId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: INTERPRETATION_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const payload = await this.requestService({
      target: "expc",
      type: "JSON",
      ID: resolvedId
    }, { signal });
    const data = normalizeInterpretationPayload(payload);
    if (!data.text && !data.title) {
      throw new LawError(`Interpretation not found: ${resolvedId}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }
    if (!data.expcId) data.expcId = resolvedId;
    const response = {
      ok: true,
      citation: buildInterpretationCitation(data),
      text: data.text
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: INTERPRETATION_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async searchAdminRules({ query, display, agency } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("Admin rule search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      agency: agency || ""
    };
    const cacheKey = buildLawCacheKey("search_admin_rule", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const params = {
      target: "admrul",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    };
    if (agency) params.org = agency;

    const payload = await this.requestSearch(params, { signal });
    const results = stripLawPrivateFields(normalizeAdminRuleResults(payload).slice(0, normalizedInput.display));
    const response = { ok: results.length > 0, query: normalizedQuery, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getAdminRuleDetail({ admrulId, query } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    let resolvedId = String(admrulId || "").trim();
    if (!resolvedId && query) {
      const search = await this.searchAdminRules({ query, display: 1 }, { signal });
      resolvedId = search.results[0]?.admrulId || "";
    }
    if (!resolvedId) {
      throw new LawError("Admin rule ID is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("admin_rule_detail", { admrulId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: ADMIN_RULE_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const payload = await this.requestService({
      target: "admrul",
      type: "JSON",
      ID: resolvedId
    }, { signal });
    const data = normalizeAdminRulePayload(payload);
    if (!data.text && !data.title) {
      throw new LawError(`Admin rule not found: ${resolvedId}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }
    if (!data.admrulId) data.admrulId = resolvedId;
    const response = {
      ok: true,
      citation: buildAdminRuleCitation(data),
      text: data.text
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: ADMIN_RULE_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async searchOrdinances({ query, display, region } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("Ordinance search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      region: region || ""
    };
    const cacheKey = buildLawCacheKey("search_ordinance", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const params = {
      target: "ordin",
      type: "JSON",
      query: normalizedQuery,
      display: normalizedInput.display
    };
    if (region) params.org = region;

    const payload = await this.requestSearch(params, { signal });
    const results = stripLawPrivateFields(normalizeOrdinanceResults(payload).slice(0, normalizedInput.display));
    const response = { ok: results.length > 0, query: normalizedQuery, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getOrdinanceDetail({ ordinId, query } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    let resolvedId = String(ordinId || "").trim();
    if (!resolvedId && query) {
      const search = await this.searchOrdinances({ query, display: 1 }, { signal });
      resolvedId = search.results[0]?.ordinId || "";
    }
    if (!resolvedId) {
      throw new LawError("Ordinance ID is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("ordinance_detail", { ordinId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: ORDINANCE_TTL_MS });
    if (cached?.text) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const payload = await this.requestService({
      target: "ordin",
      type: "JSON",
      MST: resolvedId
    }, { signal });
    const data = normalizeOrdinancePayload(payload);
    if (!data.text && !data.title) {
      throw new LawError(`Ordinance not found: ${resolvedId}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }
    if (!data.ordinId) data.ordinId = resolvedId;
    const response = {
      ok: true,
      citation: buildOrdinanceCitation(data),
      text: data.text
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: ORDINANCE_TTL_MS });
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

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function stripLawPrivateFields(value) {
  if (Array.isArray(value)) return value.map((item) => stripLawPrivateFields(item));
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "raw") continue;
    clean[key] = stripLawPrivateFields(item);
  }
  return clean;
}

function hasStaleInterpretationSearchCache(value) {
  const results = Array.isArray(value?.results) ? value.results : [];
  return results.some((item) => /^\d{2}-\d{4}$/.test(String(item?.expcId || "")));
}
