import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: "__cdata",
  textNodeName: "__text",
  isArray: (name) => ["item", "info", "data"].includes(name)
});

const HUNZAE_KOR_DETAIL_NOTICE = "Korean full text for Constitutional Court list records is not available from the configured detail API; use list or outline evidence only.";

function parseXml(text) {
  try {
    return xmlParser.parse(String(text || ""));
  } catch {
    return {};
  }
}

function toDateStr(raw) {
  const s = String(raw || "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  return s;
}

function readCdata(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  return String(node.__cdata || node.__text || "");
}

function stripHtml(text) {
  const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => map[m] || m)
    .trim();
}

function firstValue(...values) {
  for (const value of values) {
    const text = readCdata(value) || String(value || "");
    if (text.trim()) return text.trim();
  }
  return "";
}

function xmlOk(parsed) {
  return String(parsed?.response?.header?.resultCode) === "0";
}

function xmlError(parsed) {
  return parsed?.response?.header?.resultMsg || "API_ERROR";
}

function getItems(parsed) {
  const raw = parsed?.response?.body?.items?.item || [];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function getMeta(parsed) {
  const body = parsed?.response?.body || {};
  return { total: Number(body.totalCount || 0), page: Number(body.pageNo || 1) };
}

// 한글판례 목록 (getKorPrcdntList)
export function normalizeKorPrcdntResults(xmlText) {
  const parsed = parseXml(xmlText);
  if (!xmlOk(parsed)) return { results: [], total: 0, page: 1, error: xmlError(parsed) };
  const { total, page } = getMeta(parsed);
  return {
    results: getItems(parsed).map((item) => ({
      id: String(item.eventNum || ""),
      caseNo: String(item.eventNo || ""),
      title: String(item.eventNm || "").trim(),
      result: String(item.rstaRsta || ""),
      date: toDateStr(item.rstaDate || ""),
      institution: "헌법재판소",
      court: String(item.jgdmtCort || ""),
      category: String(item.eventType || ""),
      panreType: String(item.panreType || ""),
      summary: "",
      sourceType: "decision_hunzae_kor",
      subType: "kor",
      detailAvailable: false,
      detailKind: "list_only",
      detailNotice: HUNZAE_KOR_DETAIL_NOTICE
    })),
    total,
    page
  };
}

// 영문판례 목록 (getEngPrcdntList)
export function normalizeEngPrcdntResults(xmlText) {
  const parsed = parseXml(xmlText);
  if (!xmlOk(parsed)) return { results: [], total: 0, page: 1, error: xmlError(parsed) };
  const { total, page } = getMeta(parsed);
  return {
    results: getItems(parsed).map((item) => ({
      id: String(item.eventNum || ""),
      caseNo: String(item.engEventNo || item.eventNo || ""),
      title: String(item.engEventName || item.eventNm || "").trim(),
      result: String(item.rstaRsta || ""),
      date: String(item.rstaDate || ""),
      institution: "Constitutional Court of Korea",
      court: String(item.jgdmtCort || ""),
      category: String(item.eventType || ""),
      summary: "",
      sourceType: "decision_hunzae_eng",
      subType: "eng",
      detailAvailable: true,
      detailKind: "full_text"
    })),
    total,
    page
  };
}

// 영문판례 상세 (getEngPrcdntDetail) — xmlContent CDATA 전문 포함
export function normalizeEngPrcdntDetail(xmlText) {
  const parsed = parseXml(xmlText);
  if (!xmlOk(parsed)) return null;
  const item = getItems(parsed)[0];
  if (!item) return null;
  return {
    id: String(item.eventNum || ""),
    caseNo: String(item.engEventNo || item.eventNo || ""),
    title: String(item.engEventName || item.eventNm || "").trim(),
    result: String(item.rstaRsta || ""),
    date: String(item.rstaDate || ""),
    institution: "Constitutional Court of Korea",
    court: String(item.jgdmtCort || ""),
    pages: String(item.pages || ""),
    volume: String(item.volumeInfo || ""),
    text: readCdata(item.xmlContent),
    sourceType: "decision_hunzae_eng",
    subType: "eng",
    detailAvailable: true,
    detailKind: "full_text"
  };
}

// 판례요지집 목록 (getOcprOutlineList)
export function normalizeOcprOutlineResults(xmlText) {
  const parsed = parseXml(xmlText);
  if (!xmlOk(parsed)) return { results: [], total: 0, page: 1, error: xmlError(parsed) };
  const { total, page } = getMeta(parsed);
  return {
    results: getItems(parsed).map((item) => ({
      id: String(item.seqNo || ""),
      caseNo: "",
      title: String(item.title || "").trim(),
      result: "",
      date: toDateStr(item.regDate || ""),
      institution: "헌법재판소",
      court: "",
      category: String(item.cntntpth || ""),
      summary: "",
      sourceType: "decision_hunzae_outline",
      subType: "outline",
      detailAvailable: true,
      detailKind: "outline"
    })),
    total,
    page
  };
}

// 판례요지집 상세 (getOcprOutlineDetail) — content CDATA 전문 포함
export function normalizeOcprOutlineDetail(xmlText) {
  const parsed = parseXml(xmlText);
  if (!xmlOk(parsed)) return null;
  const item = getItems(parsed)[0];
  if (!item) return null;
  return {
    id: String(item.seqNo || ""),
    caseNo: String(item.eventNo || ""),
    title: String(item.title || "").trim(),
    result: "",
    date: toDateStr(item.regDate || ""),
    institution: "헌법재판소",
    category: String(item.cntntpth || ""),
    text: stripHtml(readCdata(item.content)),
    sourceType: "decision_hunzae_outline",
    subType: "outline",
    detailAvailable: true,
    detailKind: "outline"
  };
}

// 행심 재결례 (getAdjdexeList)
export function normalizeHaengJimResults(xmlText) {
  const parsed = parseXml(xmlText);
  const raw = parsed?.simpan?.list?.data || parsed?.list?.data || parsed?.list?.info || parsed?.info || [];
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return arr.map((item) => ({
    id: String(item?.incdntNb || ""),
    caseNo: String(item?.incdntNb || ""),
    title: readCdata(item?.incdntNm) || String(item?.incdntNm || ""),
    result: String(item?.adjdcResultNm || ""),
    date: toDateStr(item?.adjdcDe || ""),
    institution: String(item?.cmitNm || item?.adjdcInsttNm || "행정심판위원회"),
    court: String(item?.dspsofcNm || ""),
    category: [item?.knwldgCl1Nm, item?.knwldgCl2Nm].filter(Boolean).join(" > "),
    summary: readCdata(item?.sumryCn) || String(item?.sumryCn || ""),
    sourceType: "decision_haengjim",
    subType: "haengjim",
    detailAvailable: true,
    detailKind: "full_text"
  }));
}

export function normalizeLawGoKrDeccResults(payload) {
  const root = payload?.Decc || payload?.decc || payload || {};
  const raw = root.decc || root.Decc || [];
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return {
    results: arr.map((item) => {
      const id = firstValue(item["행정심판재결례일련번호"], item["행정심판례일련번호"], item.ID, item.id);
      const url = firstValue(item["행정심판례상세링크"], item.url);
      const institution = stripHtml(firstValue(item["재결청"], item.institution) || "행정심판위원회");
      const result = stripHtml(firstValue(item["재결구분명"], item.result));
      return {
        id,
        caseNo: firstValue(item["사건번호"], item.caseNo),
        title: stripHtml(firstValue(item["사건명"], item["행정심판례명"], item.title)),
        result: result && result !== institution && !/위원회$/u.test(result) ? result : "",
        date: toDateStr(firstValue(item["의결일자"], item["재결일자"], item.date).replace(/\./g, "")),
        institution,
        court: stripHtml(firstValue(item["처분청"], item.court)),
        category: stripHtml(firstValue(item["재결구분코드"], item.category)),
        summary: stripHtml(firstValue(item["재결요지"], item["이유"], item.summary)).slice(0, 500),
        url: url ? makeLawGoKrUrl(url) : "",
        sourceType: "decision_haengjim",
        subType: "haengjim",
        detailAvailable: true,
        detailKind: "full_text"
      };
    }).filter((item) => item.id || item.title),
    total: Number(root.totalCnt || root.total || arr.length || 0),
    page: Number(root.page || 1)
  };
}

export function normalizeLawGoKrDeccDetail(payload) {
  const item = payload?.PrecService || payload?.DeccService || payload?.Decc || payload?.decc || payload || {};
  const id = firstValue(item["행정심판례일련번호"], item["행정심판재결례일련번호"], item.ID, item.id);
  const title = stripHtml(firstValue(item["사건명"], item["행정심판례명"], item.title));
  const institution = stripHtml(firstValue(item["재결청"], item.institution) || "행정심판위원회");
  const rawResult = stripHtml(firstValue(item["재결례유형명"], item["재결구분명"], item.result));
  const summary = stripHtml(firstValue(item["재결요지"], item.summary));
  const order = stripHtml(firstValue(item["주문"], item.order));
  const claim = stripHtml(firstValue(item["청구취지"], item.claim));
  const reason = stripHtml(firstValue(item["이유"], item.reason));
  const text = [
    title ? `사건명: ${title}` : "",
    summary ? `재결요지: ${summary}` : "",
    order ? `주문: ${order}` : "",
    claim ? `청구취지: ${claim}` : "",
    reason ? `이유: ${reason}` : ""
  ].filter(Boolean).join("\n\n");
  return {
    id,
    caseNo: firstValue(item["사건번호"], item.caseNo),
    title,
    result: rawResult && rawResult !== institution && !/위원회$/u.test(rawResult) ? rawResult : "",
    date: toDateStr(firstValue(item["의결일자"], item["재결일자"], item.date).replace(/\./g, "")),
    institution,
    court: stripHtml(firstValue(item["처분청"], item.court)),
    category: stripHtml(firstValue(item["재결례유형코드"], item["재결구분코드"], item.category)),
    summary: summary || reason.slice(0, 500),
    text,
    url: id ? `https://www.law.go.kr/DRF/lawService.do?target=decc&ID=${encodeURIComponent(id)}&type=HTML` : "",
    sourceType: "decision_haengjim",
    subType: "haengjim",
    detailAvailable: true,
    detailKind: "full_text"
  };
}

function makeLawGoKrUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const absolute = /^https?:\/\//i.test(text)
    ? text
    : text.startsWith("/")
      ? `https://www.law.go.kr${text}`
      : `https://www.law.go.kr/${text.replace(/^\/+/, "")}`;
  try {
    const url = new URL(absolute);
    url.searchParams.delete("OC");
    return url.toString();
  } catch {
    return absolute.replace(/([?&]OC=)[^&]+/i, "$1");
  }
}

export function buildDecisionCitation(decision, citationId = "D1") {
  return {
    citationId,
    sourceType: decision.sourceType,
    recordType: "decision",
    title: decision.title,
    institution: decision.institution,
    caseNo: decision.caseNo || decision.id,
    date: decision.date,
    result: decision.result,
    locator: `${decision.caseNo || decision.id} (${decision.date})`,
    summary: String(decision.summary || decision.text || "").slice(0, 300),
    url: decision.url || ""
  };
}
