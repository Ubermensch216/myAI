import express from "express";
import { getLawConfig, getLawRateLimitDefaults } from "./lawConfig.js";
import { getLawCacheHealth, getLawCacheStats } from "./lawCache.js";
import { createLawApiClient } from "./lawApiClient.js";
import { lawErrorPayload, toLawError, assertLawAvailable } from "./lawErrors.js";
import { searchLaw } from "./tools/searchLaw.js";
import { getArticleDetail } from "./tools/articleDetail.js";
import { verifyLawCitations } from "./tools/verifyCitations.js";
import { createRateLimiter } from "../rateLimit.js";

export const lawApiRouter = express.Router();

const lawRateLimits = getLawRateLimitDefaults();

lawApiRouter.get("/status", async (_request, response) => {
  const config = getLawConfig();
  const cache = await getLawCacheHealth();
  const payload = {
    ok: config.enabled && config.configured,
    enabled: config.enabled,
    configured: config.configured,
    cache,
    api: { provider: config.apiProvider },
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

function sendLawError(response, error) {
  const lawError = toLawError(error);
  response.status(lawError.statusCode || 500).json(lawErrorPayload(lawError));
}
