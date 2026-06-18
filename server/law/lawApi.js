import express from "express";
import { getLawConfig, getLawRateLimitDefaults } from "./lawConfig.js";
import { getLawCacheHealth, getLawCacheStats } from "./lawCache.js";
import { createLawApiClient } from "./lawApiClient.js";
import { lawErrorPayload, toLawError, assertLawAvailable } from "./lawErrors.js";
import { buildActionPlanContext, buildForcedLawContext } from "./lawContextBuilder.js";
import { searchLaw } from "./tools/searchLaw.js";
import { searchAiLaw } from "./tools/searchAiLaw.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { getArticleAt } from "./tools/articleAt.js";
import { getArticleDiff } from "./tools/articleDiff.js";
import { getLawHistory } from "./tools/lawHistory.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
import { searchPrecedents, getPrecedentDetail } from "./tools/precedents.js";
import { searchInterpretations, getInterpretationDetail } from "./tools/interpretations.js";
import { searchAdminRules, getAdminRuleDetail } from "./tools/adminRules.js";
import { searchOrdinances, getOrdinanceDetail } from "./tools/ordinances.js";
import { searchAnnexes, getAnnexDetail } from "./tools/annexes.js";
import { buildImpactMap } from "./tools/impactMap.js";
import { runTimeTravel } from "./tools/timeTravel.js";
import { executeLawTool, listLawTools } from "./tools/toolRegistry.js";
import { getThreeTier, getDelegatedLaws, getLinkedOrdinances, getLinkedOrdinanceArticles, getLinkedLawsFromOrdinance } from "./tools/lawStructure.js";
import { searchDecisions, getDecisionText } from "./tools/decisions.js";
import { buildLawWorkbench, buildLawWorkbenchReport } from "./lawWorkbench.js";
import { runLawWorkbenchReview } from "./lawWorkbenchReview.js";
import { searchLawTerms } from "./lawTermKb.js";
import { getDecisionsConfig } from "./lawConfig.js";
import { createRateLimiter } from "../rateLimit.js";
import { createRequestAbortController } from "../abort.js";

export const lawApiRouter = express.Router();

const lawRateLimits = getLawRateLimitDefaults();

// Express 4의 `req.signal`은 요청 본문 소비 직후 조기 abort되어 비동기 법령 도구의
// 취소 신호로 쓸 수 없다(모든 도구가 "This operation was aborted"로 실패). 대신 요청
// 생명주기 동안만 유효하고 실제 클라이언트 단절에만 abort하는 신호를 주입한다.
lawApiRouter.use((request, response, next) => {
  const ac = createRequestAbortController(request, response);
  request.lifecycleSignal = ac.signal;
  response.once("close", ac.cleanup);
  response.once("finish", ac.cleanup);
  next();
});

lawApiRouter.get("/status", async (_request, response) => {
  const config = getLawConfig();
  const cache = sanitizeCacheHealth(await getLawCacheHealth());
  const payload = {
    ok: config.enabled && config.configured,
    enabled: config.enabled,
    configured: config.configured,
    cache,
    api: { provider: config.apiProvider },
    features: {
      actionPlan: true,
      impactMap: config.impactMapEnabled,
      timeTravel: true,
      topicResearch: true,
      toolRegistry: true
    },
    usage: {
      todayCalls: 0,
      todayErrors: getLawCacheStats().errors,
      lastError: null
    }
  };
  response.status(payload.ok ? 200 : 503).json(payload);
});

lawApiRouter.get("/tools", async (request, response) => {
  response.json({
    ok: true,
    tools: listLawTools({
      query: request.query?.q || request.query?.query,
      category: request.query?.category
    })
  });
});

lawApiRouter.get("/terms", async (request, response) => {
  response.json({
    ok: true,
    query: String(request.query?.q || request.query?.query || ""),
    terms: searchLawTerms(request.query?.q || request.query?.query || "", {
      limit: Number(request.query?.limit || 5)
    })
  });
});

lawApiRouter.post(
  "/execute",
  createRateLimiter({ name: "law_research", keyPrefix: "law_execute:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await executeLawTool({
        toolName: request.body?.toolName || request.body?.tool_name || request.body?.name,
        params: request.body?.params || request.body?.arguments || {}
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.status(result?.ok === false ? 400 : 200).json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/workbench",
  createRateLimiter({ name: "law_research", keyPrefix: "law_workbench:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      const body = request.body || {};
      if (!String(body.lawName || body.query || "").trim()) {
        return response.status(400).json({ ok: false, error: "lawName or query is required" });
      }
      assertLawAvailable(getLawConfig());
      const result = await buildLawWorkbench({
        query: body.query,
        lawName: body.lawName,
        article: body.article || body.jo,
        region: body.region,
        materialText: body.materialText,
        includeInternalImpact: body.includeInternalImpact
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/workbench/report",
  createRateLimiter({ name: "law_research", keyPrefix: "law_workbench_report:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      const result = buildLawWorkbenchReport({
        workbench: request.body?.workbench || request.body,
        reviewResult: request.body?.reviewResult,
        templateId: request.body?.templateId
      });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/workbench/review",
  createRateLimiter({ name: "law_research", keyPrefix: "law_workbench_review:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      const body = request.body || {};
      const query = String(body.query || body.prompt || body.workbench?.input?.query || "").trim();
      if (!query && !body.workbench) {
        return response.status(400).json({ ok: false, error: "query or workbench is required" });
      }
      const reviewResult = await runLawWorkbenchReview({
        query,
        conditions: body.conditions,
        workbench: body.workbench,
        documents: body.documents,
        model: body.model
      }, { signal: request.lifecycleSignal });
      response.json({ ok: true, reviewResult });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/search",
  createRateLimiter({ name: "law_search", keyPrefix: "law_search:", ...lawRateLimits.search }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchLaw({
        query: request.body?.query,
        display: request.body?.display
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/ai-search",
  createRateLimiter({ name: "law_search", keyPrefix: "law_ai_search:", ...lawRateLimits.search }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchAiLaw({
        query: request.body?.query,
        searchType: request.body?.searchType,
        display: request.body?.display
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/research",
  createRateLimiter({ name: "law_research", keyPrefix: "law_topic_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await buildForcedLawContext(String(request.body?.query || request.body?.prompt || ""), {
        client: createLawApiClient(),
        signal: request.lifecycleSignal
      });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/action-plan",
  createRateLimiter({ name: "law_research", keyPrefix: "law_action_plan:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await buildActionPlanContext({
        query: request.body?.query || request.body?.prompt,
        lawName: request.body?.lawName,
        article: request.body?.article || request.body?.jo
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/article",
  createRateLimiter({ name: "law_article", keyPrefix: "law_article:", ...lawRateLimits.article }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getArticleDetail({
        lawName: request.body?.lawName,
        lawId: request.body?.lawId,
        mst: request.body?.mst,
        article: request.body?.article,
        paragraph: request.body?.paragraph,
        item: request.body?.item,
        subitem: request.body?.subitem
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/time-travel",
  createRateLimiter({ name: "law_time_travel", keyPrefix: "law_time_travel:", ...lawRateLimits.timeTravel }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await runTimeTravel({
        query: request.body?.query,
        lawName: request.body?.lawName,
        article: request.body?.article || request.body?.jo,
        fromDate: request.body?.fromDate,
        toDate: request.body?.toDate
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/article/at",
  createRateLimiter({ name: "law_time_travel", keyPrefix: "law_time_travel:", ...lawRateLimits.timeTravel }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getArticleAt({
        lawName: request.body?.lawName,
        lawId: request.body?.lawId,
        mst: request.body?.mst,
        article: request.body?.article,
        paragraph: request.body?.paragraph,
        item: request.body?.item,
        subitem: request.body?.subitem,
        effectiveDate: request.body?.effectiveDate
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        effectiveDate: result.effectiveDateRequested,
        snapshotEffectiveDate: result.citation?.effectiveDate || "",
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/history",
  createRateLimiter({ name: "law_time_travel", keyPrefix: "law_time_travel:", ...lawRateLimits.timeTravel }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getLawHistory({
        lawName: request.body?.lawName,
        lawId: request.body?.lawId,
        mst: request.body?.mst
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: result.ok,
        lawName: result.lawName,
        lawId: result.lawId,
        mst: result.mst,
        revisions: result.revisions,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/article/diff",
  createRateLimiter({ name: "law_time_travel", keyPrefix: "law_time_travel:", ...lawRateLimits.timeTravel }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getArticleDiff({
        lawName: request.body?.lawName,
        article: request.body?.article,
        fromDate: request.body?.fromDate,
        toDate: request.body?.toDate
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/verify-citations",
  createRateLimiter({ name: "law_verify", keyPrefix: "law_verify:", ...lawRateLimits.verify }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await verifyLawCitations({ text: request.body?.text }, {
        client: createLawApiClient(),
        signal: request.lifecycleSignal
      });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/precedents/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchPrecedents({
        query: request.body?.query,
        display: request.body?.display,
        court: request.body?.court,
        caseType: request.body?.caseType
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/precedents/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getPrecedentDetail({
        precId: request.body?.precId,
        caseNumber: request.body?.caseNumber
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/interpretations/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchInterpretations({
        query: request.body?.query,
        display: request.body?.display,
        agency: request.body?.agency
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/interpretations/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getInterpretationDetail({
        expcId: request.body?.expcId,
        query: request.body?.query
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/admin-rules/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchAdminRules({
        query: request.body?.query,
        display: request.body?.display,
        agency: request.body?.agency
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/admin-rules/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getAdminRuleDetail({
        admrulId: request.body?.admrulId,
        query: request.body?.query
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/ordinances/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchOrdinances({
        query: request.body?.query,
        display: request.body?.display,
        region: request.body?.region
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/ordinances/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_research:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getOrdinanceDetail({
        ordinId: request.body?.ordinId,
        query: request.body?.query
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json({
        ok: true,
        citation: result.citation,
        text: result.text,
        cacheHit: Boolean(result.cacheHit)
      });
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/annexes/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_annexes_search:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchAnnexes({
        query: request.body?.query,
        lawName: request.body?.lawName,
        lawId: request.body?.lawId,
        mst: request.body?.mst,
        annexId: request.body?.annexId,
        annexNo: request.body?.annexNo,
        annexTitle: request.body?.annexTitle,
        formNo: request.body?.formNo,
        annexType: request.body?.annexType,
        display: request.body?.display
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/annexes/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_annexes_detail:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getAnnexDetail({
        mst: request.body?.mst,
        lawId: request.body?.lawId,
        lawName: request.body?.lawName,
        query: request.body?.query,
        annexId: request.body?.annexId,
        annexNo: request.body?.annexNo,
        annexTitle: request.body?.annexTitle,
        formNo: request.body?.formNo,
        annexType: request.body?.annexType
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/impact-map",
  createRateLimiter({ name: "law_impact", keyPrefix: "law_impact:", ...lawRateLimits.impact }),
  async (request, response) => {
    try {
      const config = getLawConfig();
      assertLawAvailable(config);
      if (!config.impactMapEnabled) {
        response.status(503).json({
          ok: false,
          error: "Korean Law impact map is disabled by LAW_IMPACT_MAP_ENABLED=false.",
          marker: "LAW_DISABLED"
        });
        return;
      }
      const result = await buildImpactMap({
        lawName: request.body?.lawName,
        article: request.body?.article,
        subject: request.body?.subject,
        materialText: request.body?.materialText
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/three-tier",
  createRateLimiter({ name: "law_research", keyPrefix: "law_three_tier:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getThreeTier({
        lawName: request.body?.lawName
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/delegated-laws",
  createRateLimiter({ name: "law_research", keyPrefix: "law_delegated:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getDelegatedLaws({
        lawName: request.body?.lawName,
        mst: request.body?.mst,
        lawId: request.body?.lawId
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/linked-ordinances",
  createRateLimiter({ name: "law_research", keyPrefix: "law_linked_ordin:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getLinkedOrdinances({
        lawName: request.body?.lawName,
        region: request.body?.region,
        display: request.body?.display
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/linked-ordinance-articles",
  createRateLimiter({ name: "law_research", keyPrefix: "law_ordin_articles:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getLinkedOrdinanceArticles({
        ordinId: request.body?.ordinId,
        lawName: request.body?.lawName,
        query: request.body?.query
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/linked-laws-from-ordinance",
  createRateLimiter({ name: "law_research", keyPrefix: "law_ordin_laws:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await getLinkedLawsFromOrdinance({
        ordinId: request.body?.ordinId,
        query: request.body?.query
      }, { client: createLawApiClient(), signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/decisions/search",
  createRateLimiter({ name: "law_research", keyPrefix: "law_decisions_search:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      const decisionsConfig = getDecisionsConfig();
      if (!decisionsConfig.enabled) {
        return response.status(503).json({ ok: false, error: "Decisions API disabled (LAW_DECISIONS_ENABLED=false)" });
      }
      const result = await searchDecisions({
        query: request.body?.query,
        domain: request.body?.domain,
        page: request.body?.page,
        display: request.body?.display,
        reqDate: request.body?.reqDate
      }, { signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

lawApiRouter.post(
  "/decisions/detail",
  createRateLimiter({ name: "law_research", keyPrefix: "law_decisions_detail:", ...lawRateLimits.research }),
  async (request, response) => {
    try {
      const decisionsConfig = getDecisionsConfig();
      if (!decisionsConfig.enabled) {
        return response.status(503).json({ ok: false, error: "Decisions API disabled (LAW_DECISIONS_ENABLED=false)" });
      }
      const result = await getDecisionText({
        id: request.body?.id || request.body?.caseNo,
        domain: request.body?.domain,
        sourceType: request.body?.sourceType,
        subType: request.body?.subType
      }, { signal: request.lifecycleSignal });
      response.json(result);
    } catch (error) {
      sendLawError(response, error);
    }
  }
);

function sendLawError(response, error) {
  const lawError = toLawError(error);
  response.status(lawError.statusCode || 500).json(lawErrorPayload(lawError));
}

function sanitizeCacheHealth(cache) {
  if (!cache || typeof cache !== "object") return cache;
  const { path: _path, ...publicCache } = cache;
  return publicCache;
}
