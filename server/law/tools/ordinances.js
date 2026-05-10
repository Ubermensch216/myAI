import { createLawApiClient } from "../lawApiClient.js";
import { logLawCall } from "../lawLogger.js";

export async function searchOrdinances(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.searchOrdinances(input, options);
    await logLawCall({
      tool: "search_ordinance",
      normalizedQuery: { query: input.query, display: input.display, region: input.region || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.results?.length || 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "search_ordinance",
      normalizedQuery: { query: input.query, display: input.display, region: input.region || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}

export async function getOrdinanceDetail(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.getOrdinanceDetail(input, options);
    await logLawCall({
      tool: "ordinance_detail",
      normalizedQuery: { ordinId: input.ordinId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "ordinance_detail",
      normalizedQuery: { ordinId: input.ordinId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
