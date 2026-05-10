import fs from "node:fs";
import path from "node:path";
import { getLawConfig } from "./lawConfig.js";

let sqliteModulePromise = null;
let database = null;
const stats = {
  hits: 0,
  misses: 0,
  writes: 0,
  errors: 0
};

export async function getLawCacheHealth() {
  const config = getLawConfig();
  if (!config.cache.enabled) {
    return { enabled: false, storage: "none", hitRate: null };
  }
  if (!config.enabled || !config.configured) {
    return {
      enabled: config.cache.enabled,
      storage: "sqlite",
      path: config.cache.path,
      entries: null,
      hitRate: getHitRate()
    };
  }
  try {
    const db = await openDatabase();
    const row = db.prepare("SELECT COUNT(*) AS count FROM law_cache").get();
    return {
      enabled: true,
      storage: "sqlite",
      path: config.cache.path,
      entries: Number(row?.count || 0),
      hitRate: getHitRate()
    };
  } catch (error) {
    stats.errors += 1;
    return {
      enabled: true,
      storage: "sqlite",
      path: config.cache.path,
      hitRate: getHitRate(),
      error: error.message
    };
  }
}

export async function getCachedLawResponse(key, { ttlMs, lastModified } = {}) {
  const config = getLawConfig();
  if (!config.cache.enabled || !key) return null;
  try {
    const db = await openDatabase();
    const row = db.prepare("SELECT payload, createdAt, expiresAt, lastModified FROM law_cache WHERE key = ?").get(key);
    if (!row) {
      stats.misses += 1;
      return null;
    }
    const now = Date.now();
    const expiresAt = Number(row.expiresAt || 0);
    if (expiresAt && expiresAt <= now) {
      db.prepare("DELETE FROM law_cache WHERE key = ?").run(key);
      stats.misses += 1;
      return null;
    }
    if (ttlMs && Number(row.createdAt || 0) + ttlMs <= now) {
      db.prepare("DELETE FROM law_cache WHERE key = ?").run(key);
      stats.misses += 1;
      return null;
    }
    if (lastModified && row.lastModified && String(row.lastModified) !== String(lastModified)) {
      db.prepare("DELETE FROM law_cache WHERE key = ?").run(key);
      stats.misses += 1;
      return null;
    }
    stats.hits += 1;
    return JSON.parse(row.payload);
  } catch (error) {
    stats.errors += 1;
    return null;
  }
}

export async function setCachedLawResponse(key, payload, { ttlMs, lastModified } = {}) {
  const config = getLawConfig();
  if (!config.cache.enabled || !key) return;
  try {
    const db = await openDatabase();
    const now = Date.now();
    const effectiveTtl = Number(ttlMs || config.cache.ttlMs);
    db.prepare(`
      INSERT INTO law_cache (key, payload, createdAt, expiresAt, lastModified)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        payload = excluded.payload,
        createdAt = excluded.createdAt,
        expiresAt = excluded.expiresAt,
        lastModified = excluded.lastModified
    `).run(key, JSON.stringify(payload), now, now + effectiveTtl, String(lastModified || ""));
    stats.writes += 1;
    pruneCache(db, config.cache.maxEntries);
  } catch {
    stats.errors += 1;
  }
}

export function buildLawCacheKey(toolName, normalizedInput, effectiveDate = "") {
  return [
    String(toolName || "").trim().toLowerCase(),
    stableStringify(normalizedInput),
    String(effectiveDate || "").trim()
  ].join("|");
}

export function getLawCacheStats() {
  return {
    ...stats,
    hitRate: getHitRate()
  };
}

async function openDatabase() {
  if (database) return database;
  const config = getLawConfig();
  fs.mkdirSync(path.dirname(config.cache.path), { recursive: true });
  const { DatabaseSync } = await loadSqliteModule();
  database = new DatabaseSync(config.cache.path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS law_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      lastModified TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_law_cache_expires ON law_cache(expiresAt);
  `);
  return database;
}

function loadSqliteModule() {
  sqliteModulePromise ||= import("node:sqlite");
  return sqliteModulePromise;
}

function pruneCache(db, maxEntries) {
  const limit = Math.max(10, Number(maxEntries || 1000));
  db.prepare("DELETE FROM law_cache WHERE expiresAt <= ?").run(Date.now());
  const row = db.prepare("SELECT COUNT(*) AS count FROM law_cache").get();
  const excess = Number(row?.count || 0) - limit;
  if (excess <= 0) return;
  db.prepare(`
    DELETE FROM law_cache
    WHERE key IN (
      SELECT key FROM law_cache ORDER BY createdAt ASC LIMIT ?
    )
  `).run(excess);
}

function getHitRate() {
  const total = stats.hits + stats.misses;
  return total ? stats.hits / total : 0;
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") return String(value ?? "");
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
