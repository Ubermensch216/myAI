import { createLawApiClient } from "../lawApiClient.js";
import { normalizeLawCitationForMeta } from "../lawCitationFormatter.js";
import { LawError, LAW_ERROR_MARKERS } from "../lawErrors.js";
import { logLawCall } from "../lawLogger.js";
import { getArticleDetail } from "./articleDetail.js";

const MAX_TEXT_CHARS = 12000;

export async function buildImpactMap(input = {}, options = {}) {
  const startedAt = Date.now();
  const client = options.client || createLawApiClient();
  const lawName = String(input.lawName || "").trim();
  const article = String(input.article || "").trim();
  if (!lawName || !article) {
    throw new LawError("Impact map requires lawName and article.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }

  try {
    const detail = await getArticleDetail({ lawName, article }, { client, signal: options.signal });
    const citation = normalizeLawCitationForMeta(detail.citation, 0, detail.text);
    const impactMap = createDeterministicImpactMap({
      citation,
      articleText: detail.text,
      subject: input.subject,
      materialText: input.materialText
    });
    await logLawCall({
      tool: "impact_map",
      normalizedQuery: { lawName, article, subject: normalizeSubject(input.subject) },
      latencyMs: Date.now() - startedAt,
      resultCount: impactMap.nodes.length,
      cacheHit: Boolean(detail.cacheHit)
    });
    return {
      ok: true,
      query: { lawName, article, subject: normalizeSubject(input.subject) },
      citation,
      text: detail.text,
      impactMap,
      cacheHit: Boolean(detail.cacheHit)
    };
  } catch (error) {
    await logLawCall({
      tool: "impact_map",
      normalizedQuery: { lawName, article, subject: normalizeSubject(input.subject) },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || LAW_ERROR_MARKERS.LAW_API_ERROR
    });
    throw error;
  }
}

export function createDeterministicImpactMap({ citation = {}, articleText = "", subject = "", materialText = "" } = {}) {
  const text = String(articleText || "").slice(0, MAX_TEXT_CHARS);
  const focus = normalizeSubject(subject) || "검토 대상";
  const obligations = extractObligationSentences(text);
  const conditions = extractConditionSentences(text);
  const risks = extractRiskSentences(text);
  const materialHits = extractMaterialHits(materialText, obligations.concat(conditions));

  const rootId = "law-root";
  const subjectId = "subject";
  const nodes = [
    {
      id: rootId,
      type: "law_article",
      label: citation.locator || [citation.lawName, citation.article].filter(Boolean).join(" ") || "공식 법령 조문",
      summary: citation.title || citation.excerpt || "공식 법령 조문",
      citationId: citation.citationId || "L1",
      url: citation.url || "",
      importance: 5
    },
    {
      id: subjectId,
      type: "review_subject",
      label: focus,
      summary: "이 조문의 영향 범위를 적용해 볼 대상입니다.",
      importance: 4
    }
  ];
  const edges = [{ from: rootId, to: subjectId, label: "applies_to", strength: 4 }];

  appendSentenceNodes(nodes, edges, {
    rootId,
    type: "obligation",
    edgeLabel: "requires",
    sentences: obligations,
    fallback: "조문 원문에서 의무 또는 금지 표현을 직접 확인하세요."
  });
  appendSentenceNodes(nodes, edges, {
    rootId,
    type: "condition",
    edgeLabel: "condition",
    sentences: conditions,
    fallback: "적용 요건은 조문 원문과 하위 항목을 함께 확인해야 합니다."
  });
  appendSentenceNodes(nodes, edges, {
    rootId,
    type: "risk",
    edgeLabel: "risk",
    sentences: risks,
    fallback: "위반 효과나 제재는 관련 벌칙, 과태료, 손해배상 조항까지 추가 확인이 필요합니다."
  });

  materialHits.slice(0, 4).forEach((hit, index) => {
    const id = `material-${index + 1}`;
    nodes.push({
      id,
      type: "material_signal",
      label: `자료 신호 ${index + 1}`,
      summary: hit,
      importance: 3
    });
    edges.push({ from: subjectId, to: id, label: "mentions", strength: 2 });
  });

  return {
    version: 1,
    mode: "impact_map",
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    groups: [
      { id: "law_article", label: "법령 조문" },
      { id: "review_subject", label: "검토 대상" },
      { id: "obligation", label: "의무/금지" },
      { id: "condition", label: "적용 요건" },
      { id: "risk", label: "리스크" },
      { id: "material_signal", label: "자료 신호" }
    ],
    warnings: [
      "impact_map_is_structural",
      ...(materialHits.length ? [] : ["no_material_match"])
    ]
  };
}

function appendSentenceNodes(nodes, edges, { rootId, type, edgeLabel, sentences, fallback }) {
  const list = sentences.length ? sentences : [fallback];
  list.slice(0, 5).forEach((sentence, index) => {
    const id = `${type}-${index + 1}`;
    nodes.push({
      id,
      type,
      label: summarizeLabel(sentence),
      summary: sentence,
      importance: index === 0 ? 4 : 3
    });
    edges.push({ from: rootId, to: id, label: edgeLabel, strength: index === 0 ? 4 : 3 });
  });
}

function extractObligationSentences(text) {
  return splitSentences(text).filter((sentence) =>
    /(하여야|해야|하여서는 아니|해서는 아니|금지|의무|준수|동의|허가|신고|제출|보존|파기|통지|공개|제공)/u.test(sentence)
  );
}

function extractConditionSentences(text) {
  return splitSentences(text).filter((sentence) =>
    /(경우|때에는|때|요건|대상|범위|목적|필요|불가피|다만|제외|적용)/u.test(sentence)
  );
}

function extractRiskSentences(text) {
  return splitSentences(text).filter((sentence) =>
    /(벌칙|과태료|처벌|손해배상|배상|취소|정지|위반|책임|징역|벌금|제재)/u.test(sentence)
  );
}

function extractMaterialHits(materialText, referenceSentences) {
  const source = String(materialText || "").slice(0, MAX_TEXT_CHARS);
  if (!source.trim()) return [];
  const keywords = new Set();
  for (const sentence of referenceSentences) {
    for (const token of String(sentence).match(/[가-힣A-Za-z0-9]{2,}/gu) || []) {
      if (token.length >= 2 && token.length <= 16) keywords.add(token);
    }
  }
  const selected = [...keywords].slice(0, 80);
  return splitSentences(source).filter((sentence) => selected.some((token) => sentence.includes(token)));
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。]|다\.|함\.|음\.|요\.)\s+|[\n\r]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function summarizeLabel(sentence) {
  const text = String(sentence || "").replace(/\s+/g, " ").trim();
  if (text.length <= 34) return text;
  return `${text.slice(0, 33).trimEnd()}...`;
}

function normalizeSubject(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}
