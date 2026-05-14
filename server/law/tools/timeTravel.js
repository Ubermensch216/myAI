import { normalizeEffectiveDate } from "../lawArticleRef.js";
import { computeArticleDiff } from "../lawDiff.js";
import { LawError, LAW_ERROR_MARKERS, toLawError } from "../lawErrors.js";
import { getArticleDiff } from "./articleDiff.js";
import { runLoggedLawTool } from "./toolRunner.js";

const MAX_FULL_LAW_DIFF_LINES = 1400;

export async function runTimeTravel(input = {}, options = {}) {
  const query = String(input.query || input.lawName || "").trim();
  const lawName = String(input.lawName || input.query || "").trim();
  const article = String(input.article || input.jo || "").trim();
  const fromDate = normalizeEffectiveDate(input.fromDate);
  const toDate = normalizeEffectiveDate(input.toDate);
  if (!query && !lawName) {
    throw new LawError("query or lawName is required for time_travel.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }
  if (!fromDate.iso || !toDate.iso) {
    throw new LawError("fromDate and toDate (YYYY-MM-DD) are required for time_travel.", {
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

  if (article) {
    const result = await getArticleDiff({ lawName, article, fromDate: fromDate.iso, toDate: toDate.iso }, options);
    return {
      ...result,
      mode: "time_travel",
      scope: "article"
    };
  }

  const normalizedQuery = { query: query || lawName, fromDate: fromDate.iso, toDate: toDate.iso };
  return runLoggedLawTool({
    tool: "time_travel",
    options,
    normalizedQuery,
    execute: async (client) => {
      const [fromResult, toResult] = await Promise.all([
        client.getLawText({ lawName: lawName || query, effectiveDate: fromDate.iso }, { signal: options.signal }),
        client.getLawText({ lawName: lawName || query, effectiveDate: toDate.iso }, { signal: options.signal })
      ]);
      const fromText = clampFullLawText(fromResult.text);
      const toText = clampFullLawText(toResult.text);
      const diff = computeArticleDiff(fromText.text, toText.text);
      return {
        ok: true,
        mode: "time_travel",
        scope: "law",
        query: normalizedQuery,
        from: {
          citation: fromResult.citation,
          text: fromText.text,
          effectiveDate: fromDate.iso,
          snapshotEffectiveDate: fromResult.snapshotEffectiveDate || fromResult.citation?.effectiveDate || "",
          cacheHit: Boolean(fromResult.cacheHit),
          truncated: fromText.truncated,
          originalLineCount: fromText.originalLineCount
        },
        to: {
          citation: toResult.citation,
          text: toText.text,
          effectiveDate: toDate.iso,
          snapshotEffectiveDate: toResult.snapshotEffectiveDate || toResult.citation?.effectiveDate || "",
          cacheHit: Boolean(toResult.cacheHit),
          truncated: toText.truncated,
          originalLineCount: toText.originalLineCount
        },
        diff,
        warnings: [
          ...(fromText.truncated || toText.truncated ? ["full_law_diff_truncated"] : [])
        ]
      };
    },
    resultCount: (result) => result.diff?.hunks?.length || 0,
    cacheHit: (result) => Boolean(result.from?.cacheHit && result.to?.cacheHit),
    errorMarker: (error) => error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
    mapError: (error) => toLawError(error)
  });
}

function clampFullLawText(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length <= MAX_FULL_LAW_DIFF_LINES) {
    return { text: lines.join("\n"), truncated: false, originalLineCount: lines.length };
  }
  return {
    text: [
      ...lines.slice(0, MAX_FULL_LAW_DIFF_LINES),
      `[truncated: ${lines.length - MAX_FULL_LAW_DIFF_LINES} additional lines omitted before diff]`
    ].join("\n"),
    truncated: true,
    originalLineCount: lines.length
  };
}
