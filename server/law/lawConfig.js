import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

function boolEnv(name, fallback) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "no"].includes(value);
}

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function getLawConfig() {
  const apiKey = String(process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || "").trim();
  const cachePath = String(process.env.LAW_CACHE_PATH || "data/cache/law-cache.sqlite").trim();
  return {
    enabled: boolEnv("LAW_API_ENABLED", true),
    configured: Boolean(apiKey),
    apiKey,
    apiProvider: "law.go.kr",
    searchUrl: "https://www.law.go.kr/DRF/lawSearch.do",
    serviceUrl: "https://www.law.go.kr/DRF/lawService.do",
    userAgent: String(process.env.LAW_USER_AGENT || "Mozilla/5.0 (compatible; myAI Korean Law Engine)").trim(),
    timeoutMs: intEnv("LAW_TIMEOUT_MS", 8000, 500, 60000),
    maxResults: intEnv("LAW_MAX_RESULTS", 8, 1, 100),
    contextBudget: intEnv("LAW_CONTEXT_BUDGET", 10000, 1000, 50000),
    cache: {
      enabled: boolEnv("LAW_CACHE_ENABLED", true),
      ttlMs: intEnv("LAW_CACHE_TTL_MS", 86_400_000, 1000, 30 * 86_400_000),
      maxEntries: intEnv("LAW_CACHE_MAX_ENTRIES", 1000, 10, 100000),
      path: path.resolve(rootDir, cachePath)
    },
    autoDetect: boolEnv("LAW_AUTO_DETECT", false),
    verifyCitations: boolEnv("LAW_VERIFY_CITATIONS", true),
    impactMapEnabled: boolEnv("LAW_IMPACT_MAP_ENABLED", true),
    historyTarget: String(process.env.LAW_HISTORY_TARGET || "eflaw").trim()
  };
}

export function getDecisionsConfig() {
  const sharedKey = String(process.env.DECISIONS_API_KEY || "").trim();
  return {
    enabled: boolEnv("LAW_DECISIONS_ENABLED", true),
    hunzaeConfigured: Boolean(String(process.env.HUNZAE_API_KEY || sharedKey).trim()),
    hunzaeApiUrl: String(process.env.HUNZAE_API_URL || "").trim(),
    haengjimEnabled: true
  };
}

export function maskLawSecrets(value) {
  let text = String(value ?? "");
  const secrets = [
    process.env.LAW_OC,
    process.env.KOREAN_LAW_API_KEY,
    process.env.DECISIONS_API_KEY,
    process.env.HUNZAE_API_KEY,
    process.env.HAENGJIM_API_KEY
  ].map((item) => String(item || "").trim()).filter(Boolean);
  for (const secret of secrets) {
    text = text.split(secret).join("[REDACTED_LAW_OC]");
  }
  text = text.replace(/([?&]OC=)[^&\s"]+/gi, "$1[REDACTED_LAW_OC]");
  return text;
}

export function getLawRateLimitDefaults() {
  return {
    search: {
      max: intEnv("RATE_LIMIT_LAW_SEARCH_PER_MINUTE", 15, 1, 1000),
      windowMs: 60_000
    },
    article: {
      max: intEnv("RATE_LIMIT_LAW_ARTICLE_PER_MINUTE", 20, 1, 1000),
      windowMs: 60_000
    },
    verify: {
      max: intEnv("RATE_LIMIT_LAW_VERIFY_PER_MINUTE", 20, 1, 1000),
      windowMs: 60_000
    },
    research: {
      max: intEnv("RATE_LIMIT_LAW_RESEARCH_PER_MINUTE", 8, 1, 1000),
      windowMs: 60_000
    },
    impact: {
      max: intEnv("RATE_LIMIT_LAW_IMPACT_PER_MINUTE", 4, 1, 1000),
      windowMs: 60_000
    },
    timeTravel: {
      max: intEnv("RATE_LIMIT_LAW_TIME_TRAVEL_PER_MINUTE", 4, 1, 1000),
      windowMs: 60_000
    }
  };
}
