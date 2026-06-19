import { getLawConfig, maskLawSecrets } from "./lawConfig.js";
import { getCachedLawResponse, setCachedLawResponse, buildLawCacheKey } from "./lawCache.js";
import { normalizeArticleRef, normalizeEffectiveDate, normalizeLawName, extractLawCitations } from "./lawArticleRef.js";
import { LAW_ERROR_MARKERS, LawError, assertLawAvailable } from "./lawErrors.js";
import { throwIfAborted } from "../abort.js";
import {
  buildAdminRuleCitation,
  buildAnnexCitation,
  buildCitation,
  buildInterpretationCitation,
  buildOrdinanceCitation,
  buildPrecedentCitation,
  buildPublicLawUrl,
  chooseLawSearchResult,
  findUpstreamError,
  normalizeAdminRulePayload,
  normalizeAdminRuleResults,
  normalizeAiSearchResults,
  normalizeAnnexPayload,
  normalizeAnnexResults,
  parseAiSearchXml,
  normalizeArticlePayload,
  normalizeComparableLawName,
  normalizeHistoryResults,
  normalizeInterpretationPayload,
  normalizeInterpretationResults,
  normalizeLawTextPayload,
  normalizeOrdinancePayload,
  normalizeOrdinanceResults,
  normalizePrecedentPayload,
  normalizePrecedentResults,
  normalizeSearchResults
} from "./lawApiParser.js";

const LAW_TEXT_TTL_MS = 7 * 86_400_000;
// Historical snapshots are immutable past their effective date, so cache aggressively.
const LAW_HISTORICAL_TTL_MS = 30 * 86_400_000;
const LAW_HISTORY_TTL_MS = 7 * 86_400_000;
const LAW_SEARCH_TTL_MS = 86_400_000;
const PRECEDENT_TTL_MS = 30 * 86_400_000;
const INTERPRETATION_TTL_MS = 30 * 86_400_000;
const ADMIN_RULE_TTL_MS = 7 * 86_400_000;
const ORDINANCE_TTL_MS = 7 * 86_400_000;
const ANNEX_TTL_MS = 7 * 86_400_000;

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

  async searchAiLaw({ query, searchType = 0, display } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("AI law search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      searchType: Number(searchType || 0),
      display: clampInt(display, this.config.maxResults, 1, 100)
    };
    const cacheKey = buildLawCacheKey("search_ai_law_v2", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const rawText = await this.requestRaw(this.config.searchUrl, {
      target: "aiSearch",
      query: normalizedQuery,
      search: normalizedInput.searchType,
      display: normalizedInput.display
    }, { signal });
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = parseAiSearchXml(rawText);
    }
    const upstreamError = findUpstreamError(payload);
    if (upstreamError) {
      throw new LawError(maskLawSecrets(upstreamError), {
        marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
        statusCode: 502
      });
    }
    const results = stripLawPrivateFields(normalizeAiSearchResults(payload).slice(0, normalizedInput.display));
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
    const effective = normalizeEffectiveDate(effectiveDate);
    const isHistorical = Boolean(effective.compact);

    let resolved = { lawName: normalizedLawName, lawId, mst, effectiveDate: effective.iso };
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
    const cacheTool = isHistorical ? "article_at" : "article_detail";
    const cacheTtl = isHistorical ? LAW_HISTORICAL_TTL_MS : LAW_TEXT_TTL_MS;
    const cacheKey = buildLawCacheKey(cacheTool, normalizedInput, effective.iso || resolved.effectiveDate || "");
    // Historical snapshots are immutable, so the lastModified gate is skipped.
    const cacheLookupOpts = isHistorical
      ? { ttlMs: cacheTtl }
      : { ttlMs: cacheTtl, lastModified: resolved.lastModified || "" };
    const cached = await getCachedLawResponse(cacheKey, cacheLookupOpts);
    if (cached) {
      const stripped = stripLawPrivateFields(cached);
      if (stripped.citation) {
        stripped.citation = { ...stripped.citation, url: buildPublicLawUrl(stripped.citation.lawName, stripped.citation.article, stripped.citation.mst) };
      }
      return { ...stripped, cacheHit: true };
    }

    const params = isHistorical
      ? { target: "eflawjosub", type: "JSON", JO: articleRef.joCode, efYd: effective.compact }
      : { target: "lawjosub", type: "JSON", JO: articleRef.joCode };
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
      const dateSuffix = isHistorical ? ` (시행일자 ${effective.iso} 기준)` : "";
      throw new LawError(`${normalizedInput.lawName} ${articleRef.canonical} was not found in official law data${dateSuffix}.`, {
        marker: LAW_ERROR_MARKERS.NOT_FOUND,
        statusCode: 404
      });
    }
    const response = {
      ok: true,
      citation: buildCitation(articleData, articleRef),
      text: articleData.text,
      effectiveDateRequested: effective.iso || ""
    };
    const cacheWriteOpts = isHistorical
      ? { ttlMs: cacheTtl }
      : { ttlMs: cacheTtl, lastModified: articleData.lastModified || "" };
    await setCachedLawResponse(cacheKey, response, cacheWriteOpts);
    return { ...response, cacheHit: false };
  }

  async getLawText({ lawName, lawId, mst, effectiveDate } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    const effective = normalizeEffectiveDate(effectiveDate);
    const isHistorical = Boolean(effective.compact);

    let resolved = { lawName: normalizedLawName, lawId, mst, effectiveDate: effective.iso };
    if (isHistorical && !resolved.mst) {
      const history = await this.getLawHistory({ lawName: normalizedLawName, lawId, mst }, { signal });
      const revision = chooseRevisionForDate(history.revisions, effective.iso);
      if (revision?.mst) {
        resolved = {
          lawName: revision.title || history.lawName || normalizedLawName,
          lawId: history.lawId || lawId || "",
          mst: revision.mst,
          effectiveDate: revision.effectiveDate || effective.iso
        };
      } else {
        throw new LawError(`Historical law snapshot not found for ${normalizedLawName || lawId || mst} at ${effective.iso}.`, {
          marker: LAW_ERROR_MARKERS.NOT_FOUND,
          statusCode: 404
        });
      }
    }

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
      effectiveDate: effective.iso || resolved.effectiveDate || ""
    };
    const cacheKey = buildLawCacheKey(isHistorical ? "law_text_at" : "law_text", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: isHistorical ? LAW_HISTORICAL_TTL_MS : LAW_TEXT_TTL_MS });
    if (cached) {
      const stripped = stripLawPrivateFields(cached);
      if (stripped.citation) {
        stripped.citation = { ...stripped.citation, url: buildPublicLawUrl(stripped.citation.lawName, "", stripped.citation.mst) };
      }
      return { ...stripped, cacheHit: true };
    }

    const params = { target: "law", type: "JSON" };
    if (resolved.mst) params.MST = resolved.mst;
    else params.ID = resolved.lawId;

    const payload = await this.requestService(params, { signal });
    const data = normalizeLawTextPayload(payload, {
      lawName: resolved.lawName || normalizedLawName,
      lawId: resolved.lawId || "",
      mst: resolved.mst || ""
    });
    if (!data.text) {
      throw new LawError(`${normalizedInput.lawName || "Law"} text was not found in official law data.`, {
        marker: LAW_ERROR_MARKERS.NOT_FOUND,
        statusCode: 404
      });
    }
    const citation = buildLawTextCitation(data, effective.iso || resolved.effectiveDate || data.effectiveDate);
    const response = {
      ok: true,
      citation,
      text: data.text,
      effectiveDateRequested: effective.iso || "",
      snapshotEffectiveDate: citation.effectiveDate || ""
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: isHistorical ? LAW_HISTORICAL_TTL_MS : LAW_TEXT_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getLawHistory({ lawName, lawId, mst } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    let resolved = { lawName: normalizedLawName, lawId, mst };
    if (!resolved.lawId && !resolved.mst) {
      if (!normalizedLawName) {
        throw new LawError("lawName, lawId, or mst is required for history lookup.", {
          marker: LAW_ERROR_MARKERS.NOT_FOUND,
          statusCode: 400
        });
      }
      const search = await this.searchLaw({ query: normalizedLawName, display: 5 }, { signal });
      resolved = chooseLawSearchResult(search.results, normalizedLawName) || resolved;
    }
    if (!resolved.lawId && !resolved.mst) {
      throw new LawError(`Law not found: ${normalizedLawName}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }

    const historyTarget = this.config.historyTarget || "eflaw";
    const normalizedInput = {
      lawName: resolved.lawName || normalizedLawName,
      lawId: resolved.lawId || "",
      mst: resolved.mst || "",
      target: historyTarget
    };
    const cacheKey = buildLawCacheKey("law_history", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_HISTORY_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };
    const params = {
      target: historyTarget,
      type: "JSON"
    };
    // `eflaw` (시행일자별 검색) is the live law.go.kr endpoint that returns
    // every effective-date version of a law. It is a search-style endpoint, so
    // ID/MST do not filter — we must search by query and post-filter by exact
    // lawName. Legacy `lsHstInq` (which never returned data in production) is
    // kept here only for env-driven override compatibility; in that case fall
    // back to the historical ID/MST/LM shape.
    if (historyTarget === "eflaw") {
      params.query = resolved.lawName || normalizedLawName;
      params.display = 100;
    } else {
      if (resolved.lawId) params.ID = resolved.lawId;
      if (resolved.mst) params.MST = resolved.mst;
      if (normalizedLawName && !params.ID && !params.MST) params.LM = normalizedLawName;
    }

    const payload = await this.requestSearch(params, { signal });
    let revisions = normalizeHistoryResults(payload);
    if (historyTarget === "eflaw") {
      const expectedKey = normalizeComparableLawName(resolved.lawName || normalizedLawName);
      if (expectedKey) {
        revisions = revisions.filter((rev) => normalizeComparableLawName(rev.title) === expectedKey);
      }
    }
    revisions = stripLawPrivateFields(revisions);
    const response = {
      ok: revisions.length > 0,
      lawName: resolved.lawName || normalizedLawName,
      lawId: resolved.lawId || "",
      mst: resolved.mst || "",
      revisions
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_HISTORY_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async searchPrecedents({ query, display, court, caseType, search } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new LawError("Precedent search query is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    // law.go.kr 검색범위: 1=판례명/사건명, 2=본문(판시사항·판결요지 등). 기본값은 1.
    const searchScope = search === 1 || search === 2 ? search : 0;
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      court: court || "",
      caseType: caseType || "",
      search: searchScope
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
    if (searchScope) params.search = searchScope;
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

  async searchAnnexes({
    query,
    display,
    lawName,
    lawId,
    mst,
    annexId,
    annexNo,
    annexTitle,
    formNo,
    annexType
  } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedQuery = String(query || lawName || "").trim();
    const selector = normalizeAnnexSelector({ annexId, annexNo, annexTitle, formNo, annexType });
    if (!normalizedQuery && !lawId && !mst) {
      throw new LawError("Annex search requires query, lawName, lawId, or mst.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const normalizedInput = {
      query: normalizedQuery,
      display: clampInt(display, this.config.maxResults, 1, 100),
      lawId: lawId || "",
      mst: mst || "",
      selector
    };
    const cacheKey = buildLawCacheKey("search_annexes", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: ANNEX_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const params = { target: "annex", type: "JSON", display: normalizedInput.display };
    if (normalizedQuery) params.query = normalizedQuery;
    if (normalizedInput.mst) params.MST = normalizedInput.mst;
    else if (normalizedInput.lawId) params.ID = normalizedInput.lawId;

    const payload = await this.requestSearch(params, { signal });
    const ranked = rankAnnexResults(normalizeAnnexResults(payload), selector);
    const results = stripLawPrivateFields(ranked.slice(0, normalizedInput.display));
    const response = { ok: results.length > 0, query: normalizedQuery, results, selector };
    await setCachedLawResponse(cacheKey, response, { ttlMs: ANNEX_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getAnnexDetail({
    mst,
    lawId,
    lawName,
    query,
    annexId,
    annexNo,
    annexTitle,
    formNo,
    annexType
  } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    let resolvedMst = String(mst || "").trim();
    let resolvedId = String(lawId || "").trim();
    let selection = null;
    const selector = normalizeAnnexSelector({ annexId, annexNo, annexTitle, formNo, annexType });
    if (!resolvedMst && !resolvedId && (lawName || query)) {
      const search = await this.searchAnnexes({
        query: lawName || query,
        display: hasAnnexSelector(selector) ? 20 : 2,
        annexId,
        annexNo,
        annexTitle,
        formNo,
        annexType
      }, { signal });
      const ranked = rankAnnexResults(search.results || [], selector);
      if (hasAnnexSelector(selector)) {
        const topScore = ranked[0]?.selectionScore || 0;
        const top = ranked.filter((item) => item.selectionScore === topScore && topScore > 0);
        if (top.length > 1) {
          throw Object.assign(
            new LawError("Annex selector matched multiple records.", { marker: "ANNEX_AMBIGUOUS", statusCode: 409 }),
            { candidates: top.map((item) => stripLawPrivateFields(item)) }
          );
        }
        if (!top.length) {
          throw new LawError("No annex matched the requested selector.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
        }
        resolvedMst = top[0]?.mst || "";
        resolvedId = top[0]?.lawId || "";
        selection = { method: "selector", ambiguous: false, selector, selected: stripLawPrivateFields(top[0]) };
      } else {
        resolvedMst = ranked[0]?.mst || "";
        resolvedId = ranked[0]?.lawId || "";
        selection = { method: "first_result", ambiguous: ranked.length > 1, selector };
      }
    }
    if (!resolvedMst && !resolvedId) {
      throw new LawError("Annex lookup requires mst, lawId, lawName, or query.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("annex_detail", { mst: resolvedMst, lawId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: ANNEX_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const params = { target: "annex", type: "JSON" };
    if (resolvedMst) params.MST = resolvedMst;
    else params.ID = resolvedId;

    const payload = await this.requestService(params, { signal });
    const data = normalizeAnnexPayload(payload);
    if (!data.text && !data.title) {
      throw new LawError(`Annex not found for ${resolvedMst || resolvedId}`, { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 404 });
    }
    const response = {
      ok: true,
      citation: buildAnnexCitation(data),
      text: data.text,
      results: Array.isArray(data.results) ? stripLawPrivateFields(data.results) : [],
      selection: selection || { method: resolvedMst || resolvedId ? "direct" : "unknown", ambiguous: false, selector }
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: ANNEX_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getThreeTier({ lawName } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    if (!normalizedLawName) {
      throw new LawError("lawName is required for three-tier lookup.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const cacheKey = buildLawCacheKey("three_tier", { lawName: normalizedLawName });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    const [lawResult, decreeResult, ruleResult] = await Promise.all([
      this.searchLaw({ query: normalizedLawName, display: 3 }, { signal }).catch(() => ({ results: [] })),
      this.searchLaw({ query: `${normalizedLawName} 시행령`, display: 3 }, { signal }).catch(() => ({ results: [] })),
      this.searchLaw({ query: `${normalizedLawName} 시행규칙`, display: 3 }, { signal }).catch(() => ({ results: [] }))
    ]);

    const pickBest = (results, expectedSuffix) => {
      if (!results?.length) return null;
      const exact = results.find((r) => r.lawName === normalizedLawName + (expectedSuffix || ""));
      const fuzzy = results.find((r) => r.lawName.includes(normalizedLawName));
      return exact || fuzzy || results[0] || null;
    };

    const law = pickBest(lawResult.results || [], "");
    const decree = pickBest(decreeResult.results || [], " 시행령");
    const rule = pickBest(ruleResult.results || [], " 시행규칙");

    const response = {
      ok: Boolean(law),
      lawName: normalizedLawName,
      tiers: {
        law: law ? { lawName: law.lawName, lawId: law.lawId, mst: law.mst, effectiveDate: law.effectiveDate, found: true } : { found: false },
        decree: decree ? { lawName: decree.lawName, lawId: decree.lawId, mst: decree.mst, effectiveDate: decree.effectiveDate, found: true } : { found: false },
        rule: rule ? { lawName: rule.lawName, lawId: rule.lawId, mst: rule.mst, effectiveDate: rule.effectiveDate, found: true } : { found: false }
      }
    };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getDelegatedLaws({ lawName, mst, lawId } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    let resolvedMst = String(mst || "").trim();
    let resolvedId = String(lawId || "").trim();

    if (!resolvedMst && !resolvedId && normalizedLawName) {
      const search = await this.searchLaw({ query: normalizedLawName, display: 3 }, { signal });
      const best = chooseLawSearchResult(search.results, normalizedLawName);
      resolvedMst = best?.mst || "";
      resolvedId = best?.lawId || "";
    }

    if (!resolvedMst && !resolvedId) {
      throw new LawError("lawName, mst, or lawId is required for delegated law lookup.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }

    const cacheKey = buildLawCacheKey("delegated_laws", { mst: resolvedMst, lawId: resolvedId });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: LAW_SEARCH_TTL_MS });
    if (cached) return { ...stripLawPrivateFields(cached), cacheHit: true };

    let results = [];
    try {
      const params = { target: "sublaw", type: "JSON" };
      if (resolvedMst) params.MST = resolvedMst;
      else params.ID = resolvedId;
      const payload = await this.requestService(params, { signal });
      results = stripLawPrivateFields(normalizeSearchResults(payload));
    } catch {
      if (normalizedLawName) {
        const [d, r] = await Promise.all([
          this.searchLaw({ query: `${normalizedLawName} 시행령`, display: 5 }, { signal }).catch(() => ({ results: [] })),
          this.searchLaw({ query: `${normalizedLawName} 시행규칙`, display: 5 }, { signal }).catch(() => ({ results: [] }))
        ]);
        results = [...(d.results || []), ...(r.results || [])];
      }
    }

    const response = { ok: results.length > 0, lawName: normalizedLawName, results };
    await setCachedLawResponse(cacheKey, response, { ttlMs: LAW_SEARCH_TTL_MS });
    return { ...response, cacheHit: false };
  }

  async getLinkedOrdinances({ lawName, region, display } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const normalizedLawName = normalizeLawName(lawName);
    if (!normalizedLawName) {
      throw new LawError("lawName is required for linked ordinance search.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    return this.searchOrdinances({ query: normalizedLawName, display, region }, { signal });
  }

  async getLinkedOrdinanceArticles({ ordinId, lawName, query } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const resolvedId = String(ordinId || "").trim();
    if (!resolvedId) {
      throw new LawError("ordinId is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const detail = await this.getOrdinanceDetail({ ordinId: resolvedId, query }, { signal });
    const text = detail.text || "";
    const articles = parseArticleSections(text, lawName);
    return {
      ok: true,
      ordinId: resolvedId,
      ordinTitle: detail.citation?.title || "",
      lawName: lawName || "",
      articles,
      cacheHit: Boolean(detail.cacheHit)
    };
  }

  async getLinkedLawsFromOrdinance({ ordinId, query } = {}, { signal } = {}) {
    assertLawAvailable(this.config);
    const resolvedId = String(ordinId || "").trim();
    if (!resolvedId) {
      throw new LawError("ordinId is required.", { marker: LAW_ERROR_MARKERS.NOT_FOUND, statusCode: 400 });
    }
    const detail = await this.getOrdinanceDetail({ ordinId: resolvedId, query }, { signal });
    const text = detail.text || "";
    const citations = extractLawCitations(text);
    const seen = new Set();
    const laws = citations.filter((c) => {
      if (seen.has(c.canonical)) return false;
      seen.add(c.canonical);
      return true;
    });
    return {
      ok: true,
      ordinId: resolvedId,
      ordinTitle: detail.citation?.title || "",
      laws,
      cacheHit: Boolean(detail.cacheHit)
    };
  }

  async requestSearch(params, options) {
    return this.request(this.config.searchUrl, params, options);
  }

  async requestRaw(baseUrl, params = {}, { signal } = {}) {
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
          Accept: "text/xml, application/json, */*"
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
    return text;
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

function normalizeAnnexSelector(input = {}) {
  return {
    annexId: String(input.annexId || "").trim(),
    annexNo: String(input.annexNo || "").trim(),
    annexTitle: String(input.annexTitle || "").trim(),
    formNo: String(input.formNo || "").trim(),
    annexType: String(input.annexType || "").trim()
  };
}

function hasAnnexSelector(selector = {}) {
  return Boolean(selector.annexId || selector.annexNo || selector.annexTitle || selector.formNo || selector.annexType);
}

function rankAnnexResults(results = [], selector = {}) {
  const list = Array.isArray(results) ? results : [];
  if (!hasAnnexSelector(selector)) {
    return list.map((item) => ({ ...item, selectionScore: 0 }));
  }
  return list
    .map((item) => ({ ...item, selectionScore: scoreAnnexResult(item, selector) }))
    .filter((item) => item.selectionScore > 0)
    .sort((a, b) => b.selectionScore - a.selectionScore || String(a.title || "").localeCompare(String(b.title || "")));
}

function scoreAnnexResult(item = {}, selector = {}) {
  let score = 0;
  if (selector.annexId) {
    if (normalizeSelectorText(item.annexId) !== normalizeSelectorText(selector.annexId)) return 0;
    score += 100;
  }
  if (selector.annexNo || selector.formNo) {
    const wanted = selector.annexNo || selector.formNo;
    if (!annexNumberMatches(item, wanted)) return 0;
    score += 60;
  }
  if (selector.annexTitle) {
    const title = normalizeSelectorText(item.title);
    const wantedTitle = normalizeSelectorText(selector.annexTitle);
    if (!title.includes(wantedTitle)) return 0;
    score += title === wantedTitle ? 50 : 30;
  }
  if (selector.annexType) {
    const type = normalizeSelectorText(item.annexType || item.title);
    const wantedType = normalizeSelectorText(selector.annexType);
    if (!type.includes(wantedType)) return 0;
    score += 10;
  }
  return score;
}

function annexNumberMatches(item = {}, wanted = "") {
  const wantedNumbers = extractSelectorNumbers(wanted);
  const candidateText = [item.annexNo, item.title].filter(Boolean).join(" ");
  const candidateNumbers = extractSelectorNumbers(candidateText);
  if (wantedNumbers.length && candidateNumbers.length) {
    return wantedNumbers.some((number) => candidateNumbers.includes(number));
  }
  const wantedText = normalizeSelectorText(wanted);
  const candidate = normalizeSelectorText(candidateText);
  return Boolean(wantedText && candidate.includes(wantedText));
}

function extractSelectorNumbers(value = "") {
  return Array.from(String(value || "").matchAll(/\d+/g)).map((match) => String(Number(match[0])));
}

function normalizeSelectorText(value = "") {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function chooseRevisionForDate(revisions = [], isoDate = "") {
  const target = String(isoDate || "").replace(/\D+/g, "");
  const list = Array.isArray(revisions) ? revisions.filter((item) => item?.mst && item?.effectiveDate) : [];
  if (!target) return list[0] || null;
  const sorted = [...list].sort((a, b) => String(b.effectiveDate || "").localeCompare(String(a.effectiveDate || "")));
  return sorted.find((item) => String(item.effectiveDate || "").replace(/\D+/g, "") <= target)
    || sorted[sorted.length - 1]
    || null;
}

function buildLawTextCitation(data, effectiveDate = "", citationId = "L1") {
  const lawName = data.lawName || "";
  return {
    citationId,
    sourceType: "law",
    lawName,
    lawId: data.lawId || "",
    mst: data.mst || "",
    article: "",
    canonical: `${lawName}/full-text`,
    title: "Full law text",
    locator: lawName ? `${lawName} full text` : "Full law text",
    effectiveDate: effectiveDate || data.effectiveDate || "",
    url: buildPublicLawUrl(lawName, "", data.mst)
  };
}

function parseJson(text) {
  if (!text || !String(text).trim()) return {};
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

function parseArticleSections(text = "", filterLawName = "") {
  if (!text) return [];
  const lines = text.split("\n");
  const articles = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^제\s*(\d+)\s*조(?:의\d+)?\s*(.*)/u);
    if (match) {
      if (current) articles.push(current);
      current = { articleNo: `제${match[1]}조`, title: match[2]?.trim() || "", text: line };
    } else if (current) {
      current.text += "\n" + line;
    }
  }
  if (current) articles.push(current);
  const result = filterLawName
    ? articles.filter((a) => a.text.includes(filterLawName))
    : articles;
  return result.slice(0, 20).map((a) => ({ ...a, text: a.text.trim() }));
}
