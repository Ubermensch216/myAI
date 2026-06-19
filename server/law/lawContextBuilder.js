import { detectLawIntent } from "./lawIntent.js";
import { formatLawContext, normalizeLawCitationForMeta, disclaimerForLawMode } from "./lawCitationFormatter.js";
import { LAW_ERROR_MARKERS, toLawError } from "./lawErrors.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { searchLaw } from "./tools/searchLaw.js";
import { searchAiLaw } from "./tools/searchAiLaw.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
import { searchPrecedents } from "./tools/precedents.js";
import { searchInterpretations } from "./tools/interpretations.js";
import { searchAdminRules } from "./tools/adminRules.js";
import { searchOrdinances } from "./tools/ordinances.js";
import { searchDecisions } from "./tools/decisions.js";
import { createDecisionsApiClient } from "./decisionsApiClient.js";
import { getLawConfig } from "./lawConfig.js";
import { buildLawTopicSearchQuery, inferLawArticleRefsForTopic } from "./lawTopicHints.js";
import { buildPrecedentSearchPlan } from "./lawDecisionQuery.js";
import { buildCompliancePromptBlock } from "../compliance/compliancePrompt.js";
import { buildComplianceSearchQuery, getReviewType } from "../compliance/complianceTypes.js";

const KG_ARTICLES_INTRO = [
  "[지식그래프 연계 법령 근거]",
  "These articles were surfaced by the department notebook knowledge graph for",
  "this query. The bodies were re-fetched from law.go.kr at answer time, so",
  "treat them as official law evidence and cite them as [L1], [L2], etc.",
  "Do NOT invent additional article numbers or statute names that are not in",
  "this list."
].join("\n");

/**
 * Fetch official article text for a set of KG-derived article refs and shape
 * the result so it can be merged into the chat law context. Never throws on
 * individual fetch errors — failed articles are dropped silently so KG
 * surfacing degrades to "no law evidence" rather than blocking the answer.
 *
 * @param {Array<{ lawName: string, article: string, canonical?: string }>} refs
 */
export async function buildLawContextFromArticleRefs(refs, { signal, client, limit = 4 } = {}) {
  const list = Array.isArray(refs) ? refs.filter((r) => r?.lawName && r?.article) : [];
  if (!list.length) return null;
  const startedAt = Date.now();
  const dedup = new Map();
  for (const ref of list) {
    const key = ref.canonical || `${ref.lawName}/${ref.article}`;
    if (!dedup.has(key)) dedup.set(key, ref);
    if (dedup.size >= limit) break;
  }
  const tasks = Array.from(dedup.values()).map((ref) =>
    getArticleDetail({ lawName: ref.lawName, article: ref.article }, { signal, client })
      .then((result) => ({ ok: true, ref, result }))
      .catch((error) => ({ ok: false, ref, error: toLawError(error) }))
  );
  const settled = await Promise.all(tasks);

  const citations = [];
  const contextItems = [];
  const errors = [];
  for (const entry of settled) {
    if (!entry.ok) {
      errors.push({ canonical: entry.ref.canonical, marker: entry.error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR });
      continue;
    }
    const text = String(entry.result?.text || "").trim();
    if (!text) {
      errors.push({ canonical: entry.ref.canonical, marker: LAW_ERROR_MARKERS.NOT_FOUND });
      continue;
    }
    const citation = normalizeLawCitationForMeta(entry.result.citation, citations.length, text);
    citation.kgDerived = true;
    citations.push(citation);
    contextItems.push({ citation, text });
  }
  if (!citations.length) {
    return {
      ok: false,
      query: "",
      mode: "kg_articles",
      intent: { isLegalQuery: false, mode: "kg_articles", extracted: {}, confidence: 0 },
      citations: [],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: "short",
      contextText: "",
      error: errors.length ? LAW_ERROR_MARKERS.LAW_API_ERROR : "",
      errorDetails: errors,
      latencyMs: Date.now() - startedAt
    };
  }

  const lawBlock = formatLawContext(contextItems);
  return {
    ok: true,
    query: "",
    mode: "kg_articles",
    intent: { isLegalQuery: false, mode: "kg_articles", extracted: {}, confidence: 0 },
    citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: "short",
    contextText: fitLawContext([KG_ARTICLES_INTRO, lawBlock].join("\n\n")),
    error: "",
    errorDetails: errors,
    latencyMs: Date.now() - startedAt
  };
}

/**
 * Merge a KG-derived law context into an existing law context (the one built
 * from explicit legal intent). De-duplicates citations by canonical and
 * concatenates contextText blocks. Used by the chat orchestration so explicit
 * intent always wins on disclaimer/mode while KG-discovered articles are
 * still injected as additional [L] citations.
 */
export function mergeLawContexts(primary, kg) {
  if (!kg || !kg.ok || !Array.isArray(kg.citations) || !kg.citations.length) return primary;
  if (!primary || !primary.ok) return kg;

  const knownCanonical = new Set(
    (primary.citations || [])
      .map((c) => c.canonical || `${c.lawName}/${c.article}`)
      .filter(Boolean)
  );
  const additions = [];
  for (const cite of kg.citations) {
    const canon = cite.canonical || `${cite.lawName}/${cite.article}`;
    if (canon && knownCanonical.has(canon)) continue;
    additions.push({ ...cite, citationId: `L${(primary.citations?.length || 0) + additions.length + 1}` });
  }
  if (!additions.length) return primary;

  return {
    ...primary,
    citations: [...(primary.citations || []), ...additions],
    contextText: [primary.contextText, kg.contextText].filter(Boolean).join("\n\n"),
    kgArticlesMerged: additions.length
  };
}

export const ACTION_PLAN_TEMPLATE = [
  "[행동 계획 응답 템플릿]",
  "위 [공식 법령 근거]에서 직접 도출되는 의무·요건만 사용해 다음 5단계 구조로 답하세요. 각 항목은 1~2문장으로 간결하게.",
  "1) 핵심 의무: 조문이 부과하는 의무·금지·요건을 [L] 인용과 함께 정리.",
  "2) 단계별 조치: 1단계, 2단계 식으로 시간 순서로 구체적 행동을 적되 각 단계 끝에 [L] 근거 표시.",
  "3) 증빙·기록: 각 단계에서 보존할 자료·통지·기록을 명시.",
  "4) 후속 점검: 조치 후 모니터링·재점검 항목과 주기.",
  "5) 한계와 권고: 본 답변은 일반 정보 제공이며 법률 자문이 아님을 명시. 사실관계·관할·예외 가능성을 짚고 변호사·노무사·세무사 등 자격 있는 전문가 상담을 권고.",
  "",
  "규칙:",
  "- 위 [공식 법령 근거] 밖의 조문·판례·해석례를 인용하거나 만들지 말 것.",
  "- 근거가 없으면 \"추가 자료가 필요합니다\"라고 명시하고 임의 추정으로 단계를 채우지 말 것.",
  "- \"본 답변은 일반 정보이며 법률 자문이 아닙니다\" 문구를 5)번에 반드시 포함."
].join("\n");

export async function buildForcedLawContext(query, options = {}) {
  const forcedIntent = {
    isLegalQuery: true,
    mode: "law_topic_search",
    extracted: { query },
    confidence: 1.0,
    mayUseWebSearch: false
  };
  const startedAt = options.startedAt ?? Date.now();
  if (isDecisionSearchPrompt(query)) {
    const decisionContext = await buildDecisionSearchContext(query, forcedIntent, { ...options, startedAt });
    if (decisionContext?.ok && Array.isArray(decisionContext.citations) && decisionContext.citations.length > 0) {
      return decisionContext;
    }
    const fallbackContext = await buildTopicSearchContext(query, forcedIntent, { ...options, startedAt });
    if (fallbackContext?.ok && Array.isArray(fallbackContext.citations) && fallbackContext.citations.length > 0) {
      return {
        ...fallbackContext,
        decisionFallback: {
          attempted: true,
          decisionError: decisionContext?.error || "",
          decisionErrorMessage: decisionContext?.errorMessage || ""
        }
      };
    }
    return decisionContext;
  }
  return buildTopicSearchContext(query, forcedIntent, { ...options, startedAt });
}

export async function buildActionPlanContext(input = {}, options = {}) {
  const prompt = String(input.query || input.prompt || "").trim();
  const extracted = {
    ...(input.extracted || {}),
    lawName: input.lawName || input.extracted?.lawName || "",
    article: input.article || input.jo || input.extracted?.article || "",
    query: prompt || input.extracted?.query || ""
  };
  const startedAt = options.startedAt ?? Date.now();
  const intent = input.intent || {
    isLegalQuery: true,
    mode: "action_plan",
    extracted,
    confidence: extracted.lawName && extracted.article ? 0.9 : 0.75,
    mayUseWebSearch: false
  };

  if (extracted.lawName && extracted.article) {
    const article = await getArticleDetail(extracted, { signal: options.signal, client: options.client });
    const citation = normalizeLawCitationForMeta(article.citation, 0, article.text);
    const contextItems = [{ citation, text: article.text }];
    const lawBlock = formatLawContext(contextItems);
    return {
      ok: true,
      query: prompt || extracted.query,
      mode: "action_plan",
      intent,
      citations: [citation],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: disclaimerForLawMode("action_plan"),
      contextText: fitLawContext([lawBlock, ACTION_PLAN_TEMPLATE].filter(Boolean).join("\n\n")),
      error: "",
      latencyMs: Date.now() - startedAt
    };
  }

  const topic = await buildTopicSearchContext(prompt || extracted.query, intent, {
    signal: options.signal,
    startedAt,
    client: options.client
  });
  if (!topic.ok || !topic.citations.length) {
    return {
      ...topic,
      mode: "action_plan",
      intent,
      disclaimer: disclaimerForLawMode("action_plan"),
      contextText: "",
      error: topic.error || LAW_ERROR_MARKERS.NOT_FOUND
    };
  }
  return {
    ...topic,
    mode: "action_plan",
    intent,
    disclaimer: disclaimerForLawMode("action_plan"),
    contextText: fitLawContext([topic.contextText, ACTION_PLAN_TEMPLATE].filter(Boolean).join("\n\n"))
  };
}

export async function buildLawContext(prompt, { hasNotebook = false, hasDocuments = false, signal, client } = {}) {
  const intent = detectLawIntent(prompt, { hasNotebook, hasDocuments });
  if (!intent.isLegalQuery) return null;

  const startedAt = Date.now();
  try {
    if (intent.mode === "verify_citations") {
      const verification = await verifyLawCitations({ text: prompt }, { signal, client });
      return {
        ok: true,
        query: prompt,
        mode: intent.mode,
        intent,
        citations: [],
        verification,
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: formatVerificationContext(verification),
        error: "",
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "department_legal_review") {
      return await buildComplianceLawContext(prompt, intent, { signal, startedAt, client });
    }

    if (intent.mode === "law_article") {
      const article = await getArticleDetail(intent.extracted, { signal, client });
      const citation = normalizeLawCitationForMeta(article.citation, 0, article.text);
      const contextItems = [{ citation, text: article.text }];
      return {
        ok: true,
        query: prompt,
        mode: intent.mode,
        intent,
        citations: [citation],
        verification: { checked: false, failCount: 0, results: [] },
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: fitLawContext(formatLawContext(contextItems)),
        error: "",
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "action_plan") {
      return buildActionPlanContext({ query: prompt, extracted: intent.extracted, intent }, { signal, client, startedAt });
    }

    if (intent.mode === "law_search") {
      const result = await searchLaw({ query: intent.extracted.query }, { signal, client });
      const block = formatSearchResultsBlock("법령 검색 결과", result.results, 0);
      return {
        ok: Boolean(result.ok && block.citations.length),
        query: result.query || prompt,
        mode: intent.mode,
        intent,
        citations: block.citations,
        verification: { checked: false, failCount: 0, results: [] },
        disclaimer: disclaimerForLawMode(intent.mode),
        contextText: fitLawContext(block.text),
        error: result.ok && block.citations.length ? "" : LAW_ERROR_MARKERS.NOT_FOUND,
        latencyMs: Date.now() - startedAt
      };
    }

    if (intent.mode === "law_topic_search") {
      return await buildTopicSearchContext(prompt, intent, { signal, startedAt, client });
    }

    if (intent.mode === "legal_research") {
      return await buildResearchContext(prompt, intent, { signal, startedAt, client });
    }

    return null;
  } catch (error) {
    if (signal?.aborted) throw error;
    const lawError = toLawError(error);
    return {
      ok: false,
      query: prompt,
      mode: intent.mode,
      intent,
      citations: [],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: disclaimerForLawMode(intent.mode),
      contextText: "",
      error: lawError.marker || LAW_ERROR_MARKERS.LAW_API_ERROR,
      errorMessage: lawError.message,
      latencyMs: Date.now() - startedAt
    };
  }
}

// 자연어 법리 질의는 사건명이 아니라 판례 본문(판시사항·판결요지)과 매칭되므로,
// 핵심 키워드를 뽑아 본문 검색(search=2)으로 조회한다. 사건번호가 명시된 경우는
// 사건명 검색(search=1)을 쓴다. (워크벤치 법령검토와 동일한 전략)
function searchPrecedentsForTopic(naturalQuery, { display, signal, client }) {
  const plan = buildPrecedentSearchPlan(naturalQuery);
  return searchPrecedents({ query: plan.primary, display, search: plan.scope }, { signal, client });
}

async function buildTopicSearchContext(prompt, intent, { signal, startedAt, client }) {
  const extracted = intent.extracted || {};
  const query = extracted.query || prompt;
  const searchQuery = buildLawTopicSearchQuery(query);
  const inferredRefs = inferLawArticleRefsForTopic(query);
  const inferredArticleTask = Promise.all(
    inferredRefs.map((ref) =>
      getArticleDetail(ref, { signal, client })
        .then((result) => ({ ok: true, ref, result }))
        .catch((error) => ({ ok: false, ref, error: toLawError(error) }))
    )
  );

  const tasks = [];
  // Parallel: AI semantic search (법조문, 행정규칙조문) + law name search + admin rules + precedents + interpretations
  tasks.push(
    searchAiLaw({ query: searchQuery, searchType: 0, display: 5 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchAiLaw({ query: searchQuery, searchType: 2, display: 5 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchLaw({ query: searchQuery }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchAdminRules({ query: searchQuery, display: 5 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchPrecedentsForTopic(query, { display: 3, signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchInterpretations({ query: searchQuery, display: 3 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchOrdinances({ query: searchQuery, display: 5 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );
  tasks.push(
    searchDecisions({ query: searchQuery, domain: "all", subType: "kor", display: 5 }, { signal, client })
      .catch((error) => ({ error: toLawError(error) }))
  );

  const [inferredArticleResults, aiLawResult, aiAdminResult, lawResult, admResult, precResult, interpResult, ordResult, decisionResult] = await Promise.all([
    inferredArticleTask,
    ...tasks
  ]);

  const sections = [];
  const citations = [];
  const errors = [];

  for (const entry of inferredArticleResults) {
    if (entry.ok) {
      const cite = normalizeLawCitationForMeta(entry.result.citation, citations.length, entry.result.text);
      citations.push(cite);
      sections.push(formatLawContext([{ citation: cite, text: entry.result.text }]));
    } else {
      errors.push({ source: "inferred_article", marker: entry.error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR });
    }
  }

  // Format AI law article search results
  if (aiLawResult && !aiLawResult.error && aiLawResult.results?.length > 0) {
    const block = formatAiSearchResultsBlock("법령 조문 (AI 검색)", aiLawResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (aiLawResult?.error) {
    errors.push({ source: "ai_law", marker: aiLawResult.error.marker });
  }

  // Format AI admin rules article search results
  if (aiAdminResult && !aiAdminResult.error && aiAdminResult.results?.length > 0) {
    const block = formatAiSearchResultsBlock("행정규칙 조문 (AI 검색)", aiAdminResult.results, citations.length, "admin_rule");
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (aiAdminResult?.error) {
    errors.push({ source: "ai_admin", marker: aiAdminResult.error.marker });
  }

  // Format law name search results
  if (lawResult && !lawResult.error && lawResult.results?.length > 0) {
    const block = formatSearchResultsBlock("법령 (이름 기준)", lawResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (lawResult?.error) {
    errors.push({ source: "law", marker: lawResult.error.marker });
  }

  // Format admin rules search results
  if (admResult && !admResult.error && admResult.results?.length > 0) {
    const block = formatAdminRuleResultsBlock(admResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (admResult?.error) {
    errors.push({ source: "admin_rules", marker: admResult.error.marker });
  }

  // Format precedents (판례) results
  if (precResult && !precResult.error && precResult.results?.length > 0) {
    const block = formatPrecedentResultsBlock(precResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (precResult?.error) {
    errors.push({ source: "precedents", marker: precResult.error.marker });
  }

  // Format interpretations (해석례) results
  if (interpResult && !interpResult.error && interpResult.results?.length > 0) {
    const block = formatInterpretationResultsBlock(interpResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (interpResult?.error) {
    errors.push({ source: "interpretations", marker: interpResult.error.marker });
  }

  if (ordResult && !ordResult.error && ordResult.results?.length > 0) {
    const block = formatOrdinanceResultsBlock(ordResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (ordResult?.error) {
    errors.push({ source: "ordinances", marker: ordResult.error.marker });
  }

  if (decisionResult && !decisionResult.error && decisionResult.results?.length > 0) {
    const block = formatDecisionResultsBlock(decisionResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
    if (decisionResult.domains) {
      for (const [name, info] of Object.entries(decisionResult.domains)) {
        if (info && info.ok === false && info.error) {
          errors.push({ source: `decisions.${name}`, marker: info.marker || LAW_ERROR_MARKERS.LAW_API_ERROR, error: info.error });
        }
      }
    }
  } else if (decisionResult?.error) {
    errors.push({ source: "decisions", marker: decisionResult.error.marker });
  }

  return {
    ok: citations.length > 0 || sections.length > 0,
    query,
    mode: "law_topic_search",
    intent,
    citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: disclaimerForLawMode("law_topic_search"),
    contextText: fitLawContext(sections.filter(Boolean).join("\n\n")),
    error: errors.length && citations.length === 0 ? LAW_ERROR_MARKERS.LAW_API_ERROR : "",
    errorDetails: errors,
    decisionDomains: decisionResult?.domains || null,
    warnings: Array.isArray(decisionResult?.warnings) ? decisionResult.warnings : [],
    latencyMs: Date.now() - startedAt
  };
}

async function buildDecisionSearchContext(prompt, intent, { signal, startedAt, client }) {
  const domain = getDecisionSearchDomain(prompt);
  const errors = [];
  const warnings = [];

  if (domain === "hunzae") {
    const dc = createDecisionsApiClient();
    if (!dc.isHunzaeConfigured()) {
      return {
        ok: false,
        query: String(prompt || "").trim(),
        mode: "law_topic_search",
        intent,
        citations: [],
        verification: { checked: false, failCount: 0, results: [] },
        disclaimer: disclaimerForLawMode("law_topic_search"),
        contextText: "",
        error: "DECISIONS_CONFIG_ERROR",
        errorMessage: "HUNZAE_API_KEY 및 HUNZAE_API_URL 환경변수가 서버에 설정되지 않았습니다.",
        errorDetails: [],
        latencyMs: Date.now() - startedAt
      };
    }
  } else if (domain === "all") {
    const dc = createDecisionsApiClient();
    if (!dc.isHunzaeConfigured()) {
      errors.push({
        source: "decisions.hunzae",
        marker: "DECISIONS_CONFIG_ERROR",
        error: "HUNZAE_API_KEY_OR_URL_NOT_CONFIGURED"
      });
      warnings.push("HUNZAE_API_KEY_NOT_CONFIGURED");
    }
  }

  const decisionSearch = await searchDecisionCandidates(prompt, { signal, client, domain });
  errors.push(...decisionSearch.errors);
  warnings.push(...decisionSearch.warnings);
  const selectedResult = decisionSearch.result;
  const selectedQuery = decisionSearch.query;

  if (!selectedResult) {
    return {
      ok: false,
      query: selectedQuery,
      mode: "law_topic_search",
      intent,
      citations: [],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: disclaimerForLawMode("law_topic_search"),
      contextText: "",
      error: errors.length ? LAW_ERROR_MARKERS.LAW_API_ERROR : LAW_ERROR_MARKERS.NOT_FOUND,
      errorDetails: errors,
      decisionDomains: decisionSearch.decisionDomains || null,
      warnings: uniqueStrings(warnings),
      latencyMs: Date.now() - startedAt
    };
  }

  const block = formatDecisionResultsBlock(selectedResult.results, 0);
  const decisionDomains = selectedResult.domains || decisionSearch.decisionDomains || null;
  return {
    ok: block.citations.length > 0,
    query: selectedQuery,
    mode: "law_topic_search",
    intent,
    citations: block.citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: disclaimerForLawMode("law_topic_search"),
    contextText: fitLawContext(block.text),
    error: "",
    errorDetails: errors,
    decisionDomains,
    warnings: uniqueStrings([
      ...warnings,
      ...(Array.isArray(selectedResult.warnings) ? selectedResult.warnings : [])
    ]),
    latencyMs: Date.now() - startedAt
  };
}

async function searchDecisionCandidates(prompt, { signal, client, domain = "all" } = {}) {
  const queries = buildDecisionSearchQueries(prompt);
  let selectedQuery = queries[0] || String(prompt || "").trim();
  const errors = [];
  const warnings = [];
  let decisionDomains = null;

  for (const query of queries) {
    const result = await searchDecisions({
      query,
      domain,
      subType: domain === "haengjim" ? "kor" : "all",
      display: 5
    }, { signal, client }).catch((error) => ({ error: toLawError(error) }));
    if (result?.error) {
      errors.push({ source: "decisions", query, marker: result.error.marker || LAW_ERROR_MARKERS.LAW_API_ERROR });
      continue;
    }
    if (result?.domains) {
      decisionDomains = result.domains;
      for (const [name, info] of Object.entries(result.domains)) {
        if (info && info.ok === false && info.error) {
          errors.push({ source: `decisions.${name}`, query, marker: info.marker || LAW_ERROR_MARKERS.LAW_API_ERROR, error: info.error });
        }
      }
    }
    if (Array.isArray(result?.warnings)) warnings.push(...result.warnings);
    if (Array.isArray(result?.results) && result.results.length > 0) {
      return { result, query, errors, warnings: uniqueStrings(warnings), decisionDomains };
    }
  }

  return { result: null, query: selectedQuery, errors, warnings: uniqueStrings(warnings), decisionDomains };
}

async function buildResearchContext(prompt, intent, { signal, startedAt, client }) {
  const extracted = intent.extracted || {};
  const baseQuery = extracted.query || prompt;
  const lawName = extracted.lawName || "";
  const article = extracted.article || "";

  const wantArticle = Boolean(lawName && article);
  const wantLawSources = Boolean(extracted.wantLawSources || wantArticle);
  const wantPrecedents = Boolean(extracted.wantPrecedents);
  const wantDecisions = Boolean(extracted.wantDecisions);
  const wantInterpretations = Boolean(extracted.wantInterpretations);
  const wantAdminRules = Boolean(extracted.wantAdminRules);
  const wantOrdinances = Boolean(extracted.wantOrdinances);

  const topicSearchQuery = buildLawTopicSearchQuery(baseQuery);
  const searchQuery = [lawName, article, topicSearchQuery].filter(Boolean).join(" ").trim() || baseQuery;
  const inferredRefs = wantLawSources && !wantArticle ? inferLawArticleRefsForTopic(baseQuery) : [];
  const inferredArticleTask = Promise.all(
    inferredRefs.map((ref) =>
      getArticleDetail(ref, { signal, client })
        .then((result) => ({ ok: true, ref, result }))
        .catch((error) => ({ ok: false, ref, error: toLawError(error) }))
    )
  );

  const tasks = [];
  tasks.push(wantArticle
    ? getArticleDetail({ lawName, article }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantLawSources
    ? searchAiLaw({ query: searchQuery, searchType: 0, display: 5 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantLawSources
    ? searchLaw({ query: searchQuery, display: 5 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantPrecedents
    ? searchPrecedentsForTopic(baseQuery, { display: 5, signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantInterpretations
    ? searchInterpretations({ query: searchQuery, display: 5 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantAdminRules
    ? searchAdminRules({ query: searchQuery, display: 5 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantOrdinances
    ? searchOrdinances({ query: searchQuery, display: 5 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    : Promise.resolve(null));
  tasks.push(wantDecisions
    ? searchDecisionCandidates(searchQuery, { signal, client, domain: getDecisionSearchDomain(prompt) })
    : Promise.resolve(null));

  const [inferredArticleResults, articleResult, aiLawResult, lawResult, precResult, expcResult, admResult, ordResult, decisionResult] = await Promise.all([
    inferredArticleTask,
    ...tasks
  ]);

  const sections = [];
  const citations = [];
  const errors = [];

  if (articleResult && !articleResult.error) {
    const cite = normalizeLawCitationForMeta(articleResult.citation, citations.length, articleResult.text);
    citations.push(cite);
    sections.push(formatLawContext([{ citation: cite, text: articleResult.text }]));
  } else if (articleResult?.error) {
    errors.push({ source: "article", marker: articleResult.error.marker });
  }

  for (const entry of inferredArticleResults) {
    if (entry.ok) {
      const cite = normalizeLawCitationForMeta(entry.result.citation, citations.length, entry.result.text);
      citations.push(cite);
      sections.push(formatLawContext([{ citation: cite, text: entry.result.text }]));
    } else {
      errors.push({ source: "inferred_article", marker: entry.error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR });
    }
  }

  if (aiLawResult && !aiLawResult.error) {
    const block = formatAiSearchResultsBlock("법령 조문 (AI 검색)", aiLawResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (aiLawResult?.error) {
    errors.push({ source: "ai_law", marker: aiLawResult.error.marker });
  }

  if (lawResult && !lawResult.error) {
    const block = formatSearchResultsBlock("법령 (이름 기준)", lawResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (lawResult?.error) {
    errors.push({ source: "law", marker: lawResult.error.marker });
  }

  if (precResult && !precResult.error) {
    const block = formatPrecedentResultsBlock(precResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (precResult?.error) {
    errors.push({ source: "precedents", marker: precResult.error.marker });
  }

  if (expcResult && !expcResult.error) {
    const block = formatInterpretationResultsBlock(expcResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (expcResult?.error) {
    errors.push({ source: "interpretations", marker: expcResult.error.marker });
  }

  if (admResult && !admResult.error) {
    const block = formatAdminRuleResultsBlock(admResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (admResult?.error) {
    errors.push({ source: "admin_rules", marker: admResult.error.marker });
  }

  if (ordResult && !ordResult.error) {
    const block = formatOrdinanceResultsBlock(ordResult.results, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (ordResult?.error) {
    errors.push({ source: "ordinances", marker: ordResult.error.marker });
  }

  if (Array.isArray(decisionResult?.errors) && decisionResult.errors.length) {
    errors.push(...decisionResult.errors);
  }
  const decisionItems = Array.isArray(decisionResult?.result?.results)
    ? decisionResult.result.results
    : Array.isArray(decisionResult?.results)
      ? decisionResult.results
      : [];
  if (decisionItems.length > 0) {
    const block = formatDecisionResultsBlock(decisionItems, citations.length);
    if (block.text) sections.push(block.text);
    citations.push(...block.citations);
  } else if (decisionResult?.error) {
    errors.push({ source: "decisions", marker: decisionResult.error.marker });
  }

  return {
    ok: citations.length > 0 || sections.length > 0,
    query: baseQuery,
    mode: "legal_research",
    intent,
    citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: disclaimerForLawMode("legal_research"),
    contextText: fitLawContext(sections.filter(Boolean).join("\n\n")),
    error: errors.length && citations.length === 0 ? LAW_ERROR_MARKERS.LAW_API_ERROR : "",
    errorDetails: errors,
    latencyMs: Date.now() - startedAt
  };
}

async function buildComplianceLawContext(prompt, intent, { signal, startedAt, client }) {
  const extracted = intent.extracted || {};
  const reviewType = extracted.reviewType || intent.reviewType || "general";
  const outputStyle = extracted.outputStyle || intent.outputStyle || "summary";
  const focusLawNames = Array.isArray(extracted.focusLawNames) ? extracted.focusLawNames : [];
  const type = getReviewType(reviewType);
  const explicitLawName = extracted.lawName || "";
  const explicitArticle = extracted.article || "";
  const hasExplicitArticle = Boolean(explicitLawName && explicitArticle);
  const lawNames = uniqueStrings([
    ...focusLawNames,
    ...type.suggestedLawNames,
    explicitLawName
  ]).slice(0, 4);
  const searchQuery = buildComplianceSearchQuery({
    userQuestion: prompt,
    reviewType,
    focusLawNames: lawNames
  });

  const sections = [
    [
      "[법령 적합성 검토 법령 검색 조건]",
      `Review type: ${type.label} (${reviewType})`,
      `Output style: ${outputStyle}`,
      `Focus laws: ${lawNames.join(", ") || "(none)"}`,
      "Use official legal evidence only when it appears in the evidence blocks below."
    ].join("\n")
  ];
  const citations = [];
  const errors = [];
  let officialEvidenceBlocks = 0;

  if (hasExplicitArticle) {
    const articleResult = await getArticleDetail(extracted, { signal, client }).catch((error) => ({ error: toLawError(error) }));
    if (articleResult && !articleResult.error) {
      const citation = normalizeLawCitationForMeta(articleResult.citation, citations.length, articleResult.text);
      citations.push(citation);
      sections.push(formatLawContext([{ citation, text: articleResult.text }]));
      officialEvidenceBlocks += 1;
    } else if (articleResult?.error) {
      errors.push({ source: "article", marker: articleResult.error.marker });
    }
  }

  if (!citations.length && lawNames.length) {
    const searchBlocks = [];
    for (const lawName of lawNames) {
      const result = await searchLaw({ query: lawName, display: 3 }, { signal, client }).catch((error) => ({ error: toLawError(error) }));
      if (result && !result.error) {
        const block = formatSearchContext(result);
        if (block) {
          searchBlocks.push(block);
          officialEvidenceBlocks += 1;
        }
      } else if (result?.error) {
        errors.push({ source: "search_law", marker: result.error.marker });
      }
    }
    if (searchBlocks.length) sections.push(...searchBlocks);
  }

  if (outputStyle === "detailed_report") {
    const researchQuery = lawNames.length ? `${lawNames.join(" ")} ${type.queryHints.join(" ")}` : searchQuery;
    const [precResult, expcResult, admResult, ordResult] = await Promise.all([
      searchPrecedentsForTopic(researchQuery, { display: 3, signal, client }).catch((error) => ({ error: toLawError(error) })),
      searchInterpretations({ query: researchQuery, display: 3 }, { signal, client }).catch((error) => ({ error: toLawError(error) })),
      searchAdminRules({ query: researchQuery, display: 3 }, { signal, client }).catch((error) => ({ error: toLawError(error) })),
      searchOrdinances({ query: researchQuery, display: 3 }, { signal, client }).catch((error) => ({ error: toLawError(error) }))
    ]);

    const blocks = [
      { result: precResult, source: "precedents", formatter: formatPrecedentResultsBlock },
      { result: expcResult, source: "interpretations", formatter: formatInterpretationResultsBlock },
      { result: admResult, source: "admin_rules", formatter: formatAdminRuleResultsBlock },
      { result: ordResult, source: "ordinances", formatter: formatOrdinanceResultsBlock }
    ];
    for (const entry of blocks) {
      if (entry.result && !entry.result.error) {
        const block = entry.formatter(entry.result.results, citations.length);
        if (block.text) {
          sections.push(block.text);
          officialEvidenceBlocks += 1;
        }
        citations.push(...block.citations);
      } else if (entry.result?.error) {
        errors.push({ source: entry.source, marker: entry.result.error.marker });
      }
    }
  }

  const hasLegalEvidence = citations.length > 0;
  if (!officialEvidenceBlocks && errors.some((item) => item.marker === LAW_ERROR_MARKERS.LAW_NOT_CONFIGURED)) {
    return {
      ok: false,
      query: searchQuery || prompt,
      mode: "department_legal_review",
      intent,
      citations: [],
      verification: { checked: false, failCount: 0, results: [] },
      disclaimer: disclaimerForLawMode("department_legal_review"),
      contextText: "",
      error: LAW_ERROR_MARKERS.LAW_NOT_CONFIGURED,
      errorDetails: errors,
      compliance: {
        ok: false,
        mode: "department_legal_review",
        reviewType,
        outputStyle,
        title: type.title,
        disclaimer: "short",
        evidenceFamilies: [],
        error: LAW_ERROR_MARKERS.LAW_NOT_CONFIGURED
      },
      latencyMs: Date.now() - startedAt
    };
  }
  sections.push(buildCompliancePromptBlock({ reviewType, outputStyle, hasLegalEvidence }));
  if (!hasLegalEvidence) {
    sections.push("[공식 조문 근거 부족]\n공식 조문 전문 또는 공식 법령 근거가 충분히 확인되지 않았습니다. 법령 적합성 판단은 보류하고, 내부 자료 요약과 추가 확인 필요 사항만 제시하세요.");
  }

  return {
    ok: sections.length > 1,
    query: searchQuery || prompt,
    mode: "department_legal_review",
    intent,
    citations,
    verification: { checked: false, failCount: 0, results: [] },
    disclaimer: disclaimerForLawMode("department_legal_review"),
    contextText: fitLawContext(sections.filter(Boolean).join("\n\n")),
    error: errors.length && !sections.length ? LAW_ERROR_MARKERS.LAW_API_ERROR : "",
    errorDetails: errors,
    compliance: {
      ok: true,
      mode: "department_legal_review",
      reviewType,
      outputStyle,
      title: type.title,
      disclaimer: "short",
      evidenceFamilies: buildEvidenceFamilies(citations),
      error: hasLegalEvidence ? "" : "NO_LEGAL_EVIDENCE"
    },
    latencyMs: Date.now() - startedAt
  };
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function isDecisionSearchPrompt(prompt) {
  return /(헌재|헌법재판소|결정례|결정문|행정심판\s*재결례|재결례)/u.test(String(prompt || ""));
}

function getDecisionSearchDomain(prompt) {
  const text = String(prompt || "");
  const wantsHunzae = /(헌재|헌법재판소|결정례|결정문)/u.test(text);
  const wantsHaengjim = /(행정심판|재결례)/u.test(text);
  if (wantsHunzae && !wantsHaengjim) return "hunzae";
  if (wantsHaengjim && !wantsHunzae) return "haengjim";
  return "all";
}

function buildDecisionSearchQueries(prompt) {
  const raw = String(prompt || "").replace(/\s+/g, " ").trim();
  const cleaned = raw
    .replace(/헌법재판소|헌재|결정례|결정문|판례요지|판례|행정심판|재결례/gu, " ")
    .replace(/관련|관한|대한|대해|사례|찾아줘|찾아|검색해줘|검색해|검색|조회해줘|조회|알려줘|보여줘|조사해줘|조사/gu, " ")
    .replace(/(?:^|\s)(?:중|중에서|중에|중의)(?=\s|$)/gu, " ")
    .replace(/\s+(?:을|를|이|가|은|는|의|에|에서|로|으로|와|과|도|만|에게|한테|부터|까지|보다|처럼|으로서|이란|란|이라는|라는|이라고|라고|이라면|라면|에서는|에서도|에서만|에게는|에게도|에서부터|로부터)(?=\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const simplified = cleaned
    .replace(/침해|위반|여부|사건|쟁점/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const headToken = (cleaned.split(/\s+/).filter((t) => t.length >= 2)[0]) || "";
  const candidates = [cleaned, simplified, headToken, raw]
    .map((item) => item.slice(0, 80))
    .filter((item) => item.length >= 2);
  return uniqueStrings(candidates);
}

function buildEvidenceFamilies(citations) {
  const families = new Set();
  for (const item of citations || []) {
    const type = item.recordType || item.sourceType;
    if (type === "precedent" || type === "law_precedent") families.add("precedent");
    else if (type === "interpretation" || type === "law_interpretation") families.add("interpretation");
    else if (type === "admin_rule" || type === "law_admin_rule") families.add("admin_rule");
    else if (type === "ordinance" || type === "law_ordinance") families.add("ordinance");
    else if (type?.startsWith("decision_")) families.add("decision");
    else families.add("law");
  }
  return Array.from(families);
}

function formatPrecedentResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 판례 검색 결과]",
    "These are official 판례 candidates. Cite individual rulings as [P*]. Quote only the 판시사항/판결요지 fields; do not invent reasoning."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `P${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_precedent",
      recordType: "precedent",
      title: item.title,
      caseNumber: item.caseNumber,
      court: item.court,
      date: item.date,
      caseType: item.caseType,
      locator: [item.caseNumber, item.court].filter(Boolean).join(" / "),
      url: item.precId ? `https://www.law.go.kr/precInfoP.do?precSeq=${encodeURIComponent(item.precId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n사건번호: ${item.caseNumber || "-"}\n선고법원: ${item.court || "-"}\n선고일: ${item.date || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatInterpretationResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 법령해석례 검색 결과]",
    "These are official 법령해석례 candidates. Cite individual interpretations as [I*] using the 안건명/회신기관/회신일자."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `I${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_interpretation",
      recordType: "interpretation",
      title: item.title,
      agency: item.agency,
      date: item.date,
      locator: [item.agency, item.date].filter(Boolean).join(" · "),
      url: item.expcId ? `https://www.law.go.kr/expcInfoP.do?expcSeq=${encodeURIComponent(item.expcId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n회신기관: ${item.agency || "-"}\n회신일: ${item.date || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatAdminRuleResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 행정규칙 검색 결과]",
    "These are official 행정규칙 (고시/예규/훈령/지침) candidates. Cite as [R*]."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `R${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_admin_rule",
      recordType: "admin_rule",
      title: item.title,
      agency: item.agency,
      kind: item.kind,
      issueDate: item.issueDate,
      effectiveDate: item.effectiveDate,
      locator: [item.agency, item.kind].filter(Boolean).join(" · "),
      url: item.admrulId ? `https://www.law.go.kr/admRulInfoP.do?admRulSeq=${encodeURIComponent(item.admrulId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n발령기관: ${item.agency || "-"} (${item.kind || "-"})\n시행일: ${item.effectiveDate || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatOrdinanceResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    "[공식 자치법규 검색 결과]",
    "These are official 자치법규 (조례/규칙) candidates. Cite as [O*]."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `O${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law_ordinance",
      recordType: "ordinance",
      title: item.title,
      region: item.region,
      kind: item.kind,
      effectiveDate: item.effectiveDate,
      locator: [item.region, item.kind].filter(Boolean).join(" · "),
      url: item.ordinId ? `https://www.law.go.kr/ordinInfoP.do?ordinSeq=${encodeURIComponent(item.ordinId)}` : ""
    });
    lines.push(`[${citationId}] ${item.title}\n지자체: ${item.region || "-"} (${item.kind || "-"})\n시행일: ${item.effectiveDate || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function fitLawContext(text) {
  const budget = getLawConfig().contextBudget;
  const value = String(text || "");
  if (value.length <= budget) return value;
  return `${value.slice(0, budget)}\n\n[Law context truncated to LAW_CONTEXT_BUDGET]`;
}

function formatSearchContext(result) {
  const items = Array.isArray(result?.results) ? result.results : [];
  if (!items.length) return "";
  const lines = [
    "[공식 법령 검색 결과]",
    `Query: ${result.query}`,
    "The official law database confirmed the following law-name records. " +
    "Use these records only for law identity, law type, MST/ID, and effective-date facts shown below. " +
    "Do not infer article text, duties, exceptions, precedents, interpretations, or policy recommendations from law names alone. " +
    "If a specific article or ruling is needed, ask for a narrower query or retrieve that official text first."
  ];
  items.forEach((item, index) => {
    lines.push(`[L-S${index + 1}] ${item.lawName}\nID: ${item.lawId || ""}\nMST: ${item.mst || ""}\nType: ${item.lawType || ""}\nEffective date: ${item.effectiveDate || ""}`);
  });
  return lines.join("\n\n");
}

// Builds a working law.go.kr Korean-address (한글주소) link for an aiSearch result.
// The article must be in 제N조 form (item.articleCanonical); the raw zero-padded
// 조문번호 (e.g. "0619") is NOT a valid 한글주소 and triggers law.go.kr's
// "해당 한글주소명을 찾을 수 없습니다" error. Admin-rule records use the 행정규칙
// prefix and link at the rule level, since article-level 한글주소 deep links are
// only reliable for 법령. Falls back to the law-level page when the article form
// is unavailable (e.g. 별표서식).
function buildAiSearchUrl(item, fallbackKind = "law") {
  const lawName = String(item?.lawName || "").trim();
  if (!lawName) return "";
  const kind = item?.recordKind || fallbackKind;
  const encodedName = encodeURIComponent(lawName);
  if (kind === "admin_rule") {
    return `https://www.law.go.kr/행정규칙/${encodedName}`;
  }
  if (item?.articleCanonical) {
    return `https://www.law.go.kr/법령/${encodedName}/${encodeURIComponent(item.articleCanonical)}`;
  }
  return `https://www.law.go.kr/법령/${encodedName}`;
}

function formatAiSearchResultsBlock(title = "AI 의미 검색", items = [], startIndex = 0, fallbackKind = "law") {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    `[${title}]`,
    "These results are based on semantic matching of your query against law article content. " +
    "Snippets below are official search excerpts and may be truncated; cite them only for facts visible in the excerpt and do not infer beyond the excerpt."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `AI-L${startIndex + index + 1}`;
    const articleLabel = item.articleCanonical || item.articleNo;
    citations.push({
      citationId,
      sourceType: "law_article",
      recordType: "law",
      lawName: item.lawName,
      articleNo: item.articleNo,
      articleTitle: item.articleTitle,
      snippet: item.snippet,
      effectiveDate: item.effectiveDate,
      url: buildAiSearchUrl(item, fallbackKind)
    });
    lines.push(`[${citationId}] ${item.lawName} ${articleLabel}\n${item.articleTitle || ""}\n${item.snippet}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatDecisionResultsBlock(items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const allHaengjim = list.every((item) => item.sourceType === "decision_haengjim" || item.subType === "haengjim");
  const anyHaengjim = list.some((item) => item.sourceType === "decision_haengjim" || item.subType === "haengjim");
  const lines = [
    allHaengjim ? "[공식 행정심판 재결례]" : anyHaengjim ? "[공식 결정례·재결례 검색 결과]" : "[헌법재판소 결정례]",
    "These are official decision or administrative appeal records. Cite them as [D*]. Use 사건번호, 결과, 날짜 facts only from the data below; do not invent reasoning."
  ];
  lines.push("For Korean Constitutional Court list records, Korean full text is unsupported here; use only list/outline evidence and do not quote full reasoning.");
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `D${startIndex + index + 1}`;
    const detailAvailable = getDecisionDetailAvailable(item);
    const detailKind = getDecisionDetailKind(item);
    const detailNotice = getDecisionDetailNotice(item);
    citations.push({
      citationId,
      sourceType: item.sourceType || "decision_hunzae_kor",
      recordType: "decision",
      title: item.title,
      caseNo: item.caseNo || item.id,
      result: item.result,
      date: item.date,
      institution: item.institution || "헌법재판소",
      locator: `${item.caseNo || item.id} (${item.date})`,
      summary: String(item.summary || "").slice(0, 300),
      url: item.url || "",
      detailAvailable,
      detailKind,
      detailNotice
    });
    const isHaengjim = item.sourceType === "decision_haengjim" || item.subType === "haengjim";
    const summary = item.summary ? `\n요지: ${item.summary.slice(0, 180)}` : "";
    lines.push(`[${citationId}] ${item.title}\n사건번호: ${item.caseNo || item.id || "-"}\n${isHaengjim ? "재결결과" : "결정결과"}: ${item.result || "-"}\n${isHaengjim ? "의결일" : "선고일"}: ${item.date || "-"}${summary}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatSearchResultsBlock(title = "법령 검색 결과", items = [], startIndex = 0) {
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!list.length) return { text: "", citations: [] };
  const lines = [
    `[${title}]`,
    "The following official law-name records match your query. Cite these records only for law identity, law type, and effective-date facts; do not infer article content or legal obligations from names alone."
  ];
  const citations = [];
  list.forEach((item, index) => {
    const citationId = `L-S${startIndex + index + 1}`;
    citations.push({
      citationId,
      sourceType: "law",
      recordType: "law",
      lawName: item.lawName,
      lawId: item.lawId,
      mst: item.mst,
      lawType: item.lawType,
      effectiveDate: item.effectiveDate,
      url: item.mst ? `https://www.law.go.kr/법령/${encodeURIComponent(item.lawName)}` : ""
    });
    lines.push(`[${citationId}] ${item.lawName}\nType: ${item.lawType || "-"}\nEffective date: ${item.effectiveDate || "-"}`);
  });
  return { text: lines.join("\n\n"), citations };
}

function formatVerificationContext(verification) {
  const results = Array.isArray(verification?.results) ? verification.results : [];
  if (!results.length) return "[공식 법령 인용 검증]\nNo recognizable Korean statute/article citations were found to verify.";
  const lines = [
    "[공식 법령 인용 검증]",
    "Use these verification results when discussing whether cited statute articles exist. Do not treat failed citations as real law."
  ];
  results.forEach((item, index) => {
    lines.push(`[V${index + 1}] ${item.citation} -> ${item.valid ? "valid" : "invalid"} (${item.reason})`);
  });
  return lines.join("\n");
}

function getDecisionDetailAvailable(item = {}) {
  if (typeof item.detailAvailable === "boolean") return item.detailAvailable;
  if (item.sourceType === "decision_hunzae_kor" || item.subType === "kor") return false;
  return true;
}

function getDecisionDetailKind(item = {}) {
  if (item.detailKind) return item.detailKind;
  if (item.sourceType === "decision_hunzae_kor" || item.subType === "kor") return "list_only";
  if (item.sourceType === "decision_hunzae_outline" || item.subType === "outline") return "outline";
  return "full_text";
}

function getDecisionDetailNotice(item = {}) {
  if (item.detailNotice) return item.detailNotice;
  if (item.sourceType === "decision_hunzae_kor" || item.subType === "kor") {
    return "Korean full text for Constitutional Court list records is not available from the configured detail API; use list or outline evidence only.";
  }
  return "";
}
