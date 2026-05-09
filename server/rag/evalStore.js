import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");

const EVAL_DIR = path.join(rootDir, "data", "rag-eval");
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const GOLDEN_FILE = path.join(EVAL_DIR, "golden.json");
const FIXTURE_GOLDEN = path.join(rootDir, "fixtures", "rag", "department-golden.json");

async function ensureDirs() {
  await fs.mkdir(RUNS_DIR, { recursive: true });
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function getGoldenSet() {
  await ensureDirs();
  if (!(await fileExists(GOLDEN_FILE))) {
    const fixture = await fs.readFile(FIXTURE_GOLDEN, "utf8");
    await fs.writeFile(GOLDEN_FILE, fixture, "utf8");
  }
  return JSON.parse(await fs.readFile(GOLDEN_FILE, "utf8"));
}

export async function saveGoldenSet(data) {
  await ensureDirs();
  await fs.writeFile(GOLDEN_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function upsertGoldenCase(suiteId, caseEntry) {
  const golden = await getGoldenSet();
  const suite = (golden.suites || []).find((s) => s.id === suiteId);
  if (!suite) throw new Error(`suite_not_found:${suiteId}`);
  if (!Array.isArray(suite.cases)) suite.cases = [];
  if (!caseEntry?.id) throw new Error("case_id_required");
  const idx = suite.cases.findIndex((c) => c.id === caseEntry.id);
  if (idx >= 0) suite.cases[idx] = caseEntry;
  else suite.cases.push(caseEntry);
  await saveGoldenSet(golden);
  return { suiteId, caseId: caseEntry.id, inserted: idx < 0 };
}

export async function deleteGoldenCase(suiteId, caseId) {
  const golden = await getGoldenSet();
  const suite = (golden.suites || []).find((s) => s.id === suiteId);
  if (!suite || !Array.isArray(suite.cases)) return { removed: false };
  const before = suite.cases.length;
  suite.cases = suite.cases.filter((c) => c.id !== caseId);
  const removed = suite.cases.length < before;
  if (removed) await saveGoldenSet(golden);
  return { removed };
}

export async function saveRun(runId, payload) {
  await ensureDirs();
  const file = path.join(RUNS_DIR, `${runId}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

export async function getRun(runId) {
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!(await fileExists(file))) return null;
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function listRuns({ limit = 50 } = {}) {
  await ensureDirs();
  const files = (await fs.readdir(RUNS_DIR)).filter((f) => f.endsWith(".json"));
  const summaries = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(RUNS_DIR, f), "utf8"));
      summaries.push({
        runId: data.runId || path.basename(f, ".json"),
        startedAt: data.startedAt || null,
        finishedAt: data.finishedAt || null,
        mode: data.mode || null,
        k: data.k ?? null,
        variants: (data.variants || []).map((v) => v.label || ""),
        totalQueries: data.totalQueries ?? null,
        failedQueries: data.failedQueries ?? null,
        summary: data.summary || null
      });
    } catch {
      // skip malformed
    }
  }
  summaries.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  return summaries.slice(0, limit);
}

export async function deleteRun(runId) {
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!(await fileExists(file))) return { removed: false };
  await fs.unlink(file);
  return { removed: true };
}

export const evalPaths = { EVAL_DIR, RUNS_DIR, GOLDEN_FILE, FIXTURE_GOLDEN };
