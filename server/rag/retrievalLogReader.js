import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const LOGS_DIR = path.join(rootDir, "data", "logs");

function dayFile(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `retrieval-${y}-${m}-${d}.jsonl`);
}

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Aggregate retrieval-log entries from the last `days` UTC days.
 * Returns counts, fallback rate, top fallback reasons, average timing.
 *
 * @param {{ days?: number, profile?: string, notebookId?: string }} options
 */
export async function summarizeRetrievalLog({ days = 7, profile, notebookId } = {}) {
  const today = new Date();
  const records = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const entries = await readJsonl(dayFile(d));
    records.push(...entries);
  }

  const filtered = records.filter((r) => {
    if (profile && r.profile !== profile) return false;
    if (notebookId && r.notebookId !== notebookId) return false;
    return true;
  });

  const total = filtered.length;
  if (!total) {
    return {
      days,
      profile: profile || null,
      notebookId: notebookId || null,
      total: 0,
      fallbackLoadedAllChunksRate: 0,
      noEvidenceRate: 0,
      rerankAppliedRate: 0,
      avgTimingMs: {},
      topFallbackReasons: []
    };
  }

  let fallbackCount = 0;
  let noEvidenceCount = 0;
  let rerankAppliedCount = 0;
  const timingSum = {};
  const timingN = {};
  const fallbackCounts = new Map();

  for (const r of filtered) {
    if (r.corpus?.fallbackLoadedAllChunks || r.fallbackLoadedAllChunks) fallbackCount++;
    if (Array.isArray(r.selected) && r.selected.length === 0) noEvidenceCount++;
    if (r.rerank?.applied) rerankAppliedCount++;
    if (r.fallback || r.fallbackReason) {
      const key = r.fallback || r.fallbackReason;
      fallbackCounts.set(key, (fallbackCounts.get(key) || 0) + 1);
    }
    for (const [k, v] of Object.entries(r.timing || {})) {
      if (typeof v !== "number") continue;
      timingSum[k] = (timingSum[k] || 0) + v;
      timingN[k] = (timingN[k] || 0) + 1;
    }
  }

  const avgTimingMs = {};
  for (const k of Object.keys(timingSum)) {
    avgTimingMs[k] = timingSum[k] / timingN[k];
  }

  const topFallbackReasons = [...fallbackCounts.entries()]
    .map(([reason, count]) => ({ reason, count, rate: count / total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    days,
    profile: profile || null,
    notebookId: notebookId || null,
    total,
    fallbackLoadedAllChunksRate: fallbackCount / total,
    noEvidenceRate: noEvidenceCount / total,
    rerankAppliedRate: rerankAppliedCount / total,
    avgTimingMs,
    topFallbackReasons
  };
}
