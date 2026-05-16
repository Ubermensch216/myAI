import { createLinkedAbortController, throwIfAborted } from "../abort.js";
import { getLawConfig, maskLawSecrets } from "./lawConfig.js";
import { buildLawCacheKey, getCachedLawResponse, setCachedLawResponse } from "./lawCache.js";
import { findUpstreamError } from "./lawApiParser.js";
import {
  normalizeKorPrcdntResults,
  normalizeEngPrcdntResults,
  normalizeEngPrcdntDetail,
  normalizeOcprOutlineResults,
  normalizeOcprOutlineDetail,
  normalizeHaengJimResults,
  normalizeLawGoKrDeccDetail,
  normalizeLawGoKrDeccResults,
  buildDecisionCitation
} from "./decisionsApiParser.js";

const DECISIONS_TTL_MS = 30 * 86_400_000;
const HAENGJIM_URL_DEFAULT = "http://www.simpan.go.kr/nsph/getAdjdexeList.do";

let instance = null;

export function createDecisionsApiClient() {
  if (!instance) instance = new DecisionsApiClient();
  return instance;
}

export class DecisionsApiClient {
  constructor() {
    const lawConfig = getLawConfig();
    const sharedKey = String(process.env.DECISIONS_API_KEY || "").trim();
    this.hunzaeApiKey = String(process.env.HUNZAE_API_KEY || sharedKey).trim();
    this.haengjimApiKey = String(process.env.HAENGJIM_API_KEY || sharedKey).trim();
    this.lawApiKey = lawConfig.apiKey;
    this.lawSearchUrl = lawConfig.searchUrl;
    this.lawServiceUrl = lawConfig.serviceUrl;
    this.haengjimProvider = String(process.env.HAENGJIM_API_PROVIDER || (process.env.HAENGJIM_API_URL ? "hub" : "lawgo")).trim().toLowerCase();
    this.hunzaeBaseUrl = String(process.env.HUNZAE_API_URL || "").trim().replace(/\/$/, "");
    this.haengjimUrl = String(process.env.HAENGJIM_API_URL || HAENGJIM_URL_DEFAULT).trim();
    this.timeoutMs = lawConfig.timeoutMs;
    this.userAgent = lawConfig.userAgent;
  }

  _op(operation) {
    return `${this.hunzaeBaseUrl}/${operation}`;
  }

  isHunzaeConfigured() {
    return Boolean(this.hunzaeApiKey && this.hunzaeBaseUrl);
  }

  _hunzaeCheck() {
    if (!this.hunzaeApiKey) throw Object.assign(
      new Error("HUNZAE_API_KEY_NOT_CONFIGURED"), { marker: "DECISIONS_CONFIG_ERROR" }
    );
    if (!this.hunzaeBaseUrl) throw Object.assign(
      new Error("HUNZAE_API_URL_NOT_CONFIGURED"), { marker: "DECISIONS_CONFIG_ERROR" }
    );
  }

  async requestRaw(url, params = {}, { signal } = {}) {
    throwIfAborted(signal);
    const target = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") target.searchParams.set(k, String(v));
    }
    const linked = createLinkedAbortController(signal, this.timeoutMs, "Decision API request timed out.");
    try {
      const res = await fetch(target.toString(), {
        signal: linked.signal,
        headers: { "User-Agent": this.userAgent }
      });
      if (!res.ok) throw Object.assign(
        new Error(`HTTP ${res.status} from ${new URL(url).hostname}`),
        { marker: "DECISIONS_HTTP_ERROR", status: res.status }
      );
      return await res.text();
    } finally {
      linked.cleanup();
    }
  }

  // 한글판례 목록 검색
  async searchKorPrcdnt({ query = "", page = 1, display = 10, eventType = "", rstaRsta = "" } = {}, { signal } = {}) {
    this._hunzaeCheck();
    const cacheKey = buildLawCacheKey("hunzae_kor_search", { query, page, display, eventType, rstaRsta });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const xml = await this.requestRaw(this._op("getKorPrcdntList"), {
      serviceKey: this.hunzaeApiKey,
      numOfRows: display,
      pageNo: page,
      ...(query ? { eventNm: query } : {}),
      ...(eventType ? { eventType } : {}),
      ...(rstaRsta ? { rstaRsta } : {})
    }, { signal });

    const parsed = normalizeKorPrcdntResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error && Array.isArray(parsed.results) && parsed.results.length > 0) {
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    }
    return out;
  }

  // 영문판례 목록 검색
  async searchEngPrcdnt({ query = "", page = 1, display = 10, rstaRsta = "" } = {}, { signal } = {}) {
    this._hunzaeCheck();
    const cacheKey = buildLawCacheKey("hunzae_eng_search", { query, page, display, rstaRsta });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const xml = await this.requestRaw(this._op("getEngPrcdntList"), {
      serviceKey: this.hunzaeApiKey,
      numOfRows: display,
      pageNo: page,
      ...(query ? { eventNm: query } : {}),
      ...(rstaRsta ? { rstaRsta } : {})
    }, { signal });

    const parsed = normalizeEngPrcdntResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error && Array.isArray(parsed.results) && parsed.results.length > 0) {
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    }
    return out;
  }

  // 판례요지집 검색
  async searchOutline({ query = "", page = 1, display = 10 } = {}, { signal } = {}) {
    this._hunzaeCheck();
    const cacheKey = buildLawCacheKey("hunzae_outline_search", { query, page, display });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const xml = await this.requestRaw(this._op("getOcprOutlineList"), {
      serviceKey: this.hunzaeApiKey,
      numOfRows: display,
      pageNo: page,
      ...(query ? { title: query } : {})
    }, { signal });

    const parsed = normalizeOcprOutlineResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error && Array.isArray(parsed.results) && parsed.results.length > 0) {
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    }
    return out;
  }

  // 행심 재결례 검색
  async searchHaengJim({
    query = "",
    page = 1,
    display = 10,
    reqDate = "",
    cmitId = "",
    adjdcStartDe = "",
    adjdcEndDe = ""
  } = {}, { signal } = {}) {
    if (this.haengjimProvider !== "hub" && this.lawApiKey) {
      return this.searchHaengJimLawGoKr({ query, page, display }, { signal });
    }
    return this.searchHaengJimLegacy({ query, page, display, reqDate, cmitId, adjdcStartDe, adjdcEndDe }, { signal })
      .catch((error) => {
        if (!this.lawApiKey) throw error;
        return this.searchHaengJimLawGoKr({ query, page, display }, { signal });
      });
  }

  async searchHaengJimLawGoKr({ query = "", page = 1, display = 10 } = {}, { signal } = {}) {
    const normalizedInput = {
      query: String(query || "").trim(),
      page: Number(page) || 1,
      display: Math.max(1, Math.min(Number(display) || 10, 100))
    };
    const cacheKey = buildLawCacheKey("decisions_haengjim_lawgo_search_v4", normalizedInput);
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const rawText = await this.requestRaw(this.lawSearchUrl, {
      OC: this.lawApiKey,
      target: "decc",
      type: "JSON",
      search: 2,
      query: normalizedInput.query,
      display: normalizedInput.display,
      page: normalizedInput.page,
      sort: "ddes"
    }, { signal });
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw Object.assign(new Error("Invalid JSON from law.go.kr decc search"), { marker: "DECISIONS_PARSE_ERROR" });
    }
    const upstreamError = findUpstreamError(payload);
    if (upstreamError) throw Object.assign(new Error(maskLawSecrets(upstreamError)), { marker: "DECISIONS_HTTP_ERROR" });

    const parsed = normalizeLawGoKrDeccResults(payload);
    if (parsed.results.length) {
      await this.enrichHaengJimSummaries(parsed.results, { signal, query: normalizedInput.query });
    }
    const out = {
      ok: parsed.results.length > 0,
      domain: "haengjim",
      provider: "law.go.kr",
      query: normalizedInput.query,
      ...parsed,
      cacheHit: false
    };
    if (parsed.results.length > 0) {
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    }
    return out;
  }

  async enrichHaengJimSummaries(results, { signal, query = "" } = {}) {
    const targets = results
      .filter((item) => item.id && !item.summary)
      .slice(0, 5);
    if (!targets.length) return;
    const details = await Promise.allSettled(
      targets.map((item) => this.getHaengJimDecisionText({ id: item.id }, { signal }))
    );
    details.forEach((entry, index) => {
      if (entry.status !== "fulfilled" || !entry.value?.detail) return;
      const target = targets[index];
      const detail = entry.value.detail;
      target.summary = pickHaengJimSummary(detail, query, entry.value.text);
      if (!target.result && detail.result) target.result = detail.result;
      if (!target.institution && detail.institution) target.institution = detail.institution;
      if (!target.court && detail.court) target.court = detail.court;
    });
  }

  async searchHaengJimLegacy({
    query = "",
    page = 1,
    display = 10,
    reqDate = "",
    cmitId = "",
    adjdcStartDe = "",
    adjdcEndDe = ""
  } = {}, { signal } = {}) {
    const effectiveDate = reqDate || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const cacheKey = buildLawCacheKey("decisions_haengjim_hub_search", {
      query,
      page,
      display,
      d: effectiveDate,
      cmitId,
      adjdcStartDe,
      adjdcEndDe
    });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const params = {
      page,
      row: display,
      init: "Y",
      reqDate: effectiveDate,
      ...(cmitId ? { cmitId } : {}),
      ...(query ? { incdntNm: query } : {}),
      ...(adjdcStartDe ? { adjdcStartDe } : {}),
      ...(adjdcEndDe ? { adjdcEndDe } : {})
    };
    const rawText = await this.requestRaw(this.haengjimUrl, params, { signal });
    let results = normalizeHaengJimResults(rawText);

    const note = query ? "행심 API는 서버측 키워드 검색 미지원 — 클라이언트 필터링 적용됨" : undefined;
    if (query) {
      const needle = query.toLowerCase();
      results = results.filter(
        (r) => r.title.toLowerCase().includes(needle) || r.summary.toLowerCase().includes(needle)
      );
    }

    const out = {
      ok: true,
      domain: "haengjim",
      results,
      total: results.length,
      page: Number(page),
      ...(note ? { note } : {}),
      cacheHit: false
    };
    if (results.length > 0) {
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    }
    return out;
  }

  // 통합 검색
  // domain: "all" | "hunzae" | "haengjim"
  // subType (hunzae only): "kor" | "eng" | "outline" | "all"
  async searchDecisions({
    query = "",
    domain = "all",
    subType = "kor",
    page = 1,
    display = 10,
    reqDate = "",
    eventType = "",
    rstaRsta = "",
    cmitId = "",
    adjdcStartDe = "",
    adjdcEndDe = ""
  } = {}, { signal } = {}) {
    const d = String(domain || "all").toLowerCase();
    const st = String(subType || "kor").toLowerCase();

    if (d === "haengjim") {
      return this.searchHaengJim({
        query,
        page,
        display,
        reqDate,
        cmitId,
        adjdcStartDe,
        adjdcEndDe
      }, { signal });
    }

    if (d === "hunzae") {
      if (st === "eng") return this.searchEngPrcdnt({ query, page, display, rstaRsta }, { signal });
      if (st === "outline") return this.searchOutline({ query, page, display }, { signal });
      if (st === "all") {
        const [korRes, outlineRes] = await Promise.allSettled([
          this.searchKorPrcdnt({ query, page, display: Math.ceil(display / 2), eventType, rstaRsta }, { signal }),
          this.searchOutline({ query, page, display: Math.ceil(display / 2) }, { signal })
        ]);
        const kor = korRes.status === "fulfilled" ? korRes.value : { ok: false, results: [], total: 0 };
        const outline = outlineRes.status === "fulfilled" ? outlineRes.value : { ok: false, results: [], total: 0 };
        return {
          ok: kor.ok || outline.ok,
          domain: "hunzae",
          results: [...(kor.results || []), ...(outline.results || [])].sort((a, b) => b.date.localeCompare(a.date)),
          total: (kor.total || 0) + (outline.total || 0),
          page: Number(page),
          subtypes: { kor: { ok: kor.ok, total: kor.total }, outline: { ok: outline.ok, total: outline.total } },
          cacheHit: false
        };
      }
      return this.searchKorPrcdnt({ query, page, display, eventType, rstaRsta }, { signal });
    }

    // domain=all: 헌재(kor) + 행심
    const [hunzaeRes, haengjimRes] = await Promise.allSettled([
      this.searchKorPrcdnt({ query, page, display, eventType, rstaRsta }, { signal }),
      this.searchHaengJim({ query, page, display, reqDate, cmitId, adjdcStartDe, adjdcEndDe }, { signal })
    ]);
    const hunzae = hunzaeRes.status === "fulfilled" ? hunzaeRes.value : { ok: false, error: hunzaeRes.reason?.message, results: [], total: 0 };
    const haengjim = haengjimRes.status === "fulfilled" ? haengjimRes.value : { ok: false, error: haengjimRes.reason?.message, results: [], total: 0 };
    const results = [...(hunzae.results || []), ...(haengjim.results || [])].sort((a, b) => b.date.localeCompare(a.date));
    return {
      ok: results.length > 0,
      domain: "all",
      results,
      total: results.length,
      page: Number(page),
      domains: {
        hunzae: { ok: hunzae.ok, total: hunzae.total ?? 0, error: hunzae.error },
        haengjim: { ok: haengjim.ok, total: haengjim.total ?? 0, error: haengjim.error }
      },
      cacheHit: false
    };
  }

  // 결정례 전문 조회
  // sourceType: "decision_hunzae_outline" → getOcprOutlineDetail (seqNo)
  // sourceType: "decision_hunzae_eng" → getEngPrcdntDetail (eventNum)
  // sourceType: "decision_hunzae_kor" → 전문 불가 (요약만)
  async getDecisionText({ id = "", domain = "", sourceType = "", subType = "" } = {}, { signal } = {}) {
    const st = String(sourceType || subType || "").toLowerCase();
    const d = String(domain || "").toLowerCase();

    if (d === "haengjim" || st === "decision_haengjim" || st === "haengjim") {
      return this.getHaengJimDecisionText({ id }, { signal });
    }

    this._hunzaeCheck();
    if (!id) return { ok: false, error: "id_required" };

    // 판례요지집 상세
    if (st === "decision_hunzae_outline" || st === "outline") {
      const cacheKey = buildLawCacheKey("hunzae_outline_detail", { id });
      const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
      if (cached) return { ...cached, cacheHit: true };

      const xml = await this.requestRaw(this._op("getOcprOutlineDetail"), {
        serviceKey: this.hunzaeApiKey,
        seqNo: id
      }, { signal });
      const detail = normalizeOcprOutlineDetail(xml);
      if (!detail) return { ok: false, error: "DECISION_NOT_FOUND", id };
      const citation = buildDecisionCitation(detail, "D1");
      const out = { ok: true, domain: "hunzae", subType: "outline", citation, text: detail.text, cacheHit: false };
      await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
      return out;
    }

    // 영문판례 상세 (기본 — eventNum 기반)
    const cacheKey = buildLawCacheKey("hunzae_eng_detail", { id });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const xml = await this.requestRaw(this._op("getEngPrcdntDetail"), {
      serviceKey: this.hunzaeApiKey,
      eventNum: id
    }, { signal });
    const detail = normalizeEngPrcdntDetail(xml);
    if (!detail) return { ok: false, error: "DECISION_NOT_FOUND", id };
    const citation = buildDecisionCitation(detail, "D1");
    const out = { ok: true, domain: "hunzae", subType: "eng", citation, text: detail.text, cacheHit: false };
    await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }

  async getHaengJimDecisionText({ id = "" } = {}, { signal } = {}) {
    if (!this.lawApiKey) throw Object.assign(new Error("LAW_OC_NOT_CONFIGURED"), { marker: "DECISIONS_CONFIG_ERROR" });
    if (!id) return { ok: false, error: "id_required" };
    const cacheKey = buildLawCacheKey("decisions_haengjim_lawgo_detail_v2", { id });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const rawText = await this.requestRaw(this.lawServiceUrl, {
      OC: this.lawApiKey,
      target: "decc",
      type: "JSON",
      ID: id
    }, { signal });
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw Object.assign(new Error("Invalid JSON from law.go.kr decc detail"), { marker: "DECISIONS_PARSE_ERROR" });
    }
    const upstreamError = findUpstreamError(payload);
    if (upstreamError) throw Object.assign(new Error(maskLawSecrets(upstreamError)), { marker: "DECISIONS_HTTP_ERROR" });

    const detail = normalizeLawGoKrDeccDetail(payload);
    if (!detail.id && !detail.title) return { ok: false, error: "DECISION_NOT_FOUND", id };
    const citation = buildDecisionCitation(detail, "D1");
    const out = { ok: true, domain: "haengjim", subType: "haengjim", citation, text: detail.text, detail, cacheHit: false };
    await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }
}

function pickHaengJimSummary(detail, query = "", text = "") {
  const source = String(detail?.text || text || detail?.summary || "").replace(/\s+/g, " ").trim();
  const terms = String(query || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  for (const term of terms) {
    const index = source.indexOf(term);
    if (index >= 0) {
      const start = Math.max(0, index - 90);
      const end = Math.min(source.length, index + 320);
      const prefix = start > 0 ? "..." : "";
      const suffix = end < source.length ? "..." : "";
      return `${prefix}${source.slice(start, end)}${suffix}`;
    }
  }
  return String(detail?.summary || source || "").slice(0, 500);
}
