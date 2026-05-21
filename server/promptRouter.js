import { buildComplianceSearchQuery } from "./compliance/complianceTypes.js";
import { detectLawIntent } from "./law/lawIntent.js";
import { shouldUseNaverSearch } from "./naverSearch.js";

export const CHAT_ROUTES = Object.freeze({
  MAP_REDUCE: "map_reduce",
  STRICT_LAW_SEARCH: "strict_law_search",
  COMPLIANCE_REVIEW: "compliance_review",
  LAW: "law",
  WEB_SEARCH: "web_search",
  NOTEBOOK_RAG: "notebook_rag",
  NORMAL_CHAT: "normal_chat"
});

export function classifyChatRoute({
  prompt = "",
  messages = [],
  documents = [],
  notebookId = null,
  mode = "chat",
  lawSearchMode = false
} = {}) {
  const latestPrompt = normalizePrompt(prompt) || latestUserPrompt(messages);
  const hasNotebook = Boolean(notebookId);
  const hasDocuments = Array.isArray(documents) && documents.length > 0;
  const isLawSearchMode = Boolean(lawSearchMode);
  const isMapReduceMode = mode === "map_reduce" && !isLawSearchMode;
  const lawIntent = detectLawIntent(latestPrompt, { hasNotebook, hasDocuments });
  const isComplianceReview = !isLawSearchMode && lawIntent.mode === "department_legal_review";
  const webSearchAllowed = !isLawSearchMode && !hasNotebook && !hasDocuments;
  const requestedWebSearch = shouldUseNaverSearch(latestPrompt);
  const forceWebSearch = webSearchAllowed && !lawIntent.isLegalQuery && requestedWebSearch;
  const shouldLoadNotebookContext = !isLawSearchMode && !isMapReduceMode && hasNotebook;
  const reasonCodes = [];

  if (isLawSearchMode) reasonCodes.push("law_search_mode");
  if (isMapReduceMode) reasonCodes.push("map_reduce_mode");
  if (hasNotebook) reasonCodes.push("notebook_selected");
  if (hasDocuments) reasonCodes.push("documents_present");
  if (lawIntent.isLegalQuery) reasonCodes.push(`law_intent:${lawIntent.mode}`);
  if (forceWebSearch) reasonCodes.push("explicit_web_search");
  if ((hasNotebook || hasDocuments) && requestedWebSearch) {
    reasonCodes.push(hasNotebook ? "web_search_blocked_by_notebook" : "web_search_blocked_by_documents");
  }

  const route = chooseRoute({
    isLawSearchMode,
    isMapReduceMode,
    isComplianceReview,
    lawIntent,
    forceWebSearch,
    hasNotebook
  });
  if (route === CHAT_ROUTES.COMPLIANCE_REVIEW) reasonCodes.push("compliance_review");
  if (route === CHAT_ROUTES.NORMAL_CHAT) reasonCodes.push("normal_chat");

  const requiresInternalMaterial = route === CHAT_ROUTES.COMPLIANCE_REVIEW && !hasNotebook && !hasDocuments;
  if (requiresInternalMaterial) reasonCodes.push("internal_material_missing");

  return {
    route,
    lawIntent,
    chatFlags: {
      isLawSearchMode,
      forceWebSearch,
      allowWebSearch: webSearchAllowed,
      shouldLoadNotebookContext,
      hasNotebook,
      hasDocuments
    },
    requiresInternalMaterial,
    notebookQueryOverride: route === CHAT_ROUTES.COMPLIANCE_REVIEW
      ? buildComplianceSearchQuery({
          userQuestion: latestPrompt,
          reviewType: lawIntent.reviewType,
          focusLawNames: lawIntent.focusLawNames
        })
      : "",
    reasonCodes
  };
}

export function resolveChatModeFlags(input = {}) {
  return classifyChatRoute(input).chatFlags;
}

function chooseRoute({
  isLawSearchMode,
  isMapReduceMode,
  isComplianceReview,
  lawIntent,
  forceWebSearch,
  hasNotebook
}) {
  if (isLawSearchMode) return CHAT_ROUTES.STRICT_LAW_SEARCH;
  if (isMapReduceMode) return CHAT_ROUTES.MAP_REDUCE;
  if (isComplianceReview) return CHAT_ROUTES.COMPLIANCE_REVIEW;
  if (lawIntent.isLegalQuery) return CHAT_ROUTES.LAW;
  if (hasNotebook) return CHAT_ROUTES.NOTEBOOK_RAG;
  if (forceWebSearch) return CHAT_ROUTES.WEB_SEARCH;
  return CHAT_ROUTES.NORMAL_CHAT;
}

function normalizePrompt(prompt) {
  return String(prompt || "").trim();
}

function latestUserPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return normalizePrompt(message.content);
  }
  return "";
}
