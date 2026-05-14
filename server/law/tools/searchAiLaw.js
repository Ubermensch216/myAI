import { runLoggedLawTool } from "./toolRunner.js";

export async function searchAiLaw(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_ai_law",
    options,
    normalizedQuery: { query: input.query, searchType: input.searchType },
    execute: (client) => client.searchAiLaw(input, options)
  });
}
