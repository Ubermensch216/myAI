import { createDecisionsApiClient } from "../decisionsApiClient.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function searchDecisions(input = {}, options = {}) {
  const dc = typeof options.client?.searchDecisions === "function"
    ? options.client
    : createDecisionsApiClient();
  return runLoggedLawTool({
    tool: "search_decisions",
    options: { ...options, client: dc },
    normalizedQuery: {
      query: input.query || "",
      domain: input.domain || "all",
      subType: input.subType || input.type || "kor"
    },
    execute: (client) => client.searchDecisions(input)
  });
}

export async function getDecisionText(input = {}, options = {}) {
  const dc = typeof options.client?.getDecisionText === "function"
    ? options.client
    : createDecisionsApiClient();
  return runLoggedLawTool({
    tool: "get_decision_text",
    options: { ...options, client: dc },
    normalizedQuery: {
      id: input.id || "",
      domain: input.domain || "",
      sourceType: input.sourceType || input.subType || ""
    },
    execute: (client) => client.getDecisionText(input)
  });
}
