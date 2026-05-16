import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: "__cdata",
  textNodeName: "__text",
  isArray: (name) => ["item", "info"].includes(name)
});

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
      subType: "kor"
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
      subType: "eng"
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
    subType: "eng"
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
      subType: "outline"
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
    subType: "outline"
  };
}

// 행심 재결례 (getAdjdexeList)
export function normalizeHaengJimResults(xmlText) {
  const parsed = parseXml(xmlText);
  const raw = parsed?.list?.info || parsed?.info || [];
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return arr.map((item) => ({
    id: String(item?.incdntNb || ""),
    caseNo: String(item?.incdntNb || ""),
    title: readCdata(item?.incdntNm) || String(item?.incdntNm || ""),
    result: String(item?.adjdcResultNm || ""),
    date: toDateStr(item?.adjdcDe || ""),
    institution: String(item?.adjdcInsttNm || "행정심판위원회"),
    court: String(item?.dspsofcNm || ""),
    category: [item?.knwldgCl1Nm, item?.knwldgCl2Nm].filter(Boolean).join(" > "),
    summary: readCdata(item?.sumryCn) || String(item?.sumryCn || ""),
    sourceType: "decision_haengjim",
    subType: "haengjim"
  }));
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
    summary: String(decision.summary || decision.text || "").slice(0, 300)
  };
}
