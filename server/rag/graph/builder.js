import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromChunkText } from "./extractor.js";
import {
  openNotebookGraph,
  openNotebookGraphAtPath,
  closeGraphDatabase,
  replaceNotebookGraphFile,
  getNotebookGraphPath,
  upsertNode,
  upsertEdge,
  attachSourceRef,
  setMeta,
  getStats,
  getManualOverrides,
  applyManualOverrides,
  validateGraphIntegrity
} from "./store.js";
import { loadNotebookDocumentRecords } from "../../notebooks.js";
import {
  createRebuildJobId,
  persistRebuildJob,
  appendRebuildJobEvent,
  readLatestRebuildJob,
  listRebuildJobs as listPersistedRebuildJobs
} from "./jobStore.js";
import {
  makeEntitySupportKey,
  scoreEntityConfidence,
  scoreRelationConfidence
} from "./confidence.js";
import { extractLawCitations } from "../../law/lawArticleRef.js";

// Deterministic regex-extracted citations carry near-certain confidence —
// they are derived from law-name + article-pattern matches, not the LLM.
const LAW_CITATION_NODE_CONFIDENCE = 0.95;
const LAW_CITATION_EDGE_CONFIDENCE = 0.98;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const LOG_DIR = path.join(rootDir, "server", "log");

const jobs = new Map();

function appendLog(notebookId, line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logPath = path.join(LOG_DIR, `kg-rebuild-${notebookId}.log`);
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

function getTempGraphPath(notebookId, jobId) {
  return path.join(rootDir, "data", "notebooks", notebookId, `graph.${jobId}.sqlite.tmp`);
}

function persistJob(job, { force = false } = {}) {
  const now = Date.now();
  if (!force && job._lastPersistedMs && now - job._lastPersistedMs < 1000) return;
  job.updatedAt = new Date().toISOString();
  job._lastPersistedMs = now;
  try {
    persistRebuildJob(snapshotJob(job));
  } catch {
    // Rebuild should not fail because job telemetry could not be written.
  }
}

function recordJobEvent(job, message, extra = {}) {
  appendLog(job.notebookId, message);
  appendRebuildJobEvent(job.notebookId, job.jobId, { message, ...extra });
}

function rememberFailure(job, failure) {
  job.failureSamples ||= [];
  if (job.failureSamples.length < 20) {
    job.failureSamples.push({
      at: new Date().toISOString(),
      ...failure
    });
  }
}

export function getRebuildJob(notebookId) {
  const active = jobs.get(notebookId);
  if (active) return active;
  const persisted = readLatestRebuildJob(notebookId);
  if (!persisted) return null;
  if (persisted.status === "running") {
    const interrupted = {
      ...persisted,
      status: "failed",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: persisted.error || "Server stopped before the rebuild completed."
    };
    try {
      persistRebuildJob(interrupted);
      appendRebuildJobEvent(notebookId, interrupted.jobId, {
        message: "[rebuild] marked failed after server restart",
        level: "warn"
      });
    } catch {
      // Best effort only.
    }
    return interrupted;
  }
  return persisted;
}

export function isRebuildInProgress(notebookId) {
  const job = jobs.get(notebookId);
  return Boolean(job && job.status === "running");
}

export function snapshotJob(job) {
  if (!job) return null;
  const startedMs = Date.parse(job.startedAt);
  const endMs = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return {
    jobId: job.jobId || null,
    notebookId: job.notebookId,
    status: job.status,
    stage: job.stage || null,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt || null,
    finishedAt: job.finishedAt || null,
    elapsedMs: Math.max(0, endMs - startedMs),
    total: job.total || 0,
    processed: job.processed || 0,
    attempted: job.attempted || 0,
    nodesCreated: job.nodesCreated || 0,
    edgesCreated: job.edgesCreated || 0,
    failures: job.failures || 0,
    skipped: job.skipped || 0,
    error: job.error || null,
    model: job.model || null,
    finalStats: job.finalStats || null,
    validation: job.validation || null,
    manualOverrides: job.manualOverrides || null,
    failureSamples: job.failureSamples || []
  };
}

export function listRebuildJobHistory(notebookId, limit = 20) {
  return listPersistedRebuildJobs(notebookId, limit);
}

export async function startRebuild(notebookId, { model = "", concurrency = 1 } = {}) {
  if (!notebookId) throw new Error("notebookId required");
  if (isRebuildInProgress(notebookId)) {
    return { ok: false, reason: "already_running", job: snapshotJob(getRebuildJob(notebookId)) };
  }
  const resolvedModel = (model || process.env.KG_EXTRACT_MODEL || "").trim() || null;
  const job = {
    jobId: createRebuildJobId(),
    notebookId,
    status: "running",
    stage: "queued",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    processed: 0,
    attempted: 0,
    nodesCreated: 0,
    edgesCreated: 0,
    failures: 0,
    skipped: 0,
    error: null,
    model: resolvedModel,
    finalStats: null,
    validation: null,
    manualOverrides: null,
    failureSamples: [],
    nodeSupport: new Map(),
    edgeSupport: new Map()
  };
  jobs.set(notebookId, job);
  persistJob(job, { force: true });
  recordJobEvent(job, `[rebuild] started job=${job.jobId} model=${resolvedModel || "default"} concurrency=${concurrency}`);

  runRebuild(job, { model: resolvedModel || undefined, concurrency }).catch((error) => {
    job.status = "failed";
    job.stage = "failed";
    job.error = error?.message || String(error);
    job.finishedAt = new Date().toISOString();
    rememberFailure(job, { scope: "job", error: job.error });
    persistJob(job, { force: true });
    recordJobEvent(job, `[rebuild] crashed: ${job.error}`, { level: "error" });
  });

  return { ok: true, job: snapshotJob(job) };
}

async function runRebuild(job, { model, concurrency }) {
  const { notebookId } = job;
  job.stage = "loading";
  persistJob(job, { force: true });
  const records = await loadNotebookDocumentRecords(notebookId);
  const allChunks = [];
  for (const doc of records) {
    for (const chunk of (doc.chunks || [])) {
      if (!chunk?.text || !String(chunk.text).trim()) continue;
      allChunks.push({
        documentId: doc.id,
        chunkIndex: chunk.index,
        text: chunk.text
      });
    }
  }
  job.total = allChunks.length;
  recordJobEvent(job, `[rebuild] docs=${records.length} chunks=${allChunks.length}`);
  persistJob(job, { force: true });

  const tempPath = getTempGraphPath(notebookId, job.jobId);
  try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore */ }

  let manualOverrides = { nodes: [], edges: [] };
  if (fs.existsSync(getNotebookGraphPath(notebookId))) {
    const existingDb = await openNotebookGraph(notebookId);
    manualOverrides = getManualOverrides(existingDb);
  }

  job.manualOverrides = {
    nodesFound: manualOverrides.nodes.length,
    edgesFound: manualOverrides.edges.length,
    nodesApplied: 0,
    edgesApplied: 0
  };
  job.stage = "building_temp";
  recordJobEvent(job, `[rebuild] building temp graph ${path.basename(tempPath)}`);
  persistJob(job, { force: true });

  let db = await openNotebookGraphAtPath(notebookId, tempPath);
  let swapped = false;
  try {
    job.stage = "extracting";
    persistJob(job, { force: true });

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(8, Number(concurrency) || 1));
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= allChunks.length) return;
        try {
          await processChunk(db, job, allChunks[idx], model, idx);
        } catch (error) {
          job.failures++;
          job.attempted++;
          rememberFailure(job, {
            scope: "chunk",
            chunk: `${allChunks[idx]?.documentId}:${allChunks[idx]?.chunkIndex}`,
            error: error?.message || String(error)
          });
          recordJobEvent(job, `[rebuild] chunk ${idx} unexpected error: ${error?.message || error}`, { level: "error" });
          persistJob(job);
        }
      }
    });
    await Promise.all(workers);

    if (job.total > 0 && job.processed === 0 && job.failures > 0) {
      throw new Error("all chunk extractions failed; keeping the existing graph");
    }

    job.stage = "finalizing";
    const applied = applyManualOverrides(db, manualOverrides);
    job.manualOverrides = {
      ...job.manualOverrides,
      nodesApplied: applied.nodesApplied,
      edgesApplied: applied.edgesApplied
    };
    setMeta(db, "last_built_at", new Date().toISOString());
    setMeta(db, "extraction_model", job.model || "gemma4:e2b");
    setMeta(db, "rebuild_job_id", job.jobId);

    const validation = validateGraphIntegrity(db);
    job.validation = validation;
    if (!validation.ok) {
      throw new Error(`temp graph validation failed: ${validation.reason}`);
    }

    const stats = getStats(db);
    job.finalStats = {
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      enabledNodes: stats.enabledNodes,
      enabledEdges: stats.enabledEdges,
      refCount: stats.refCount
    };

    closeGraphDatabase(db);
    db = null;

    job.stage = "swapping";
    persistJob(job, { force: true });
    replaceNotebookGraphFile(notebookId, tempPath);
    swapped = true;

    job.status = "done";
    job.stage = "done";
    job.finishedAt = new Date().toISOString();
    persistJob(job, { force: true });
    recordJobEvent(
      job,
      `[rebuild] done processed=${job.processed} failed=${job.failures} ` +
      `nodes=${stats.enabledNodes}/${stats.nodeCount} edges=${stats.enabledEdges}/${stats.edgeCount}`
    );
  } finally {
    if (db) closeGraphDatabase(db);
    if (!swapped) {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore */ }
    }
  }
}

async function processChunk(db, job, chunk, model, idx = 0) {
  // Deterministic legal-citation harvest runs regardless of LLM success so
  // statute/article nodes still land when extraction fails on prose-heavy
  // chunks. The harvested IDs are surfaced to the LLM-relation pass so it
  // can attach REFERS_TO_ARTICLE edges from extracted concepts.
  const harvestedArticleIds = harvestLegalCitationsInChunk(db, chunk, job);

  const result = await extractFromChunkText({
    chunkText: chunk.text,
    model: model || undefined
  });
  if (!result.ok) {
    job.failures++;
    job.attempted++;
    rememberFailure(job, {
      scope: "chunk",
      chunk: `${chunk.documentId}:${chunk.chunkIndex}`,
      reason: result.reason,
      error: result.error || result.raw || null
    });
    recordJobEvent(job, `[rebuild] chunk ${idx} failed: ${result.reason}`, { level: "warn" });
    persistJob(job);
    return;
  }
  const tempToId = new Map();
  for (const ent of result.entities) {
    try {
      const supportKey = makeEntitySupportKey(ent);
      const supportBefore = job.nodeSupport.get(supportKey) || 0;
      const confidence = scoreEntityConfidence(ent, chunk.text, supportBefore);
      const nodeId = upsertNode(db, {
        type: ent.type,
        label: ent.label,
        aliases: ent.aliases,
        confidence,
        model: result.model
      });
      job.nodeSupport.set(supportKey, supportBefore + 1);
      tempToId.set(ent.tempId, nodeId);
      attachSourceRef(db, {
        kind: "node",
        refId: nodeId,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        quote: ent.evidence
      });
      job.nodesCreated++;
    } catch { /* skip individual node errors */ }
  }
  for (const rel of result.relations) {
    const srcId = tempToId.get(rel.src);
    const dstId = tempToId.get(rel.dst);
    if (!srcId || !dstId) continue;
    try {
      const supportKey = `${srcId}|${rel.type}|${dstId}`;
      const supportBefore = job.edgeSupport.get(supportKey) || 0;
      const confidence = scoreRelationConfidence(rel, chunk.text, supportBefore);
      const edgeId = upsertEdge(db, {
        srcId,
        dstId,
        type: rel.type,
        confidence,
        model: result.model
      });
      job.edgeSupport.set(supportKey, supportBefore + 1);
      if (edgeId) {
        attachSourceRef(db, {
          kind: "edge",
          refId: edgeId,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          quote: rel.evidence
        });
        job.edgesCreated++;
      }
    } catch { /* skip individual edge errors */ }
  }

  // Cross-edges: each Concept-ish LLM entity in this chunk REFERS_TO_ARTICLE
  // each harvested Article. Lets queries on subject matter ("동의", "손해배상")
  // surface the relevant Article via 1-hop graph expansion.
  if (harvestedArticleIds.length && tempToId.size) {
    attachConceptRefersToArticleEdges(db, job, chunk, tempToId, result, harvestedArticleIds);
  }

  job.attempted++;
  job.processed++;
  persistJob(job);
}

const CONCEPT_LIKE_TYPES = new Set(["Concept", "Rule", "Procedure", "Department", "Role", "Document"]);
const MAX_CROSS_EDGES_PER_CHUNK = 12;

function attachConceptRefersToArticleEdges(db, job, chunk, tempToId, result, articleIds) {
  let added = 0;
  for (const ent of result.entities || []) {
    if (added >= MAX_CROSS_EDGES_PER_CHUNK) break;
    if (!CONCEPT_LIKE_TYPES.has(ent.type)) continue;
    const srcId = tempToId.get(ent.tempId);
    if (!srcId) continue;
    for (const dstId of articleIds) {
      if (added >= MAX_CROSS_EDGES_PER_CHUNK) break;
      try {
        const edgeId = upsertEdge(db, {
          srcId,
          dstId,
          type: "REFERS_TO_ARTICLE",
          confidence: LAW_CITATION_EDGE_CONFIDENCE,
          model: null
        });
        if (edgeId) {
          attachSourceRef(db, {
            kind: "edge",
            refId: edgeId,
            documentId: chunk.documentId,
            chunkIndex: chunk.chunkIndex,
            quote: ent.evidence || ""
          });
          job.edgesCreated++;
          added++;
        }
      } catch { /* skip individual edge errors */ }
    }
  }
}

/**
 * Deterministic legal-citation harvester. Runs `extractLawCitations` over the
 * chunk text and upserts Statute + Article nodes (with PART_OF edges) into the
 * graph. Confidence is high because matches are regex-anchored and gated by
 * `isLawishName`. Returns the set of upserted Article node IDs so the caller
 * can attach REFERS_TO_ARTICLE cross-edges from LLM-extracted concepts.
 *
 * Exported for unit testing without spinning up the LLM extractor.
 */
export function harvestLegalCitationsInChunk(db, chunk, job = null) {
  if (!chunk?.text) return [];
  let citations;
  try {
    citations = extractLawCitations(chunk.text);
  } catch {
    return [];
  }
  if (!Array.isArray(citations) || !citations.length) return [];

  const articleIds = [];
  const seen = new Set();
  for (const cit of citations) {
    const articleCanonical = cit?.canonical || "";
    const articleSurface = cit?.citation || (cit?.lawName && cit?.article ? `${cit.lawName} ${cit.article}` : "");
    if (!cit?.lawName || !cit?.article || !articleSurface) continue;
    const dedupeKey = `${cit.lawName}/${cit.article}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    try {
      const statuteId = upsertNode(db, {
        type: "Statute",
        label: cit.lawName,
        confidence: LAW_CITATION_NODE_CONFIDENCE,
        model: null,
        aliases: []
      });
      const articleId = upsertNode(db, {
        type: "Article",
        label: `${cit.lawName} ${cit.article}`,
        confidence: LAW_CITATION_NODE_CONFIDENCE,
        model: null,
        aliases: [articleCanonical, articleSurface].filter(Boolean)
      });
      const edgeId = upsertEdge(db, {
        srcId: articleId,
        dstId: statuteId,
        type: "PART_OF",
        confidence: LAW_CITATION_EDGE_CONFIDENCE,
        model: null
      });
      attachSourceRef(db, {
        kind: "node",
        refId: statuteId,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        quote: articleSurface
      });
      attachSourceRef(db, {
        kind: "node",
        refId: articleId,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        quote: articleSurface
      });
      if (edgeId) {
        attachSourceRef(db, {
          kind: "edge",
          refId: edgeId,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          quote: articleSurface
        });
      }
      if (job) {
        job.nodesCreated = (job.nodesCreated || 0) + 2;
        if (edgeId) job.edgesCreated = (job.edgesCreated || 0) + 1;
      }
      articleIds.push(articleId);
    } catch { /* skip individual citation errors */ }
  }
  return articleIds;
}
