import { runLoggedLawTool } from "./toolRunner.js";

export async function searchOrdinances(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_ordinance",
    options,
    normalizedQuery: { query: input.query, display: input.display, region: input.region || "" },
    execute: (client) => client.searchOrdinances(input, options)
  });
}

export async function getOrdinanceDetail(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "ordinance_detail",
    options,
    normalizedQuery: { ordinId: input.ordinId || "", query: input.query || "" },
    execute: (client) => client.getOrdinanceDetail(input, options)
  });
}
