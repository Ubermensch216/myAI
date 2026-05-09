/**
 * RAG quality evaluation — Recall@K, MRR@K, Precision@K against a golden fixture.
 *
 * Usage:
 *   node scripts/rag-quality-test.mjs [options]
 *
 * Options:
 *   --fixture PATH          Golden fixture file (default: fixtures/rag/department-golden.json)
 *   --notebook NOTEBOOK_ID  Evaluate only suites for this notebook
 *   --suite SUITE_ID        Evaluate only this suite
 *   --quick                 Evaluate only cases marked with "quick": true
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
import { runEvaluation } from "../server/rag/evalRunner.js";

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
let quickMode = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--fixture" && args[i + 1]) { fixturePath = args[++i]; }
  else if (arg === "--notebook" && args[i + 1]) { filterNotebook = args[++i]; }
  else if (arg === "--suite" && args[i + 1]) { filterSuite = args[++i]; }
  else if (arg === "--quick") { quickMode = true; }
  else if (arg === "--k" && args[i + 1]) { topK = Math.max(1, parseInt(args[++i], 10) || DEFAULT_K); }
  else if (arg === "--compare-rerank") { compareRerank = true; }
  else if (arg === "--json") { jsonOutput = true; }
}

// ── Load fixture ─────────────────────────────────────────────────────────────

let golden;
try {
  golden = JSON.parse(await fs.readFile(fixturePath, "utf8"));
} catch (err) {
  console.error(`Cannot read fixture: ${fixturePath}\n${err.message}`);
  process.exit(1);
}

const variants = compareRerank
  ? [{ label: "base", rerank: false }, { label: "rerank", rerank: true }]
  : [{ label: "base" }];

let run;
try {
  run = await runEvaluation({
    golden,
    filter: { notebookId: filterNotebook || undefined, suiteId: filterSuite || undefined, quick: quickMode },
    k: topK,
    variants
  });
} catch (err) {
  if (err.message === "invalid_golden_set" || /no_suites/.test(err.message)) {
    const quickHint = quickMode
      ? "  No cases matched --quick. Mark selected fixture cases with \"quick\": true.\n"
      : "";
    console.error(
      "No suites to evaluate.\n" +
      "  Check --notebook / --suite filter arguments.\n" +
      quickHint +
      "  Make sure suites in the fixture have 'skip: false' (or no skip field).\n" +
      `  Fixture: ${fixturePath}`
    );
    process.exit(1);
  }
  throw err;
}

if (run.totalQueries === 0) {
  const quickHint = quickMode
    ? "  No cases matched --quick. Mark selected fixture cases with \"quick\": true.\n"
    : "";
  console.error(
    "No suites to evaluate.\n" +
    "  Check --notebook / --suite filter arguments.\n" +
    quickHint +
    "  Make sure suites in the fixture have 'skip: false' (or no skip field).\n" +
    `  Fixture: ${fixturePath}`
  );
  process.exit(1);
}

// ── Output ────────────────────────────────────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify({ fixture: fixturePath, ...run }, null, 2));
} else {
  const fmt = (v) => (typeof v === "number" ? v.toFixed(4) : "—");
  const delta = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(4)}` : "—");

  console.log(`\n=== RAG Quality — Recall@${topK} / MRR@${topK} ===`);
  console.log(`Fixture : ${fixturePath}`);
  console.log(`Mode    : ${run.mode}`);
  console.log(`Queries : ${run.totalQueries}${run.failedQueries ? `  (${run.failedQueries} failed)` : ""}\n`);

  for (const suite of run.suites) {
    console.log(`Suite: ${suite.suiteId}  [${suite.notebookId}]`);
    if (suite.description) console.log(`       ${suite.description}`);

    for (const c of suite.cases) {
      const q = c.query.slice(0, 52).padEnd(52);
      const base = c.variants.base;
      const rerank = c.variants.rerank;

      if (base?.error) {
        console.log(`  [FAIL] ${q} — ${base.error}`);
        continue;
      }
      if (compareRerank && rerank?.metrics && base?.metrics) {
        const recallDelta = rerank.metrics.recall - base.metrics.recall;
        const mrrDelta = rerank.metrics.rr - base.metrics.rr;
        console.log(
          `  [${c.id}] ${q}` +
          `  R@${topK}: ${fmt(base.metrics.recall)} → ${fmt(rerank.metrics.recall)} (${delta(recallDelta)})` +
          `  MRR: ${fmt(base.metrics.rr)} → ${fmt(rerank.metrics.rr)} (${delta(mrrDelta)})`
        );
      } else if (base?.metrics) {
        console.log(
          `  [${c.id}] ${q}` +
          `  R@${topK}: ${fmt(base.metrics.recall)}` +
          `  MRR: ${fmt(base.metrics.rr)}` +
          `  hits: ${base.metrics.hitCount}/${base.metrics.relevantCount}`
        );
      }
    }

    const validCases = suite.cases.filter((c) => c.variants.base?.metrics);
    if (validCases.length > 1) {
      const avg = (key) => validCases.reduce((s, c) => s + c.variants.base.metrics[key], 0) / validCases.length;
      const avgRerank = (key) => validCases
        .filter((c) => c.variants.rerank?.metrics)
        .reduce((s, c, _, arr) => s + c.variants.rerank.metrics[key] / arr.length, 0);

      if (compareRerank) {
        const baseRecall = avg("recall");
        const baseMrr = avg("rr");
        const rkRecall = avgRerank("recall");
        const rkMrr = avgRerank("rr");
        console.log(
          `  ── avg  R@${topK}: ${fmt(baseRecall)} → ${fmt(rkRecall)} (${delta(rkRecall - baseRecall)})` +
          `  MRR: ${fmt(baseMrr)} → ${fmt(rkMrr)} (${delta(rkMrr - baseMrr)})`
        );
      } else {
        console.log(`  ── avg  R@${topK}: ${fmt(avg("recall"))}  MRR: ${fmt(avg("rr"))}`);
      }
    }
    console.log();
  }

  const baseSummary = run.summary.base;
  const rerankSummary = run.summary.rerank;
  if (baseSummary) {
    console.log("=== Overall ===");
    if (compareRerank && rerankSummary) {
      console.log(`  Recall@${topK} (no-rerank): ${fmt(baseSummary.recall)}`);
      console.log(`  Recall@${topK} (reranked) : ${fmt(rerankSummary.recall)}  (${delta(rerankSummary.recall - baseSummary.recall)})`);
      console.log(`  MRR@${topK}    (no-rerank): ${fmt(baseSummary.mrr)}`);
      console.log(`  MRR@${topK}    (reranked) : ${fmt(rerankSummary.mrr)}  (${delta(rerankSummary.mrr - baseSummary.mrr)})`);
      console.log(`  Precision@${topK} (no-rerank): ${fmt(baseSummary.precision)}`);
      console.log(`  Precision@${topK} (reranked) : ${fmt(rerankSummary.precision)}  (${delta(rerankSummary.precision - baseSummary.precision)})`);
    } else {
      console.log(`  Recall@${topK}:    ${fmt(baseSummary.recall)}`);
      console.log(`  MRR@${topK}:       ${fmt(baseSummary.mrr)}`);
      console.log(`  Precision@${topK}: ${fmt(baseSummary.precision)}`);
      console.log(`  No-evidence rate: ${fmt(baseSummary.noEvidenceRate)}`);
      console.log(`  Fallback rate:    ${fmt(baseSummary.fallbackRate)}`);
    }
    console.log();
  }
}

process.exitCode = run.failedQueries > 0 ? 1 : 0;
