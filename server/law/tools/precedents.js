import { createLawApiClient } from "../lawApiClient.js";
import { logLawCall } from "../lawLogger.js";

export async function searchPrecedents(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.searchPrecedents(input, options);
    await logLawCall({
      tool: "search_precedent",
      normalizedQuery: { query: input.query, display: input.display, court: input.court || "", caseType: input.caseType || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.results?.length || 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "search_precedent",
      normalizedQuery: { query: input.query, display: input.display, court: input.court || "", caseType: input.caseType || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}

export async function getPrecedentDetail(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.getPrecedentDetail(input, options);
    await logLawCall({
      tool: "precedent_detail",
      normalizedQuery: { precId: input.precId || "", caseNumber: input.caseNumber || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "precedent_detail",
      normalizedQuery: { precId: input.precId || "", caseNumber: input.caseNumber || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
