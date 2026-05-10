import { createLawApiClient } from "../lawApiClient.js";
import { normalizeLawName } from "../lawArticleRef.js";
import { LawError, LAW_ERROR_MARKERS, toLawError } from "../lawErrors.js";
import { logLawCall } from "../lawLogger.js";

export async function getLawHistory(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
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
  try {
    const result = await client.getLawHistory({ lawName, lawId, mst }, options);
    await logLawCall({
      tool: "law_history",
      normalizedQuery: logQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: Array.isArray(result.revisions) ? result.revisions.length : 0,
      cacheHit: Boolean(result.cacheHit)
    });
    return result;
  } catch (error) {
    const lawError = toLawError(error);
    await logLawCall({
      tool: "law_history",
      normalizedQuery: logQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: lawError.marker || LAW_ERROR_MARKERS.LAW_API_ERROR
    });
    throw lawError;
  }
}
