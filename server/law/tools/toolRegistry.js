import { buildActionPlanContext, buildForcedLawContext } from "../lawContextBuilder.js";
import { searchLaw } from "./searchLaw.js";
import { searchAiLaw } from "./searchAiLaw.js";
import { getLawText } from "./lawText.js";
import { getArticleDetail } from "./articleDetail.js";
import { getArticleAt } from "./articleAt.js";
import { getArticleDiff } from "./articleDiff.js";
import { getLawHistory } from "./lawHistory.js";
import { verifyLawCitations } from "./verifyCitations.js";
import { searchPrecedents, getPrecedentDetail } from "./precedents.js";
import { searchInterpretations, getInterpretationDetail } from "./interpretations.js";
import { searchAdminRules, getAdminRuleDetail } from "./adminRules.js";
import { searchOrdinances, getOrdinanceDetail } from "./ordinances.js";
import { buildImpactMap } from "./impactMap.js";
import { runTimeTravel } from "./timeTravel.js";

const LAW_TOOLS = [
  { name: "discover_tools", category: "meta", description: "Discover Korean Law Engine tools by name, category, or keyword." },
  { name: "execute_tool", category: "meta", description: "Execute a discovered Korean Law Engine tool with JSON params." },
  { name: "search_law", category: "law", description: "Search official Korean law names and identifiers." },
  { name: "search_ai_law", category: "law", description: "Semantic natural-language search over law and admin-rule article content." },
  { name: "search_all", category: "research", description: "Natural-language research across statutes, precedents, interpretations, admin rules, and ordinances." },
  { name: "get_law_text", category: "law", description: "Get full official law text or a specific article when jo/article is provided." },
  { name: "get_article_detail", category: "law", description: "Get one official statute article." },
  { name: "get_article_at", category: "history", description: "Get an article as of a requested effective date." },
  { name: "get_article_diff", category: "history", description: "Diff one article across two effective dates." },
  { name: "get_law_history", category: "history", description: "List effective-date law revisions." },
  { name: "verify_citations", category: "verification", description: "Extract and verify Korean statute citations." },
  { name: "search_precedents", category: "precedent", description: "Search official precedent records." },
  { name: "get_precedent_text", category: "precedent", description: "Get official precedent text." },
  { name: "search_interpretations", category: "interpretation", description: "Search official legal interpretation records." },
  { name: "get_interpretation_text", category: "interpretation", description: "Get official legal interpretation text." },
  { name: "search_admin_rule", category: "admin_rule", description: "Search official administrative rules." },
  { name: "get_admin_rule", category: "admin_rule", description: "Get official administrative-rule text." },
  { name: "search_ordinance", category: "ordinance", description: "Search official local ordinance records." },
  { name: "get_ordinance", category: "ordinance", description: "Get official local ordinance text." },
  { name: "impact_map", category: "analysis", description: "Build a structural impact map for one statute article." },
  { name: "time_travel", category: "history", description: "Compare one article or full law across two dates." },
  { name: "action_plan", category: "chain", description: "Create evidence-grounded citizen action-plan context from a natural-language situation." },
  { name: "chain_full_research", category: "chain", description: "MCP-compatible full-research chain alias." },
  { name: "chain_amendment_track", category: "chain", description: "MCP-compatible amendment/time-travel chain alias." }
];

export function listLawTools({ query = "", category = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const cat = String(category || "").trim().toLowerCase();
  return LAW_TOOLS.filter((tool) => {
    if (cat && tool.category.toLowerCase() !== cat) return false;
    if (!needle) return true;
    return `${tool.name} ${tool.category} ${tool.description}`.toLowerCase().includes(needle);
  });
}

export async function executeLawTool(input = {}, options = {}) {
  const name = String(input.toolName || input.tool_name || input.name || input.tool || "").trim();
  const params = input.params && typeof input.params === "object"
    ? input.params
    : input.arguments && typeof input.arguments === "object"
      ? input.arguments
      : {};
  const execOptions = { client: options.client, signal: options.signal };
  switch (name) {
    case "discover_tools":
      return { ok: true, tools: listLawTools(params) };
    case "execute_tool":
      if (params.toolName === "execute_tool" || params.tool_name === "execute_tool") {
        return { ok: false, error: "RECURSIVE_TOOL_EXECUTION_BLOCKED" };
      }
      return executeLawTool(params, options);
    case "search_law":
      return searchLaw(params, execOptions);
    case "search_ai_law":
      return searchAiLaw(params, execOptions);
    case "search_all":
      return buildForcedLawContext(String(params.query || ""), execOptions);
    case "get_law_text":
      return getLawText(normalizeArticleAlias(params), execOptions);
    case "get_article_detail":
      return getArticleDetail(normalizeArticleAlias(params), execOptions);
    case "get_article_at":
      return getArticleAt(normalizeArticleAlias(params), execOptions);
    case "get_article_diff":
      return getArticleDiff(normalizeArticleAlias(params), execOptions);
    case "get_law_history":
      return getLawHistory(params, execOptions);
    case "verify_citations":
      return verifyLawCitations(params, execOptions);
    case "search_precedents":
      return searchPrecedents(params, execOptions);
    case "get_precedent_text":
      return getPrecedentDetail({
        precId: params.precId || params.caseId || params.id,
        caseNumber: params.caseNumber
      }, execOptions);
    case "search_interpretations":
      return searchInterpretations(params, execOptions);
    case "get_interpretation_text":
      return getInterpretationDetail({
        expcId: params.expcId || params.id,
        query: params.query
      }, execOptions);
    case "search_admin_rule":
      return searchAdminRules(params, execOptions);
    case "get_admin_rule":
      return getAdminRuleDetail({
        admrulId: params.admrulId || params.id,
        query: params.query
      }, execOptions);
    case "search_ordinance":
      return searchOrdinances(params, execOptions);
    case "get_ordinance":
      return getOrdinanceDetail({
        ordinId: params.ordinId || params.ordinSeq || params.id,
        query: params.query
      }, execOptions);
    case "impact_map":
      return buildImpactMap(normalizeArticleAlias(params), execOptions);
    case "time_travel":
      return runTimeTravel(normalizeArticleAlias(params), execOptions);
    case "action_plan":
      return buildActionPlanContext(normalizeArticleAlias(params), execOptions);
    case "chain_full_research":
      if (params.scenario === "action_plan") return buildActionPlanContext(normalizeArticleAlias(params), execOptions);
      return buildForcedLawContext(String(params.query || ""), execOptions);
    case "chain_amendment_track":
      if (!params.scenario || params.scenario === "time_travel") return runTimeTravel(normalizeArticleAlias(params), execOptions);
      return getLawHistory({ lawName: params.lawName || params.query, lawId: params.lawId, mst: params.mst }, execOptions);
    default:
      return {
        ok: false,
        error: "UNKNOWN_LAW_TOOL",
        toolName: name,
        availableTools: LAW_TOOLS.map((tool) => tool.name)
      };
  }
}

function normalizeArticleAlias(params = {}) {
  return {
    ...params,
    article: params.article || params.jo,
    lawName: params.lawName || params.query
  };
}
