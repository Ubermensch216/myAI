const FAMILY_ORDER = ["L", "P", "D", "F", "N", "W", "!"];

const FAMILY_LABELS = {
  L: "공식 법령",
  P: "판례",
  D: "결정례",
  F: "첨부문서",
  N: "내부 문서",
  W: "네이버 검색",
  "!": "검증 실패"
};

function classifyCitationFamily(citation = {}) {
  const citationId = String(citation.citationId || "");
  const sourceType = String(citation.sourceType || "");
  const recordType = String(citation.recordType || "");
  if (sourceType === "notebook" || /^N\d+/i.test(citationId)) return "N";
  if (sourceType === "naver" || sourceType === "web" || /^W\d+/i.test(citationId)) return "W";
  if (sourceType === "law_precedent" || recordType === "precedent" || /^P\d+/i.test(citationId)) return "P";
  if (sourceType.startsWith("decision_") || recordType === "decision" || /^D\d+/i.test(citationId)) return "D";
  if (
    sourceType === "law" ||
    sourceType === "law_article" ||
    recordType === "statute" ||
    recordType === "law" ||
    /^L\d+/i.test(citationId) ||
    /^AI-L\d+/i.test(citationId) ||
    /^L-S\d+/i.test(citationId)
  ) return "L";
  return "";
}

function classifyDecisionDetail(citation = {}) {
  const kind = String(citation.detailKind || "").toLowerCase();
  if (kind === "list_only") return "list";
  if (kind === "outline") return "outline";
  if (kind === "full_text") return "full";
  if (citation.detailAvailable === false) return "list";
  if (citation.detailAvailable === true) return "full";
  return "list";
}

function countFailedVerifications(law = null) {
  const results = Array.isArray(law?.verification?.results) ? law.verification.results : [];
  return results.filter((item) => item && item.valid === false).length;
}

function pushCount(counts, code, amount = 1) {
  if (!code || amount <= 0) return;
  counts.set(code, (counts.get(code) || 0) + amount);
}

function formatEvidenceText(item) {
  const marker = item.code === "!" ? "!" : `[${item.code}]`;
  const detail = item.detail ? ` ${item.detail}` : "";
  return `※근거 : ${item.label}${marker} (${item.count})${detail}`;
}

export function buildEvidenceSummaryItems({ citations = [], sources = null, law = null } = {}) {
  const counts = new Map();
  const decisionDetails = { list: 0, outline: 0, full: 0 };

  for (const citation of Array.isArray(citations) ? citations : []) {
    const family = classifyCitationFamily(citation);
    pushCount(counts, family);
    if (family === "D") decisionDetails[classifyDecisionDetail(citation)] += 1;
  }

  const documents = Array.isArray(sources?.documents) ? sources.documents : [];
  const images = Array.isArray(sources?.images) ? sources.images : [];
  pushCount(counts, "F", documents.length + images.length);
  if (sources?.naverSearch && !counts.get("W")) pushCount(counts, "W");

  const failed = countFailedVerifications(law);
  pushCount(counts, "!", failed);

  return FAMILY_ORDER
    .filter((code) => counts.get(code))
    .map((code) => {
      const count = counts.get(code);
      const item = {
        code,
        label: FAMILY_LABELS[code],
        marker: code === "!" ? "!" : `[${code}]`,
        count,
        status: code === "!" ? "warning" : "ok"
      };
      if (code === "D") {
        const detailParts = [
          decisionDetails.list ? `목록 ${decisionDetails.list}` : "",
          decisionDetails.outline ? `요지 ${decisionDetails.outline}` : "",
          decisionDetails.full ? `전문 ${decisionDetails.full}` : ""
        ].filter(Boolean);
        item.detail = detailParts.join(" / ");
        item.status = decisionDetails.full && decisionDetails.list ? "mixed" : "ok";
      }
      item.text = formatEvidenceText(item);
      item.title = item.text;
      return item;
    });
}
