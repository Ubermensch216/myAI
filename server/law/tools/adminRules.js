import { runLoggedLawTool } from "./toolRunner.js";

export async function searchAdminRules(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_admin_rule",
    options,
    normalizedQuery: { query: input.query, display: input.display, agency: input.agency || "" },
    execute: (client) => client.searchAdminRules(input, options)
  });
}

export async function getAdminRuleDetail(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "admin_rule_detail",
    options,
    normalizedQuery: { admrulId: input.admrulId || "", query: input.query || "" },
    execute: (client) => client.getAdminRuleDetail(input, options)
  });
}
