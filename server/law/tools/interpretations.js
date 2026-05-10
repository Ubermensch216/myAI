import { createLawApiClient } from "../lawApiClient.js";
import { logLawCall } from "../lawLogger.js";

export async function searchInterpretations(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.searchInterpretations(input, options);
    await logLawCall({
      tool: "search_interpretation",
      normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.results?.length || 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "search_interpretation",
      normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}

export async function getInterpretationDetail(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.getInterpretationDetail(input, options);
    await logLawCall({
      tool: "interpretation_detail",
      normalizedQuery: { expcId: input.expcId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "interpretation_detail",
      normalizedQuery: { expcId: input.expcId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
