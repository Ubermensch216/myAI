import { detectLawIntent } from "./lawIntent.js";
import { formatLawContext, normalizeLawCitationForMeta, disclaimerForLawMode } from "./lawCitationFormatter.js";
import { LAW_ERROR_MARKERS, toLawError } from "./lawErrors.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { searchLaw } from "./tools/searchLaw.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
import { searchPrecedents } from "./tools/precedents.js";
import { searchInterpretations } from "./tools/interpretations.js";
import { searchAdminRules } from "./tools/adminRules.js";
import { searchOrdinances } from "./tools/ordinances.js";
import { getLawConfig } from "./lawConfig.js";

export async function buildLawContext(prompt, { hasNotebook = false, hasDocuments = false, signal } = {}) {
  const intent = detectLawIntent(prompt, { hasNotebook, hasDocuments });
  if (!intent.isLegalQuery) return null;

  const startedAt = Date.now();
  try {
    if (intent.mode === "verify_citations") {
      const verification = await verifyLawCitations({ text: prompt }, { signal });
      return {
        ok: true,
        query: prompt,
        mode: intent.mode,
        intent,
        citations: [],
        verification,
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: formatVerificationContext(verification),
        error: "",
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "law_article" || intent.mode === "department_legal_review") {
      const article = await getArticleDetail(intent.extracted, { signal });
      const citation = normalizeLawCitationForMeta(article.citation, 0, article.text);
      const contextItems = [{ citation, text: article.text }];
      return {
        ok: true,
        query: prompt,
        mode: intent.mode,
        intent,
        citations: [citation],
        verification: { checked: false, failCount: 0, results: [] },
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: fitLawContext(formatLawContext(contextItems)),
        error: "",
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "law_search") {
      const result = await searchLaw({ query: intent.extracted.query }, { signal });
      const contextText = formatSearchContext(result);
      return {
        ok: result.ok,
        query: result.query || prompt,
        mode: intent.mode,
        intent,
        citations: [],
        verification: { checked: false, failCount: 0, results: [] },
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: fitLawContext(contextText),
        error: result.ok ? "" : LAW_ERROR_MARKERS.NOT_FOUND,
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "legal_research") {
      return await buildResearchContext(prompt, intent, { signal, startedAt });
    }

    return null;
  } catch (error) {
    if (signal?.aborted) throw error;
    const lawError = toLawError(error);
    return {
      ok: false,
      query: prompt,
      mode: intent.mode,
      intent,
      citations: [],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: disclaimerForLawMode(intent.mode),
      contextText: "",
      error: lawError.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
      errorMessage: lawError.message,
      latencyMs: Date.now() - startedAt
    };
  }
}

async function buildResearchContext(prompt, intent, { signal, startedAt }) {
  const extracted = intent.extracted || {};
  const baseQuery = extracted.query || prompt;
  const lawName = extracted.lawName || "";
  const article = extracted.article || "";

  const wantArticle = Boolean(lawName && article);
  const wantPrecedents = Boolean(extracted.wantPrecedents);
  const wantInterpretations = Boolean(extracted.wantInterpretations);
  const wantAdminRules = Boolean(extracted.wantAdminRules);
  const wantOrdinances = Boolean(extracted.wantOrdinances);

  const searchQuery = [lawName, article, baseQuery].filter(Boolean).join(" ").trim() || baseQuery;

  const tasks = [];
  tasks.push(wantArticle
    ? getArticleDetail({ lawName, article }, { signal }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantPrecedents
    ? searchPrecedents({ query: searchQuery, display: 5 }, { signal }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantInterpretations
    ? searchInterpretations({ query: searchQuery, display: 5 }, { signal }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantAdminRules
    ? searchAdminRules({ query: searchQuery, display: 5 }, { signal }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantOrdinances
    ? searchOrdinances({ query: searchQuery, display: 5 }, { signal }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));

  const [articleResult, precResult, expcResult, admResult, ordResult] = await Promise.all(tasks);

  const sections = [];
  const citations = [];
  const errors = [];

  if (articleResult && !articleResult.error) {
    const cite = normalizeLawCitationForMeta(articleResult.citation, citations.length, articleResult.text);
    citations.push(cite);
    sections.push(formatLawContext([{ citation: cite, text: articleResult.text }]));
  } else if (articleResult?.error) {
    errors.push({ source: "article", marker: articleResult.error.marker });
  }

  if (precResult && !precResult.error) {
    const block = formatPrecedentResultsBlock(precResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (precResult?.error) {
    errors.push({ source: "precedents", marker: precResult.error.marker });
  }

  if (expcResult && !expcResult.error) {
    const block = formatInterpretationResultsBlock(expcResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (expcResult?.error) {
    errors.push({ source: "interpretations", marker: expcResult.error.marker });
  }

  if (admResult && !admResult.error) {
    const block = formatAdminRuleResultsBlock(admResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (admResult?.error) {
    errors.push({ source: "admin_rules", marker: admResult.error.marker });
  }

  if (ordResult && !ordResult.error) {
    const block = formatOrdinanceResultsBlock(ordResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (ordResult?.error) {
    errors.push({ source: "ordinances", marker: ordResult.error.marker });
  }

  return {
    ok: citations.length > 0 || sections.length > 0,
    query: baseQuery,
    mode: "legal_research",
    intent,
    citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: disclaimerForLawMode("legal_research"),
    contextText: fitLawContext(sections.filter(Boolean).join("\n\n")),
    error: errors.length && citations.length === 0 ? LAW_ERROR_MARKERS.LAW_API_ERROR : "",
    errorDetails: errors,
    latencyMs: Date.now() - startedAt
  };
}

function formatPrecedentResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 판례 검색 결과]",
    "These are official 판례 candidates. Cite individual rulings as [P*]. Quote only the 판시사항/판결요지 fields; do not invent reasoning."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `P${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_precedent",
      recordType: "precedent",
      title: item.title,
      caseNumber: item.caseNumber,
      court: item.court,
      date: item.date,
      caseType: item.caseType,
      locator: [item.caseNumber, item.court].filter(Boolean).join(" / "),
      url: item.precId ? `https://www.law.go.kr/precInfoP.do?precSeq=${encodeURIComponent(item.precId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n사건번호: ${item.caseNumber || "-"}\n선고법원: ${item.court || "-"}\n선고일: ${item.date || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatInterpretationResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 법령해석례 검색 결과]",
    "These are official 법령해석례 candidates. Cite individual interpretations as [I*] using the 안건명/회신기관/회신일자."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `I${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_interpretation",
      recordType: "interpretation",
      title: item.title,
      agency: item.agency,
      date: item.date,
      locator: [item.agency, item.date].filter(Boolean).join(" · "),
      url: item.expcId ? `https://www.law.go.kr/expcInfoP.do?expcSeq=${encodeURIComponent(item.expcId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n회신기관: ${item.agency || "-"}\n회신일: ${item.date || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatAdminRuleResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 행정규칙 검색 결과]",
    "These are official 행정규칙 (고시/예규/훈령/지침) candidates. Cite as [R*]."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `R${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_admin_rule",
      recordType: "admin_rule",
      title: item.title,
      agency: item.agency,
      kind: item.kind,
      issueDate: item.issueDate,
      effectiveDate: item.effectiveDate,
      locator: [item.agency, item.kind].filter(Boolean).join(" · "),
      url: item.admrulId ? `https://www.law.go.kr/admRulInfoP.do?admRulSeq=${encodeURIComponent(item.admrulId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n발령기관: ${item.agency || "-"} (${item.kind || "-"})\n시행일: ${item.effectiveDate || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatOrdinanceResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 자치법규 검색 결과]",
    "These are official 자치법규 (조례/규칙) candidates. Cite as [O*]."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `O${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_ordinance",
      recordType: "ordinance",
      title: item.title,
      region: item.region,
      kind: item.kind,
      effectiveDate: item.effectiveDate,
      locator: [item.region, item.kind].filter(Boolean).join(" · "),
      url: item.ordinId ? `https://www.law.go.kr/ordinInfoP.do?ordinSeq=${encodeURIComponent(item.ordinId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n지자체: ${item.region || "-"} (${item.kind || "-"})\n시행일: ${item.effectiveDate || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function fitLawContext(text) {
  const budget = getLawConfig().contextBudget;
  const value = String(text || "");
  if (value.length <= budget) return value;
  return `${value.slice(0, budget)}\n\n[Law context truncated to LAW_CONTEXT_BUDGET]`;
}

function formatSearchContext(result) {
  const items = Array.isArray(result?.results) ? result.results : [];
  if (!items.length) return "";
  const lines = [
    "[공식 법령 검색 결과]",
    `Query: ${result.query}`,
    "These are official law search candidates. Use them only to identify likely law names/IDs; fetch article text before making article-specific claims."
  ];
  items.forEach((item, index) => {
    lines.push(`[L-S${index + 1}] ${item.lawName}\nID: ${item.lawId || ""}\nMST: ${item.mst || ""}\nType: ${item.lawType || ""}\nEffective date: ${item.effectiveDate || ""}`);
  });
  return lines.join("\n\n");
}

function formatVerificationContext(verification) {
  const results = Array.isArray(verification?.results) ? verification.results : [];
  if (!results.length) return "[공식 법령 인용 검증]\nNo recognizable Korean statute/article citations were found to verify.";
  const lines = [
    "[공식 법령 인용 검증]",
    "Use these verification results when discussing whether cited statute articles exist. Do not treat failed citations as real law."
  ];
  results.forEach((item, index) => {
    lines.push(`[V${index + 1}] ${item.citation} -> ${item.valid ? "valid" : "invalid"} (${item.reason})`);
  });
  return lines.join("\n");
}
