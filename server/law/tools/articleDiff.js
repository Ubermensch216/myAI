import { normalizeEffectiveDate } from "../lawArticleRef.js";
import { LawError, LAW_ERROR_MARKERS, toLawError } from "../lawErrors.js";
import { computeArticleDiff } from "../lawDiff.js";
import { getArticleAt } from "./articleAt.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function getArticleDiff(input = {}, options = {}) {
  const lawName = String(input.lawName || "").trim();
  const article = String(input.article || "").trim();
  const fromDate = normalizeEffectiveDate(input.fromDate);
  const toDate = normalizeEffectiveDate(input.toDate);
  if (!lawName || !article) {
    throw new LawError("lawName and article are required for article diff.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }
  if (!fromDate.iso || !toDate.iso) {
    throw new LawError("fromDate and toDate (YYYY-MM-DD) are required for article diff.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }
  if (fromDate.iso === toDate.iso) {
    throw new LawError("fromDate and toDate must differ.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }

  const logQuery = { lawName, article, fromDate: fromDate.iso, toDate: toDate.iso };
  return runLoggedLawTool({
    tool: "article_diff",
    options,
    normalizedQuery: logQuery,
    execute: async (client) => {
      const [fromResult, toResult] = await Promise.all([
        getArticleAt({ lawName, article, effectiveDate: fromDate.iso }, { client, signal: options.signal }),
        getArticleAt({ lawName, article, effectiveDate: toDate.iso }, { client, signal: options.signal })
      ]);
      const diff = computeArticleDiff(fromResult.text, toResult.text);
      return {
        ok: true,
        query: logQuery,
        from: {
          citation: fromResult.citation,
          text: fromResult.text,
          effectiveDate: fromDate.iso,
          snapshotEffectiveDate: fromResult.citation?.effectiveDate || "",
          cacheHit: Boolean(fromResult.cacheHit)
        },
        to: {
          citation: toResult.citation,
          text: toResult.text,
          effectiveDate: toDate.iso,
          snapshotEffectiveDate: toResult.citation?.effectiveDate || "",
          cacheHit: Boolean(toResult.cacheHit)
        },
        diff
      };
    },
    resultCount: (result) => result.diff?.hunks?.length || 0,
    cacheHit: (result) => Boolean(result.from?.cacheHit && result.to?.cacheHit),
    errorMarker: (error) => error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
    mapError: (error) => toLawError(error)
  });
}
