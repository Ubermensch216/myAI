import { normalizeLawName } from "../lawArticleRef.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function searchLaw(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_law",
    options,
    normalizedQuery: { query: normalizeLawName(input.query), display: input.display },
    execute: (client) => client.searchLaw(input, options)
  });
}
