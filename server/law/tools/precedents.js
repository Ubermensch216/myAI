import { runLoggedLawTool } from "./toolRunner.js";

export async function searchPrecedents(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_precedent",
    options,
    normalizedQuery: { query: input.query, display: input.display, court: input.court || "", caseType: input.caseType || "" },
    execute: (client) => client.searchPrecedents(input, options)
  });
}

export async function getPrecedentDetail(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "precedent_detail",
    options,
    normalizedQuery: { precId: input.precId || "", caseNumber: input.caseNumber || "" },
    execute: (client) => client.getPrecedentDetail(input, options)
  });
}
