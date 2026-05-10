import express from "express";
import { getLawConfig, getLawRateLimitDefaults } from "./lawConfig.js";
import { getLawCacheHealth, getLawCacheStats } from "./lawCache.js";
import { createLawApiClient } from "./lawApiClient.js";
import { lawErrorPayload, toLawError, assertLawAvailable } from "./lawErrors.js";
import { searchLaw } from "./tools/searchLaw.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
import { searchPrecedents, getPrecedentDetail } from "./tools/precedents.js";
import { searchInterpretations, getInterpretationDetail } from "./tools/interpretations.js";
import { searchAdminRules, getAdminRuleDetail } from "./tools/adminRules.js";
import { searchOrdinances, getOrdinanceDetail } from "./tools/ordinances.js";
import { buildImpactMap } from "./tools/impactMap.js";
import { createRateLimiter } from "../rateLimit.js";

export const lawApiRouter = express.Router();

const lawRateLimits = getLawRateLimitDefaults();

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
      impactMap: config.impactMapEnabled
    },
    usage: {
      todayCalls: 0,
      todayErrors: getLawCacheStats().errors,
      lastError: null
    }
  };
  response.status(payload.ok ? 200 : 503).json(payload);
});

lawApiRouter.post(
  "/search",
  createRateLimiter({ name: "law_search", keyPrefix: "law_search:", ...lawRateLimits.search }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await searchLaw({
        query: request.body?.query,
        display: request.body?.display
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
  "/verify-citations",
  createRateLimiter({ name: "law_verify", keyPrefix: "law_verify:", ...lawRateLimits.verify }),
  async (request, response) => {
    try {
      assertLawAvailable(getLawConfig());
      const result = await verifyLawCitations({ text: request.body?.text }, {
        client: createLawApiClient(),
        signal: request.signal
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
      }, { client: createLawApiClient(), signal: request.signal });
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
