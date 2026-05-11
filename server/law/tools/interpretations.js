import { runLoggedLawTool } from "./toolRunner.js";

export async function searchInterpretations(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_interpretation",
    options,
    normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
    execute: (client) => client.searchInterpretations(input, options)
  });
}

export async function getInterpretationDetail(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "interpretation_detail",
    options,
    normalizedQuery: { expcId: input.expcId || "", query: input.query || "" },
    execute: (client) => client.getInterpretationDetail(input, options)
  });
}
