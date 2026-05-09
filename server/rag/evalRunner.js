import crypto from "node:crypto";
import { searchNotebook } from "./departmentRag.js";

const MAX_FAILURE_SAMPLES = 200;

/**
 * Determine whether a returned chunk matches the case's relevance annotation.
 */
export function isHit(citation, tc) {
  if (Array.isArray(tc.relevantChunkKeys) && tc.relevantChunkKeys.length) {
    return tc.relevantChunkKeys.includes(`${citation.documentId}:${citation.chunkIndex}`);
  }
  return Array.isArray(tc.relevantDocIds) && tc.relevantDocIds.includes(citation.documentId);
}

function relevantSet(tc) {
  if (Array.isArray(tc.relevantChunkKeys) && tc.relevantChunkKeys.length) return new Set(tc.relevantChunkKeys);
  return new Set(tc.relevantDocIds || []);
}

/**
 * Compute per-case retrieval metrics over the top-K returned chunks.
 */
export function computeCaseMetrics(chunks, tc, k) {
  const top = chunks.slice(0, k);
  const relevant = relevantSet(tc);

  let hitCount = 0;
  let rr = 0;
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const key = (Array.isArray(tc.relevantChunkKeys) && tc.relevantChunkKeys.length)
      ? `${c.documentId}:${c.chunkIndex}`
      : c.documentId;
    if (relevant.has(key)) {
      hitCount++;
      if (rr === 0) rr = 1 / (i + 1);
    }
  }

  const recall = relevant.size > 0 ? hitCount / relevant.size : 0;
  const precision = top.length > 0 ? hitCount / top.length : 0;

  return { recall, rr, precision, hitCount, relevantCount: relevant.size, returned: top.length };
}

function aggregateVariantMetrics(perCase) {
  const valid = perCase.filter((r) => !r.error);
  if (!valid.length) {
    return { n: 0, recall: 0, mrr: 0, precision: 0, noEvidenceRate: 0, fallbackRate: 0, rerankAppliedRate: 0, byTag: {} };
  }
  const sumOver = (rows, key) => rows.reduce((s, r) => s + (r.metrics?.[key] ?? 0), 0);
  const noEvidence = valid.filter((r) => (r.returnedCount ?? 0) === 0).length;
  const fallback = valid.filter((r) => r.diagnostics?.fallbackLoadedAllChunks).length;
  const reranked = valid.filter((r) => r.diagnostics?.rerankApplied).length;

  const tagBuckets = new Map();
  for (const r of valid) {
    const tags = Array.isArray(r.tags) && r.tags.length ? r.tags : ["_untagged"];
    for (const tag of tags) {
      if (!tagBuckets.has(tag)) tagBuckets.set(tag, []);
      tagBuckets.get(tag).push(r);
    }
  }
  const byTag = {};
  for (const [tag, rows] of tagBuckets) {
    const ne = rows.filter((r) => (r.returnedCount ?? 0) === 0).length;
    byTag[tag] = {
      n: rows.length,
      recall: sumOver(rows, "recall") / rows.length,
      mrr: sumOver(rows, "rr") / rows.length,
      precision: sumOver(rows, "precision") / rows.length,
      noEvidenceRate: ne / rows.length
    };
  }

  return {
    n: valid.length,
    recall: sumOver(valid, "recall") / valid.length,
    mrr: sumOver(valid, "rr") / valid.length,
    precision: sumOver(valid, "precision") / valid.length,
    noEvidenceRate: noEvidence / valid.length,
    fallbackRate: fallback / valid.length,
    rerankAppliedRate: reranked / valid.length,
    byTag
  };
}

function applyFilters(suites, filter) {
  return (suites || [])
    .filter((s) => {
      if (s.skip) return false;
      if (filter.suiteId && s.id !== filter.suiteId) return false;
      if (filter.notebookId && s.notebookId !== filter.notebookId) return false;
      return true;
    })
    .map((suite) => ({
      ...suite,
      cases: filter.quick ? (suite.cases || []).filter((c) => c.quick === true) : (suite.cases || [])
    }))
    .filter((suite) => (suite.cases || []).length > 0);
}

function newRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run_${ts}_${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Run an evaluation against a golden set.
 *
 * @param {object} args
 * @param {object} args.golden     Golden set object (with .suites)
 * @param {object} [args.filter]   { suiteId, notebookId, quick }
 * @param {number} [args.k=10]     Top-K cutoff
 * @param {Array}  [args.variants] [{ label, rerank?, queryExpansion? }]
 * @param {AbortSignal} [args.signal]
 * @param {(p:{done:number,total:number,caseId:string,variantLabel:string,suiteId:string})=>void} [args.onProgress]
 * @param {number} [args.maxFailureSamples]
 */
export async function runEvaluation({
  golden,
  filter = {},
  k = 10,
  variants = [{ label: "default" }],
  signal,
  onProgress,
  maxFailureSamples = MAX_FAILURE_SAMPLES
} = {}) {
  if (!golden || !Array.isArray(golden.suites)) throw new Error("invalid_golden_set");
  const filteredSuites = applyFilters(golden.suites, filter);
  const totalCases = filteredSuites.reduce((n, s) => n + s.cases.length, 0);
  const totalRuns = totalCases * variants.length;

  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const suiteResults = [];
  const failureSamples = [];
  let totalQueries = 0;
  let failedQueries = 0;
  let done = 0;

  for (const suite of filteredSuites) {
    const suiteResult = {
      suiteId: suite.id,
      notebookId: suite.notebookId,
      description: suite.description || "",
      cases: []
    };

    for (const tc of suite.cases) {
      totalQueries++;
      const caseRecord = { id: tc.id, query: tc.query, relevantChunkKeys: tc.relevantChunkKeys || [], tags: tc.tags || [], variants: {} };

      for (const variant of variants) {
        if (signal?.aborted) throw new Error("aborted");
        const opts = { signal };
        if (typeof variant.rerank === "boolean") opts.rerank = variant.rerank;
        if (typeof variant.queryExpansion === "boolean") opts.queryExpansion = variant.queryExpansion;

        let result;
        try {
          result = await searchNotebook(suite.notebookId, tc.query, opts);
        } catch (err) {
          caseRecord.variants[variant.label] = { error: err.message };
          failedQueries++;
          done++;
          onProgress?.({ done, total: totalRuns, caseId: tc.id, variantLabel: variant.label, suiteId: suite.id });
          continue;
        }

        if (!result?.ok) {
          caseRecord.variants[variant.label] = { error: result?.reason || "search_failed" };
          failedQueries++;
        } else {
          const metrics = computeCaseMetrics(result.chunks, tc, k);
          const topChunks = result.chunks.slice(0, k).map((c) => ({
            documentId: c.documentId,
            chunkIndex: c.chunkIndex,
            documentName: c.documentName,
            locator: c.locator
          }));
          caseRecord.variants[variant.label] = {
            metrics,
            returnedCount: result.chunks.length,
            diagnostics: result.diagnostics || null,
            topChunks
          };
          if (metrics.recall === 0 && failureSamples.length < maxFailureSamples) {
            failureSamples.push({
              suiteId: suite.id,
              notebookId: suite.notebookId,
              caseId: tc.id,
              variantLabel: variant.label,
              query: tc.query,
              expectedKeys: tc.relevantChunkKeys || [],
              gotTopK: topChunks
            });
          }
        }

        done++;
        onProgress?.({ done, total: totalRuns, caseId: tc.id, variantLabel: variant.label, suiteId: suite.id });
      }

      suiteResult.cases.push(caseRecord);
    }
    suiteResults.push(suiteResult);
  }

  // Aggregate per variant.
  const summary = {};
  for (const variant of variants) {
    const perCase = suiteResults.flatMap((s) => s.cases.map((c) => {
      const v = c.variants[variant.label] || {};
      return {
        error: v.error || null,
        returnedCount: v.returnedCount ?? 0,
        diagnostics: v.diagnostics || null,
        metrics: v.metrics || null,
        tags: c.tags || []
      };
    }));
    summary[variant.label] = aggregateVariantMetrics(perCase);
  }

  const finishedAt = new Date().toISOString();
  return {
    runId,
    startedAt,
    finishedAt,
    mode: filter.quick ? "quick" : "full",
    k,
    filter,
    variants,
    totalQueries,
    failedQueries,
    summary,
    suites: suiteResults,
    failureSamples
  };
}
