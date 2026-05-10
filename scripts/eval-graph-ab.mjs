/**
 * A/B evaluation: baseline (vector+lexical) vs graph-expanded retrieval.
 *
 * Usage:
 *   node --env-file=.env scripts/eval-graph-ab.mjs [options]
 *
 * Options:
 *   --fixture PATH    Golden fixture (default: data/rag-eval/golden.json)
 *   --notebook ID     Restrict to this notebook
 *   --suite ID        Restrict to this suite
 *   --tag NAME        After running, filter suite cases by tag (e.g. "multihop")
 *   --k N             Top-K (default: 10)
 *   --output PATH     Where to write the JSON report (default: server/log/graph-ab-<ts>.json)
 *   --quick           Only cases marked "quick": true
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../server/rag/evalRunner.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let fixturePath = path.join(rootDir, "data", "rag-eval", "golden.json");
let filterNotebook = "";
let filterSuite = "";
let filterTag = "";
let topK = 10;
let outputPath = "";
let quickMode = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--fixture" && args[i + 1]) fixturePath = args[++i];
  else if (a === "--notebook" && args[i + 1]) filterNotebook = args[++i];
  else if (a === "--suite" && args[i + 1]) filterSuite = args[++i];
  else if (a === "--tag" && args[i + 1]) filterTag = args[++i];
  else if (a === "--k" && args[i + 1]) topK = Math.max(1, parseInt(args[++i], 10) || 10);
  else if (a === "--output" && args[i + 1]) outputPath = args[++i];
  else if (a === "--quick") quickMode = true;
}

if (!outputPath) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  outputPath = path.join(rootDir, "server", "log", `graph-ab-${ts}.json`);
}

let golden;
try {
  golden = JSON.parse(await fs.readFile(fixturePath, "utf8"));
} catch (err) {
  console.error(`Cannot read fixture: ${fixturePath}\n${err.message}`);
  process.exit(1);
}

const variants = [
  { label: "baseline", graphExpansion: false },
  { label: "graph", graphExpansion: true }
];

console.error(`[eval-ab] running ${variants.length} variants × ${quickMode ? "quick" : "full"} mode`);
console.error(`[eval-ab] notebook=${filterNotebook || "all"} suite=${filterSuite || "all"} tag=${filterTag || "all"}`);

const startedAt = Date.now();
let lastDone = -1;
const run = await runEvaluation({
  golden,
  filter: {
    notebookId: filterNotebook || undefined,
    suiteId: filterSuite || undefined,
    tag: filterTag || undefined,
    quick: quickMode
  },
  k: topK,
  variants,
  onProgress: ({ done, total, caseId, variantLabel, suiteId }) => {
    if (done === lastDone) return;
    lastDone = done;
    if (done % 5 === 0 || done === total) {
      console.error(`  [${done}/${total}] ${suiteId} ${caseId} (${variantLabel})`);
    }
  }
});
const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
console.error(`[eval-ab] done in ${elapsedSec}s`);

const summary = run.summary;
const fmt = (v) => (typeof v === "number" ? v.toFixed(4) : "—");
const delta = (a, b) => {
  if (typeof a !== "number" || typeof b !== "number") return "—";
  const d = b - a;
  return `${d >= 0 ? "+" : ""}${d.toFixed(4)}`;
};

console.log("\n=== Overall A/B ===");
console.log(`  Variant      Recall@${topK}    MRR        Precision   No-evidence`);
for (const v of variants) {
  const s = summary[v.label];
  if (!s) continue;
  console.log(`  ${v.label.padEnd(12)} ${fmt(s.recall).padEnd(10)} ${fmt(s.mrr).padEnd(10)} ${fmt(s.precision).padEnd(10)} ${fmt(s.noEvidenceRate)}`);
}
const sB = summary.baseline;
const sG = summary.graph;
if (sB && sG) {
  console.log(`  Δ recall=${delta(sB.recall, sG.recall)}  Δ mrr=${delta(sB.mrr, sG.mrr)}  Δ precision=${delta(sB.precision, sG.precision)}`);
}

if (Array.isArray(run.comparisons) && run.comparisons.length) {
  console.log("\n=== Graph Expansion Diagnostics ===");
  for (const c of run.comparisons) {
    console.log(`  ${c.baseline} -> ${c.graph} (n=${c.n})`);
    console.log(`     latency ${fmt(c.baselineAvgTotalMs)}ms -> ${fmt(c.graphAvgTotalMs)}ms, delta ${delta(c.baselineAvgTotalMs, c.graphAvgTotalMs)}ms`);
    console.log(`     graph expansion avg ${fmt(c.avgGraphExpansionMs)}ms, hydration avg ${fmt(c.avgGraphHydrationMs)}ms`);
    console.log(`     supplement hit ${typeof c.graphSupplementHitRate === "number" ? fmt(c.graphSupplementHitRate) : "n/a"}, used ${fmt(c.graphUsedRate)}, noise ${fmt(c.noiseCaseRate)}`);
    console.log(`     worse: recall ${fmt(c.recallWorseRate)}, precision ${fmt(c.precisionWorseRate)}`);
  }
}

console.log("\n=== Per-tag A/B ===");
const allTags = new Set();
for (const v of variants) for (const t of Object.keys(summary[v.label]?.byTag || {})) allTags.add(t);
for (const tag of allTags) {
  console.log(`\n  Tag: ${tag}`);
  console.log(`    Variant      n   Recall@${topK}    MRR        Precision   No-evidence`);
  for (const v of variants) {
    const t = summary[v.label]?.byTag?.[tag];
    if (!t) continue;
    console.log(`    ${v.label.padEnd(12)} ${String(t.n).padEnd(3)} ${fmt(t.recall).padEnd(10)} ${fmt(t.mrr).padEnd(10)} ${fmt(t.precision).padEnd(10)} ${fmt(t.noEvidenceRate)}`);
  }
  const tB = summary.baseline?.byTag?.[tag];
  const tG = summary.graph?.byTag?.[tag];
  if (tB && tG) {
    console.log(`    Δ recall=${delta(tB.recall, tG.recall)}  Δ mrr=${delta(tB.mrr, tG.mrr)}  Δ precision=${delta(tB.precision, tG.precision)}`);
  }
}

console.log("\n=== Per-case deltas (graph - baseline, |Δrecall|>0) ===");
for (const suite of run.suites) {
  for (const c of suite.cases) {
    const b = c.variants.baseline?.metrics;
    const g = c.variants.graph?.metrics;
    if (!b || !g) continue;
    const dr = g.recall - b.recall;
    if (Math.abs(dr) < 0.0001) continue;
    const tagStr = (c.tags && c.tags.length) ? `[${c.tags.join(",")}]` : "";
    console.log(`  [${c.id}] ${tagStr} ${c.query.slice(0, 60)}`);
    console.log(`     baseline R=${fmt(b.recall)} MRR=${fmt(b.rr)} | graph R=${fmt(g.recall)} MRR=${fmt(g.rr)} | Δ=${delta(b.recall, g.recall)}`);
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({ fixture: fixturePath, ...run }, null, 2), "utf8");
console.error(`\n[eval-ab] full report: ${outputPath}`);

process.exitCode = run.failedQueries > 0 ? 1 : 0;
