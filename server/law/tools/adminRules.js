import { createLawApiClient } from "../lawApiClient.js";
import { logLawCall } from "../lawLogger.js";

export async function searchAdminRules(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.searchAdminRules(input, options);
    await logLawCall({
      tool: "search_admin_rule",
      normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.results?.length || 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "search_admin_rule",
      normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}

export async function getAdminRuleDetail(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  try {
    const result = await client.getAdminRuleDetail(input, options);
    await logLawCall({
      tool: "admin_rule_detail",
      normalizedQuery: { admrulId: input.admrulId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "admin_rule_detail",
      normalizedQuery: { admrulId: input.admrulId || "", query: input.query || "" },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
