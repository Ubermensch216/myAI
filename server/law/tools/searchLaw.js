import { createLawApiClient } from "../lawApiClient.js";
import { normalizeLawName } from "../lawArticleRef.js";
import { logLawCall } from "../lawLogger.js";

export async function searchLaw(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.searchLaw(input, options);
    await logLawCall({
      tool: "search_law",
      normalizedQuery: { query: normalizeLawName(input.query), display: input.display },
      latencyMs: Date.now() - startedAt,
      resultCount: result.results?.length || 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "search_law",
      normalizedQuery: { query: normalizeLawName(input.query), display: input.display },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
