import { normalizeLawName } from "../lawArticleRef.js";
import { LawError, LAW_ERROR_MARKERS, toLawError } from "../lawErrors.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function getLawHistory(input = {}, options = {}) {
  const lawName = normalizeLawName(input.lawName);
  const lawId = String(input.lawId || "").trim();
  const mst = String(input.mst || "").trim();
  if (!lawName && !lawId && !mst) {
    throw new LawError("lawName, lawId, or mst is required for law history lookup.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }
  const logQuery = { lawName, canonical: [lawName, lawId, mst].filter(Boolean).join("|") };
  return runLoggedLawTool({
    tool: "law_history",
    options,
    normalizedQuery: logQuery,
    execute: (client) => client.getLawHistory({ lawName, lawId, mst }, options),
    resultCount: (result) => Array.isArray(result.revisions) ? result.revisions.length : 0,
    cacheHit: (result) => Boolean(result.cacheHit),
    errorMarker: (error) => error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
    mapError: (error) => toLawError(error)
  });
}
