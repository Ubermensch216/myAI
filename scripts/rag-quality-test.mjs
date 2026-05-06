/**
 * RAG quality evaluation — Recall@K and MRR@K against a golden fixture.
 *
 * Usage:
 *   node scripts/rag-quality-test.mjs [options]
 *
 * Options:
 *   --fixture PATH          Golden fixture file (default: fixtures/rag/department-golden.json)
 *   --notebook NOTEBOOK_ID  Evaluate only suites for this notebook
 *   --suite SUITE_ID        Evaluate only this suite
 *   --k N                   Evaluation cutoff (default: 10)
 *   --compare-rerank        Run each query twice (without/with reranker) and report delta
 *   --json                  Emit raw JSON instead of human-readable output
 *
 * Requires the same environment as the running server (.env must be loaded,
 * Ollama must be reachable for embedding + query expansion).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchNotebook } from "../server/rag/departmentRag.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURE = path.join(rootDir, "fixtures", "rag", "department-golden.json");
const DEFAULT_K = 10;

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let fixturePath = DEFAULT_FIXTURE;
let filterNotebook = "";
let filterSuite = "";
let topK = DEFAULT_K;
let compareRerank = false;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--fixture" && args[i + 1]) { fixturePath = args[++i]; }
  else if (arg === "--notebook" && args[i + 1]) { filterNotebook = args[++i]; }
  else if (arg === "--suite" && args[i + 1]) { filterSuite = args[++i]; }
  else if (arg === "--k" && args[i + 1]) { topK = Math.max(1, parseInt(args[++i], 10) || DEFAULT_K); }
  else if (arg === "--compare-rerank") { compareRerank = true; }
  else if (arg === "--json") { jsonOutput = true; }
}

// ── Load fixture ─────────────────────────────────────────────────────────────

let fixture;
try {
  fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
} catch (err) {
  console.error(`Cannot read fixture: ${fixturePath}\n${err.message}`);
  process.exit(1);
}

const suites = (fixture.suites || []).filter((s) => {
  if (s.skip) return false;
  if (filterSuite && s.id !== filterSuite) return false;
  if (filterNotebook && s.notebookId !== filterNotebook) return false;
  return true;
});

if (!suites.length) {
  console.error(
    "No suites to evaluate.\n" +
    "  • Check --notebook / --suite filter arguments.\n" +
    "  • Make sure suites in the fixture have 'skip: false' (or no skip field).\n" +
    `  • Fixture: ${fixturePath}`
  );
  process.exit(1);
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function relevantKeys(tc) {
  if (tc.relevantChunkKeys?.length) return new Set(tc.relevantChunkKeys);
  return new Set(tc.relevantDocIds || []);
}

function isHit(citation, tc) {
  if (tc.relevantChunkKeys?.length) {
    return tc.relevantChunkKeys.includes(`${citation.documentId}:${citation.chunkIndex}`);
  }
  return (tc.relevantDocIds || []).includes(citation.documentId);
}

function computeMetrics(chunks, tc, k) {
  const topChunks = chunks.slice(0, k);
  const relevant = relevantKeys(tc);

  let hitCount = 0;
  let rr = 0;

  for (let i = 0; i < topChunks.length; i++) {
    const c = topChunks[i];
    const key = tc.relevantChunkKeys?.length ? `${c.documentId}:${c.chunkIndex}` : c.documentId;
    if (relevant.has(key)) {
      hitCount++;
      if (rr === 0) rr = 1 / (i + 1);
    }
  }

  const recall = relevant.size > 0 ? hitCount / relevant.size : 0;
  return { recall, rr, hitCount, relevantCount: relevant.size };
}

function aggregateMetrics(caseResults, key) {
  const valid = caseResults.filter((c) => !c.error && c[key]);
  if (!valid.length) return null;
  const recall = valid.reduce((sum, c) => sum + c[key].recall, 0) / valid.length;
  const mrr = valid.reduce((sum, c) => sum + c[key].rr, 0) / valid.length;
  return { recall, mrr, n: valid.length };
}

// ── Run evaluation ────────────────────────────────────────────────────────────

const origRerankEnabled = process.env.RAG_RERANK_ENABLED;
const allSuiteResults = [];
let totalQueries = 0;
let failedQueries = 0;

for (const suite of suites) {
  const suiteResult = {
    suiteId: suite.id,
    notebookId: suite.notebookId,
    description: suite.description || "",
    cases: []
  };

  for (const tc of suite.cases || []) {
    totalQueries++;
    const caseResult = { id: tc.id, query: tc.query };

    // ── Base pass (reranker disabled when comparing, otherwise from env) ────
    if (compareRerank) process.env.RAG_RERANK_ENABLED = "false";

    try {
      const result = await searchNotebook(suite.notebookId, tc.query);
      if (!result.ok) {
        caseResult.error = result.reason || "search_failed";
        failedQueries++;
        suiteResult.cases.push(caseResult);
        continue;
      }
      caseResult.base = { ...computeMetrics(result.chunks, tc, topK), chunks: result.chunks.length };
    } catch (err) {
      caseResult.error = err.message;
      failedQueries++;
      suiteResult.cases.push(caseResult);
      continue;
    }

    // ── Rerank pass ────────────────────────────────────────────────────────
    if (compareRerank) {
      process.env.RAG_RERANK_ENABLED = "true";
      try {
        const rerankResult = await searchNotebook(suite.notebookId, tc.query);
        if (rerankResult.ok) {
          caseResult.rerank = { ...computeMetrics(rerankResult.chunks, tc, topK), chunks: rerankResult.chunks.length };
          caseResult.recallDelta = caseResult.rerank.recall - caseResult.base.recall;
          caseResult.mrrDelta = caseResult.rerank.rr - caseResult.base.rr;
        }
      } catch (err) {
        caseResult.rerankError = err.message;
      }
    }

    suiteResult.cases.push(caseResult);
  }

  allSuiteResults.push(suiteResult);
}

if (compareRerank) process.env.RAG_RERANK_ENABLED = origRerankEnabled;

// ── Summary ───────────────────────────────────────────────────────────────────

const allCases = allSuiteResults.flatMap((s) => s.cases);
const summary = {
  fixture: fixturePath,
  k: topK,
  totalQueries,
  failedQueries,
  base: aggregateMetrics(allCases, "base"),
  ...(compareRerank ? { rerank: aggregateMetrics(allCases, "rerank") } : {})
};

if (compareRerank && summary.base && summary.rerank) {
  summary.recallImprovement = summary.rerank.recall - summary.base.recall;
  summary.mrrImprovement = summary.rerank.mrr - summary.base.mrr;
}

// ── Output ────────────────────────────────────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify({ summary, suites: allSuiteResults }, null, 2));
} else {
  const fmt = (v) => (typeof v === "number" ? v.toFixed(4) : "—");
  const delta = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(4)}` : "—");

  console.log(`\n=== RAG Quality — Recall@${topK} / MRR@${topK} ===`);
  console.log(`Fixture : ${fixturePath}`);
  console.log(`Queries : ${totalQueries}${failedQueries ? `  (${failedQueries} failed)` : ""}\n`);

  for (const suite of allSuiteResults) {
    console.log(`Suite: ${suite.suiteId}  [${suite.notebookId}]`);
    if (suite.description) console.log(`       ${suite.description}`);

    for (const c of suite.cases) {
      const q = c.query.slice(0, 52).padEnd(52);
      if (c.error) {
        console.log(`  [FAIL] ${q} — ${c.error}`);
        continue;
      }
      if (compareRerank && c.rerank) {
        console.log(
          `  [${c.id}] ${q}` +
          `  R@${topK}: ${fmt(c.base.recall)} → ${fmt(c.rerank.recall)} (${delta(c.recallDelta)})` +
          `  MRR: ${fmt(c.base.rr)} → ${fmt(c.rerank.rr)} (${delta(c.mrrDelta)})`
        );
      } else {
        console.log(
          `  [${c.id}] ${q}` +
          `  R@${topK}: ${fmt(c.base.recall)}` +
          `  MRR: ${fmt(c.base.rr)}` +
          `  hits: ${c.base.hitCount}/${c.base.relevantCount}`
        );
      }
    }

    // Per-suite aggregate (only when multiple cases)
    const validCases = suite.cases.filter((c) => !c.error && c.base);
    if (validCases.length > 1) {
      const sBase = aggregateMetrics(validCases, "base");
      const sRerank = compareRerank ? aggregateMetrics(validCases, "rerank") : null;
      if (sRerank) {
        console.log(
          `  ── avg  R@${topK}: ${fmt(sBase.recall)} → ${fmt(sRerank.recall)} (${delta(sRerank.recall - sBase.recall)})` +
          `  MRR: ${fmt(sBase.mrr)} → ${fmt(sRerank.mrr)} (${delta(sRerank.mrr - sBase.mrr)})`
        );
      } else {
        console.log(`  ── avg  R@${topK}: ${fmt(sBase.recall)}  MRR: ${fmt(sBase.mrr)}`);
      }
    }
    console.log();
  }

  if (summary.base) {
    console.log("=== Overall ===");
    if (compareRerank && summary.rerank) {
      console.log(`  Recall@${topK} (no-rerank): ${fmt(summary.base.recall)}`);
      console.log(`  Recall@${topK} (reranked) : ${fmt(summary.rerank.recall)}  (${delta(summary.recallImprovement)})`);
      console.log(`  MRR@${topK}    (no-rerank): ${fmt(summary.base.mrr)}`);
      console.log(`  MRR@${topK}    (reranked) : ${fmt(summary.rerank.mrr)}  (${delta(summary.mrrImprovement)})`);
    } else {
      console.log(`  Recall@${topK}: ${fmt(summary.base.recall)}`);
      console.log(`  MRR@${topK}:    ${fmt(summary.base.mrr)}`);
    }
    console.log();
  }
}

process.exitCode = failedQueries > 0 ? 1 : 0;
