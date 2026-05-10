import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromChunkText } from "./extractor.js";
import {
  openNotebookGraph,
  upsertNode,
  upsertEdge,
  attachSourceRef,
  setMeta,
  getStats,
  clearGraph
} from "./store.js";
import { loadNotebookDocumentRecords } from "../../notebooks.js";

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

export function getRebuildJob(notebookId) {
  return jobs.get(notebookId) || null;
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
    notebookId: job.notebookId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    elapsedMs: Math.max(0, endMs - startedMs),
    total: job.total || 0,
    processed: job.processed || 0,
    nodesCreated: job.nodesCreated || 0,
    edgesCreated: job.edgesCreated || 0,
    failures: job.failures || 0,
    skipped: job.skipped || 0,
    error: job.error || null,
    model: job.model || null,
    finalStats: job.finalStats || null
  };
}

export async function startRebuild(notebookId, { model = "", concurrency = 1 } = {}) {
  if (!notebookId) throw new Error("notebookId required");
  if (isRebuildInProgress(notebookId)) {
    return { ok: false, reason: "already_running", job: snapshotJob(getRebuildJob(notebookId)) };
  }
  const resolvedModel = (model || process.env.KG_EXTRACT_MODEL || "").trim() || null;
  const job = {
    notebookId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    processed: 0,
    nodesCreated: 0,
    edgesCreated: 0,
    failures: 0,
    skipped: 0,
    error: null,
    model: resolvedModel,
    finalStats: null
  };
  jobs.set(notebookId, job);
  appendLog(notebookId, `[rebuild] started model=${resolvedModel || "default"} concurrency=${concurrency}`);

  runRebuild(job, { model: resolvedModel || undefined, concurrency }).catch((error) => {
    job.status = "failed";
    job.error = error?.message || String(error);
    job.finishedAt = new Date().toISOString();
    appendLog(notebookId, `[rebuild] crashed: ${job.error}`);
  });

  return { ok: true, job: snapshotJob(job) };
}

async function runRebuild(job, { model, concurrency }) {
  const { notebookId } = job;
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
  appendLog(notebookId, `[rebuild] docs=${records.length} chunks=${allChunks.length}`);

  const db = await openNotebookGraph(notebookId);
  clearGraph(db);
  appendLog(notebookId, "[rebuild] graph cleared");

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(8, Number(concurrency) || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= allChunks.length) return;
      try {
        await processChunk(db, job, allChunks[idx], model);
      } catch (error) {
        job.failures++;
        appendLog(notebookId, `[rebuild] chunk ${idx} unexpected error: ${error?.message || error}`);
      }
    }
  });
  await Promise.all(workers);

  setMeta(db, "last_built_at", new Date().toISOString());
  setMeta(db, "extraction_model", job.model || "gemma4:e2b");

  const stats = getStats(db);
  job.finalStats = {
    nodeCount: stats.nodeCount,
    edgeCount: stats.edgeCount,
    enabledNodes: stats.enabledNodes,
    enabledEdges: stats.enabledEdges,
    refCount: stats.refCount
  };
  job.status = "done";
  job.finishedAt = new Date().toISOString();
  appendLog(
    notebookId,
    `[rebuild] done processed=${job.processed} failed=${job.failures} ` +
    `nodes=${stats.enabledNodes}/${stats.nodeCount} edges=${stats.enabledEdges}/${stats.edgeCount}`
  );
}

async function processChunk(db, job, chunk, model) {
  const result = await extractFromChunkText({
    chunkText: chunk.text,
    model: model || undefined
  });
  if (!result.ok) {
    job.failures++;
    return;
  }
  const tempToId = new Map();
  for (const ent of result.entities) {
    try {
      const nodeId = upsertNode(db, {
        type: ent.type,
        label: ent.label,
        aliases: ent.aliases,
        confidence: 1.0,
        model: result.model
      });
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
      const edgeId = upsertEdge(db, {
        srcId,
        dstId,
        type: rel.type,
        confidence: 1.0,
        model: result.model
      });
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
  job.processed++;
}
