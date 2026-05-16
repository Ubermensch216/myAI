import { normalizeLawCitationForMeta } from "./lawCitationFormatter.js";
import { toLawError, LAW_ERROR_MARKERS } from "./lawErrors.js";
import { createDeterministicImpactMap } from "./tools/impactMap.js";
import { expandQueryWithLawTerms, inferLawTermArticleRefs, searchLawTerms } from "./lawTermKb.js";

const DEFAULT_REPORT_TEMPLATE = "law_review_opinion";

export async function buildLawWorkbench(input = {}, options = {}) {
  const lawName = clean(input.lawName);
  const article = clean(input.article);
  const query = clean(input.query || [lawName, article].filter(Boolean).join(" "));
  const region = clean(input.region);
  const materialText = clean(input.materialText, 10000);
  const includeInternalImpact = Boolean(input.includeInternalImpact);
  const client = options.client;
  const signal = options.signal;

  if (!client) throw new Error("Law workbench requires a law API client.");
  if (!lawName && !query) {
    const error = new Error("lawName or query is required.");
    error.statusCode = 400;
    throw error;
  }

  const expandedQuery = expandQueryWithLawTerms(query || lawName);
  const inferredArticleRef = !lawName && !article ? inferLawTermArticleRefs(query)[0] : null;
  const articleLookup = lawName && article ? { lawName, article } : inferredArticleRef;
  const inputMeta = { query, expandedQuery, lawName, article, region };
  const citations = [];
  const warnings = [];
  const errors = [];

  const articleResult = articleLookup
    ? await capture("article", () => client.getLawArticle(articleLookup, { signal }), { warnings, errors })
    : { ok: false, skipped: true };
  const articleBlock = articleResult.ok
    ? {
        ok: true,
        citation: articleResult.value.citation || null,
        text: articleResult.value.text || "",
        cacheHit: Boolean(articleResult.value.cacheHit)
      }
    : emptyBlock(articleResult, "article");
  if (articleBlock.citation) {
    citations.push(normalizeLawCitationForMeta(articleBlock.citation, citations.length, articleBlock.text));
  }

  const [
    annexesResult,
    historyResult,
    structureResult,
    delegatedResult,
    ordinancesResult,
    precedentsResult,
    interpretationsResult,
    adminRulesResult
  ] = await Promise.all([
    lawName
      ? capture("annexes", () => client.searchAnnexes({ lawName, query: lawName, display: 8 }, { signal }), { warnings, errors })
      : Promise.resolve({ ok: false, skipped: true }),
    lawName
      ? capture("history", () => client.getLawHistory({ lawName }, { signal }), { warnings, errors })
      : Promise.resolve({ ok: false, skipped: true }),
    lawName
      ? capture("structure", () => client.getThreeTier({ lawName }, { signal }), { warnings, errors })
      : Promise.resolve({ ok: false, skipped: true }),
    lawName
      ? capture("delegated", () => client.getDelegatedLaws({ lawName }, { signal }), { warnings, errors })
      : Promise.resolve({ ok: false, skipped: true }),
    capture("ordinances", () => {
      if (typeof client.getLinkedOrdinances === "function" && lawName) {
        return client.getLinkedOrdinances({ lawName, region, display: 8 }, { signal });
      }
      return client.searchOrdinances({ query: expandedQuery || lawName, region, display: 8 }, { signal });
    }, { warnings, errors }),
    capture("precedents", () => client.searchPrecedents({ query: expandedQuery, display: 5 }, { signal }), { warnings, errors }),
    capture("interpretations", () => client.searchInterpretations({ query: expandedQuery, display: 5 }, { signal }), { warnings, errors }),
    capture("adminRules", () => client.searchAdminRules({ query: expandedQuery, display: 5 }, { signal }), { warnings, errors })
  ]);

  const internalImpact = buildInternalImpact({
    enabled: includeInternalImpact,
    articleBlock,
    lawName,
    article,
    query,
    materialText,
    citations
  });

  return {
    ok: Boolean(articleBlock.ok || annexesResult.ok || structureResult.ok || delegatedResult.ok || ordinancesResult.ok),
    mode: "law_workbench",
    generatedAt: new Date().toISOString(),
    input: inputMeta,
    termMatches: searchLawTerms(query || lawName),
    article: articleBlock,
    annexes: resultListBlock(annexesResult, "annexes"),
    history: historyBlock(historyResult),
    structure: structureBlock(structureResult),
    delegated: resultListBlock(delegatedResult, "delegated"),
    ordinances: resultListBlock(ordinancesResult, "ordinances"),
    decisions: {
      precedents: resultListBlock(precedentsResult, "precedents"),
      interpretations: resultListBlock(interpretationsResult, "interpretations"),
      adminRules: resultListBlock(adminRulesResult, "adminRules")
    },
    internalImpact,
    citations,
    warnings,
    errors
  };
}

export function buildLawWorkbenchReport({ workbench, templateId = DEFAULT_REPORT_TEMPLATE } = {}) {
  const wb = workbench && typeof workbench === "object" ? workbench : {};
  const selectedTemplate = clean(templateId) || DEFAULT_REPORT_TEMPLATE;
  const input = wb.input || {};
  const markdown = [
    "# 법령 검토 보고서 초안",
    "",
    "## 1. 질문/업로드 문서 요약",
    paragraph(input.query || [input.lawName, input.article].filter(Boolean).join(" ") || "작성 필요"),
    "",
    "## 2. 관련 법령 조문",
    articleSummary(wb.article),
    "",
    "## 3. 별표/서식",
    listSummary(wb.annexes?.items, annexLabel),
    "",
    "## 4. 시행령/시행규칙",
    structureSummary(wb.structure),
    "",
    "## 5. 자치법규",
    listSummary(wb.ordinances?.items, titleLabel),
    "",
    "## 6. 판례/해석례/결정례",
    decisionSummary(wb.decisions),
    "",
    "## 7. 내부자료 충돌 여부",
    internalImpactSummary(wb.internalImpact),
    "",
    "## 8. 검토의견서 초안",
    draftOpinion(wb),
    "",
    warningSummary(wb.warnings)
  ].filter((part) => part !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    ok: true,
    markdown,
    citations: Array.isArray(wb.citations) ? wb.citations : [],
    metadata: {
      law: { ok: true, mode: "law_workbench_report", citations: Array.isArray(wb.citations) ? wb.citations : [] },
      lawWorkbench: {
        generatedAt: wb.generatedAt || "",
        input,
        warningCount: Array.isArray(wb.warnings) ? wb.warnings.length : 0
      }
    },
    recommendedTemplateId: selectedTemplate,
    warnings: Array.isArray(wb.warnings) ? wb.warnings : []
  };
}

function buildInternalImpact({ enabled, articleBlock, lawName, article, query, materialText, citations }) {
  if (!enabled) return { ok: false, skipped: true, summary: "내부자료 영향 분석이 요청되지 않았습니다." };
  if (!articleBlock?.ok || !articleBlock.text) {
    return { ok: false, summary: "조문 본문이 없어 내부자료 영향 분석을 생성하지 못했습니다." };
  }
  const citation = citations[0] || normalizeLawCitationForMeta(articleBlock.citation || {
    citationId: "L1",
    sourceType: "law",
    lawName,
    article,
    locator: [lawName, article].filter(Boolean).join(" ")
  }, 0, articleBlock.text);
  const impactMap = createDeterministicImpactMap({
    citation,
    articleText: articleBlock.text,
    subject: query,
    materialText
  });
  const materialSignals = (impactMap.nodes || []).filter((node) => node.type === "material_signal").length;
  return {
    ok: true,
    summary: materialSignals
      ? `내부자료에서 조문과 연결되는 신호 ${materialSignals}건을 찾았습니다.`
      : "내부자료에서 조문과 직접 일치하는 신호를 찾지 못했습니다.",
    citation,
    impactMap
  };
}

async function capture(source, fn, { warnings, errors }) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const lawError = toLawError(error);
    const item = {
      source,
      marker: lawError.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
      message: lawError.message || error.message || "Law lookup failed."
    };
    warnings.push(item);
    errors.push(item);
    return { ok: false, error: item };
  }
}

function emptyBlock(result, source) {
  if (result?.skipped) return { ok: false, skipped: true, items: [] };
  return { ok: false, source, error: result?.error || null, items: [] };
}

function resultListBlock(result, source) {
  if (!result?.ok) return emptyBlock(result, source);
  const value = result.value || {};
  return {
    ok: value.ok !== false,
    items: normalizeItems(value),
    rawCount: countItems(value),
    cacheHit: Boolean(value.cacheHit)
  };
}

function historyBlock(result) {
  if (!result?.ok) return { ...emptyBlock(result, "history"), revisions: [] };
  const value = result.value || {};
  const revisions = Array.isArray(value.revisions) ? value.revisions : [];
  return {
    ok: value.ok !== false,
    lawName: value.lawName || "",
    lawId: value.lawId || "",
    mst: value.mst || "",
    revisions,
    diffCandidates: revisions.map((rev) => rev.effectiveDate).filter(Boolean).slice(0, 20),
    cacheHit: Boolean(value.cacheHit)
  };
}

function structureBlock(result) {
  if (!result?.ok) return emptyBlock(result, "structure");
  const value = result.value || {};
  return {
    ok: value.ok !== false,
    lawName: value.lawName || "",
    tiers: value.tiers || [],
    cacheHit: Boolean(value.cacheHit)
  };
}

function normalizeItems(value) {
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.links)) return value.links;
  if (Array.isArray(value)) return value;
  return [];
}

function countItems(value) {
  return normalizeItems(value).length;
}

function articleSummary(article) {
  if (!article?.ok) return "공식 조문 본문을 확인하지 못했습니다.";
  const cite = article.citation?.citationId ? `[${article.citation.citationId}] ` : "";
  return `${cite}${article.citation?.locator || "조문"}\n\n${truncate(article.text, 1800)}`;
}

function structureSummary(structure) {
  const tiers = structure?.tiers;
  if (!tiers) return "법률-시행령-시행규칙 연결 정보를 확인하지 못했습니다.";
  if (Array.isArray(tiers)) return listSummary(tiers, titleLabel);
  return Object.entries(tiers)
    .map(([key, value]) => `- ${key}: ${value?.lawName || (value?.found === false ? "확인 안 됨" : "작성 필요")}`)
    .join("\n") || "법체계 정보를 확인하지 못했습니다.";
}

function decisionSummary(decisions = {}) {
  const parts = [
    ["판례", decisions.precedents?.items],
    ["해석례", decisions.interpretations?.items],
    ["행정규칙", decisions.adminRules?.items]
  ].map(([label, items]) => `### ${label}\n${listSummary(items, titleLabel)}`);
  return parts.join("\n\n");
}

function internalImpactSummary(impact) {
  if (!impact) return "내부자료 영향 분석 결과가 없습니다.";
  if (impact.summary) return impact.summary;
  return impact.ok ? "내부자료 영향 분석을 완료했습니다." : "내부자료 영향 분석 결과가 없습니다.";
}

function draftOpinion(wb) {
  const hasArticle = Boolean(wb.article?.ok);
  const hasInternalRisk = Boolean(wb.internalImpact?.ok);
  if (!hasArticle) return "공식 조문 근거가 부족하므로 최종 법령 적합성 판단은 보류하고, 법령명과 조문을 특정해 추가 확인이 필요합니다.";
  if (hasInternalRisk) return "공식 조문과 내부자료 영향 분석 결과를 기준으로 쟁점별 보완 필요 여부를 검토하고, 별표/하위법령/자치법규 확인 결과를 반영해 최종 의견을 확정해야 합니다.";
  return "공식 조문 근거는 확인되었으나 내부자료 대조가 제한적이므로, 실제 문서·업무 절차와의 충돌 여부를 추가 점검해야 합니다.";
}

function warningSummary(warnings = []) {
  if (!Array.isArray(warnings) || !warnings.length) return "";
  return ["## 조회 한계", ...warnings.map((item) => `- ${item.source || "source"}: ${item.message || item.marker || "확인 필요"}`)].join("\n");
}

function listSummary(items, labelFn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "확인된 항목이 없습니다.";
  return list.slice(0, 8).map((item) => `- ${labelFn(item)}`).join("\n");
}

function annexLabel(item) {
  return [item.title, item.annexNo || item.formNo].filter(Boolean).join(" / ") || "별표/서식";
}

function titleLabel(item) {
  return item.title || item.lawName || item.name || item.caseNumber || item.locator || JSON.stringify(item).slice(0, 120);
}

function paragraph(value) {
  return String(value || "").trim() || "작성 필요";
}

function truncate(value, max) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n\n(이하 생략)`;
}

function clean(value, max = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
