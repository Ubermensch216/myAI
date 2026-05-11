import { createLawApiClient } from "../lawApiClient.js";
import { LAW_ERROR_MARKERS } from "../lawErrors.js";
import { logLawCall } from "../lawLogger.js";

export function resolveLawToolClient(options = {}) {
  return options.client || createLawApiClient();
}

export async function runLoggedLawTool({
  tool,
  options = {},
  normalizedQuery = {},
  execute,
  resultCount = defaultResultCount,
  cacheHit = defaultCacheHit,
  errorMarker = defaultErrorMarker,
  mapError = (error) => error
}) {
  const client = resolveLawToolClient(options);
  const startedAt = Date.now();

  try {
    const result = await execute(client);
    await logLawCall({
      tool,
      normalizedQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: resultCount(result),
      cacheHit: cacheHit(result)
    });
    return result;
  } catch (error) {
    const mappedError = mapError(error);
    await logLawCall({
      tool,
      normalizedQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: errorMarker(mappedError)
    });
    throw mappedError;
  }
}

function defaultResultCount(result) {
  if (Array.isArray(result?.results)) return result.results.length;
  return result?.ok ? 1 : 0;
}

function defaultCacheHit(result) {
  return result?.cacheHit;
}

function defaultErrorMarker(error) {
  return error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR;
}
