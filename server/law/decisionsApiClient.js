import { getLawConfig } from "./lawConfig.js";
import { buildLawCacheKey, getCachedLawResponse, setCachedLawResponse } from "./lawCache.js";
import {
  normalizeKorPrcdntResults,
  normalizeEngPrcdntResults,
  normalizeEngPrcdntDetail,
  normalizeOcprOutlineResults,
  normalizeOcprOutlineDetail,
  normalizeHaengJimResults,
  buildDecisionCitation
} from "./decisionsApiParser.js";

const DECISIONS_TTL_MS = 30 * 86_400_000;
const HAENGJIM_URL_DEFAULT = "https://www.simpan.go.kr/nsph/getAdjdexeList.do";

let instance = null;

export function createDecisionsApiClient() {
  if (!instance) instance = new DecisionsApiClient();
  return instance;
}

class DecisionsApiClient {
  constructor() {
    const lawConfig = getLawConfig();
    const sharedKey = String(process.env.DECISIONS_API_KEY || "").trim();
    this.hunzaeApiKey = String(process.env.HUNZAE_API_KEY || sharedKey).trim();
    this.haengjimApiKey = String(process.env.HAENGJIM_API_KEY || sharedKey).trim();
    this.hunzaeBaseUrl = String(process.env.HUNZAE_API_URL || "").trim().replace(/\/$/, "");
    this.haengjimUrl = String(process.env.HAENGJIM_API_URL || HAENGJIM_URL_DEFAULT).trim();
    this.timeoutMs = lawConfig.timeoutMs;
    this.userAgent = lawConfig.userAgent;
  }

  _op(operation) {
    return `${this.hunzaeBaseUrl}/${operation}`;
  }

  _hunzaeCheck() {
    if (!this.hunzaeApiKey) throw Object.assign(
      new Error("HUNZAE_API_KEY_NOT_CONFIGURED"), { marker: "DECISIONS_CONFIG_ERROR" }
    );
    if (!this.hunzaeBaseUrl) throw Object.assign(
      new Error("HUNZAE_API_URL_NOT_CONFIGURED"), { marker: "DECISIONS_CONFIG_ERROR" }
    );
  }

  async requestRaw(url, params = {}) {
    const target = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") target.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(target.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": this.userAgent }
      });
      if (!res.ok) throw Object.assign(
        new Error(`HTTP ${res.status} from ${new URL(url).hostname}`),
        { marker: "DECISIONS_HTTP_ERROR", status: res.status }
      );
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // 한글판례 목록 검색
  async searchKorPrcdnt({ query = "", page = 1, display = 10, eventType = "", rstaRsta = "" } = {}) {
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
    });

    const parsed = normalizeKorPrcdntResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error) await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }

  // 영문판례 목록 검색
  async searchEngPrcdnt({ query = "", page = 1, display = 10, rstaRsta = "" } = {}) {
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
    });

    const parsed = normalizeEngPrcdntResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error) await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }

  // 판례요지집 검색
  async searchOutline({ query = "", page = 1, display = 10 } = {}) {
    this._hunzaeCheck();
    const cacheKey = buildLawCacheKey("hunzae_outline_search", { query, page, display });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const xml = await this.requestRaw(this._op("getOcprOutlineList"), {
      serviceKey: this.hunzaeApiKey,
      numOfRows: display,
      pageNo: page,
      ...(query ? { title: query } : {})
    });

    const parsed = normalizeOcprOutlineResults(xml);
    const out = { ok: !parsed.error, domain: "hunzae", ...parsed, cacheHit: false };
    if (!parsed.error) await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }

  // 행심 재결례 검색
  async searchHaengJim({ query = "", page = 1, display = 10, reqDate = "" } = {}) {
    const effectiveDate = reqDate || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const cacheKey = buildLawCacheKey("decisions_haengjim_search", { query, page, display, d: effectiveDate });
    const cached = await getCachedLawResponse(cacheKey, { ttlMs: DECISIONS_TTL_MS });
    if (cached) return { ...cached, cacheHit: true };

    const params = { Init: "Y", reqDate: effectiveDate, row: display, page };
    if (this.haengjimApiKey) params.serviceKey = this.haengjimApiKey;

    const rawText = await this.requestRaw(this.haengjimUrl, params);
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
    await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }

  // 통합 검색
  // domain: "all" | "hunzae" | "haengjim"
  // subType (hunzae only): "kor" | "eng" | "outline" | "all"
  async searchDecisions({ query = "", domain = "all", subType = "kor", page = 1, display = 10, reqDate = "", eventType = "", rstaRsta = "" } = {}) {
    const d = String(domain || "all").toLowerCase();
    const st = String(subType || "kor").toLowerCase();

    if (d === "haengjim") return this.searchHaengJim({ query, page, display, reqDate });

    if (d === "hunzae") {
      if (st === "eng") return this.searchEngPrcdnt({ query, page, display, rstaRsta });
      if (st === "outline") return this.searchOutline({ query, page, display });
      if (st === "all") {
        const [korRes, outlineRes] = await Promise.allSettled([
          this.searchKorPrcdnt({ query, page, display: Math.ceil(display / 2), eventType, rstaRsta }),
          this.searchOutline({ query, page, display: Math.ceil(display / 2) })
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
      return this.searchKorPrcdnt({ query, page, display, eventType, rstaRsta });
    }

    // domain=all: 헌재(kor) + 행심
    const [hunzaeRes, haengjimRes] = await Promise.allSettled([
      this.searchKorPrcdnt({ query, page, display, eventType, rstaRsta }),
      this.searchHaengJim({ query, page, display, reqDate })
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
  async getDecisionText({ id = "", domain = "", sourceType = "", subType = "" } = {}) {
    const st = String(sourceType || subType || "").toLowerCase();
    const d = String(domain || "").toLowerCase();

    if (d === "haengjim" || st === "decision_haengjim" || st === "haengjim") {
      return { ok: false, error: "행심 API는 단건 조회 엔드포인트 미제공. search_decisions 도구로 요약 조회 가능." };
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
      });
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
    });
    const detail = normalizeEngPrcdntDetail(xml);
    if (!detail) return { ok: false, error: "DECISION_NOT_FOUND", id };
    const citation = buildDecisionCitation(detail, "D1");
    const out = { ok: true, domain: "hunzae", subType: "eng", citation, text: detail.text, cacheHit: false };
    await setCachedLawResponse(cacheKey, out, { ttlMs: DECISIONS_TTL_MS });
    return out;
  }
}
