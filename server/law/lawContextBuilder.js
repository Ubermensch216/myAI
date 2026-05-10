import { detectLawIntent } from "./lawIntent.js";
import { formatLawContext, normalizeLawCitationForMeta, disclaimerForLawMode } from "./lawCitationFormatter.js";
import { LAW_ERROR_MARKERS, toLawError } from "./lawErrors.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { searchLaw } from "./tools/searchLaw.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
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
      const citation = normalizeLawCitationForMeta(article.citation, 0);
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

    if (intent.mode === "law_search" || intent.mode === "legal_research") {
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
