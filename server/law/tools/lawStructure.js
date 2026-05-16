import { runLoggedLawTool } from "./toolRunner.js";

export async function getThreeTier(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "get_three_tier",
    options,
    normalizedQuery: { lawName: input.lawName || "" },
    execute: (client) => client.getThreeTier(input, options)
  });
}

export async function getDelegatedLaws(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "get_delegated_laws",
    options,
    normalizedQuery: { lawName: input.lawName || "", mst: input.mst || "" },
    execute: (client) => client.getDelegatedLaws(input, options)
  });
}

export async function getLinkedOrdinances(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "get_linked_ordinances",
    options,
    normalizedQuery: { lawName: input.lawName || "" },
    execute: (client) => client.getLinkedOrdinances(input, options)
  });
}

export async function getLinkedOrdinanceArticles(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "get_linked_ordinance_articles",
    options,
    normalizedQuery: { ordinId: input.ordinId || "", lawName: input.lawName || "" },
    execute: (client) => client.getLinkedOrdinanceArticles(input, options)
  });
}

export async function getLinkedLawsFromOrdinance(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "get_linked_laws_from_ordinance",
    options,
    normalizedQuery: { ordinId: input.ordinId || "" },
    execute: (client) => client.getLinkedLawsFromOrdinance(input, options)
  });
}
