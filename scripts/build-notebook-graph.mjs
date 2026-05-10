/**
 * Build a knowledge graph for a single department notebook.
 *
 * Usage:
 *   node --env-file=.env scripts/build-notebook-graph.mjs <notebookId> [options]
 *
 * Options:
 *   --limit N       Process only first N chunks (smoke runs)
 *   --model MODEL   Override KG_EXTRACT_MODEL (e.g. qwen3.6:35b)
 *   --rebuild       Clear existing graph before extraction
 *   --resume        Skip chunks that already have any source_ref recorded
 *   --concurrency N Run N chunk extractions in parallel (default 1)
 *   --json          Emit per-chunk progress as JSONL on stdout
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromChunkText } from "../server/rag/graph/extractor.js";
import {
  openNotebookGraph,
  openNotebookGraphAtPath,
  closeGraphDatabase,
  closeNotebookGraph,
  replaceNotebookGraphFile,
  upsertNode,
  upsertEdge,
  attachSourceRef,
  setMeta,
  getStats,
  getNotebookGraphPath,
  getManualOverrides,
  applyManualOverrides,
  validateGraphIntegrity
} from "../server/rag/graph/store.js";
import {
  makeEntitySupportKey,
  scoreEntityConfidence,
  scoreRelationConfidence
} from "../server/rag/graph/confidence.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── parse args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let notebookId = "";
let limit = 0;
let modelOverride = "";
let rebuild = false;
let resume = false;
let concurrency = 1;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!notebookId && !a.startsWith("--")) { notebookId = a; continue; }
  if (a === "--limit" && args[i + 1]) { limit = Math.max(1, parseInt(args[++i], 10) || 0); }
  else if (a === "--model" && args[i + 1]) { modelOverride = args[++i]; }
  else if (a === "--rebuild") { rebuild = true; }
  else if (a === "--resume") { resume = true; }
  else if (a === "--concurrency" && args[i + 1]) { concurrency = Math.max(1, parseInt(args[++i], 10) || 1); }
  else if (a === "--json") { jsonOutput = true; }
}

if (!notebookId) {
  console.error("Usage: node --env-file=.env scripts/build-notebook-graph.mjs <notebookId> [options]");
  process.exit(1);
}

const log = (obj) => {
  if (jsonOutput) console.log(JSON.stringify(obj));
  else console.log(typeof obj === "string" ? obj : JSON.stringify(obj));
};

// ── load notebook docs ────────────────────────────────────────────────────
const nbDir = path.join(rootDir, "data", "notebooks", notebookId);
const manifestPath = path.join(nbDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`Notebook manifest not found: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const docs = (manifest.documents || []).map((d) => {
  const docPath = path.join(nbDir, "docs", `${d.id}.json`);
  return JSON.parse(fs.readFileSync(docPath, "utf8"));
});

// flatten chunks
const allChunks = [];
for (const doc of docs) {
  for (const c of (doc.chunks || [])) {
    if (!c.text || !c.text.trim()) continue;
    allChunks.push({
      documentId: doc.id,
      documentName: doc.name,
      chunkIndex: c.index,
      page: c.page || null,
      text: c.text
    });
  }
}

const targetChunks = limit > 0 ? allChunks.slice(0, limit) : allChunks;

console.error(`[build] notebook=${notebookId}  docs=${docs.length}  chunks=${allChunks.length}  target=${targetChunks.length}`);
console.error(`[build] graph path: ${getNotebookGraphPath(notebookId)}`);

// ── open graph + optional rebuild ─────────────────────────────────────────
let db;
let tempGraphPath = "";
let manualOverrides = { nodes: [], edges: [] };
if (rebuild) {
  if (fs.existsSync(getNotebookGraphPath(notebookId))) {
    const existingDb = await openNotebookGraph(notebookId);
    manualOverrides = getManualOverrides(existingDb);
  }
  tempGraphPath = path.join(nbDir, `graph.cli-${Date.now()}.sqlite.tmp`);
  fs.rmSync(tempGraphPath, { force: true });
  console.error(`[build] rebuilding into temp graph: ${tempGraphPath}`);
  db = await openNotebookGraphAtPath(notebookId, tempGraphPath);
} else {
  db = await openNotebookGraph(notebookId);
}

// build resume set if requested
const skipKeys = new Set();
if (resume) {
  const rows = db.prepare(
    "SELECT DISTINCT document_id, chunk_index FROM kg_source_refs"
  ).all();
  for (const r of rows) skipKeys.add(`${r.document_id}:${r.chunk_index}`);
  console.error(`[build] resume mode: ${skipKeys.size} chunks already processed`);
}

const startedAt = new Date().toISOString();
const startedMs = Date.now();
let processed = 0;
let nodesCreated = 0;
let edgesCreated = 0;
let failures = 0;
let skipped = 0;
const nodeSupport = new Map();
const edgeSupport = new Map();

async function processChunk(chunk, idx) {
  const key = `${chunk.documentId}:${chunk.chunkIndex}`;
  if (skipKeys.has(key)) {
    skipped++;
    return;
  }
  const t0 = Date.now();
  const result = await extractFromChunkText({
    chunkText: chunk.text,
    model: modelOverride || undefined
  });
  const ms = Date.now() - t0;

  if (!result.ok) {
    failures++;
    log({
      step: "chunk_failed",
      idx,
      key,
      reason: result.reason,
      ms
    });
    return;
  }

  // map tempId -> persisted nodeId
  const tempToId = new Map();
  for (const ent of result.entities) {
    try {
      const supportKey = makeEntitySupportKey(ent);
      const supportBefore = nodeSupport.get(supportKey) || 0;
      const confidence = scoreEntityConfidence(ent, chunk.text, supportBefore);
      const nodeId = upsertNode(db, {
        type: ent.type,
        label: ent.label,
        aliases: ent.aliases,
        confidence,
        model: result.model
      });
      nodeSupport.set(supportKey, supportBefore + 1);
      tempToId.set(ent.tempId, nodeId);
      attachSourceRef(db, {
        kind: "node",
        refId: nodeId,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        quote: ent.evidence
      });
      nodesCreated++;
    } catch (e) {
      log({ step: "node_skip", idx, key, label: ent.label, error: e.message });
    }
  }
  for (const rel of result.relations) {
    const srcId = tempToId.get(rel.src);
    const dstId = tempToId.get(rel.dst);
    if (!srcId || !dstId) continue;
    try {
      const supportKey = `${srcId}|${rel.type}|${dstId}`;
      const supportBefore = edgeSupport.get(supportKey) || 0;
      const confidence = scoreRelationConfidence(rel, chunk.text, supportBefore);
      const edgeId = upsertEdge(db, {
        srcId,
        dstId,
        type: rel.type,
        confidence,
        model: result.model
      });
      edgeSupport.set(supportKey, supportBefore + 1);
      if (edgeId) {
        attachSourceRef(db, {
          kind: "edge",
          refId: edgeId,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          quote: rel.evidence
        });
        edgesCreated++;
      }
    } catch (e) {
      log({ step: "edge_skip", idx, key, error: e.message });
    }
  }

  processed++;
  log({
    step: "chunk_done",
    idx,
    key,
    entities: result.entities.length,
    relations: result.relations.length,
    ms
  });
}

// ── run with concurrency ──────────────────────────────────────────────────
async function runPool(items, worker, n) {
  let cursor = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

await runPool(targetChunks, processChunk, concurrency);

const finishedAt = new Date().toISOString();
const elapsedSec = Math.round((Date.now() - startedMs) / 1000);

if (targetChunks.length > 0 && processed === 0 && failures > 0) {
  console.error("[build] all chunk extractions failed; keeping the existing graph");
  if (rebuild) {
    closeGraphDatabase(db);
    fs.rmSync(tempGraphPath, { force: true });
  } else {
    closeNotebookGraph(notebookId);
  }
  process.exit(1);
}

setMeta(db, "last_built_at", finishedAt);
setMeta(db, "extraction_model", modelOverride || process.env.KG_EXTRACT_MODEL || "gemma4:e2b");
if (rebuild) {
  const applied = applyManualOverrides(db, manualOverrides);
  console.error(`[build] manual overrides reapplied: nodes=${applied.nodesApplied}/${manualOverrides.nodes.length}, edges=${applied.edgesApplied}/${manualOverrides.edges.length}`);
}

const validation = validateGraphIntegrity(db);
if (!validation.ok) {
  console.error(`[build] graph validation failed: ${validation.reason}`);
  if (rebuild) {
    closeGraphDatabase(db);
    fs.rmSync(tempGraphPath, { force: true });
  } else {
    closeNotebookGraph(notebookId);
  }
  process.exit(1);
}

const stats = getStats(db);
const summary = {
  notebookId,
  startedAt,
  finishedAt,
  elapsedSec,
  chunksTargeted: targetChunks.length,
  chunksProcessed: processed,
  chunksSkipped: skipped,
  chunksFailed: failures,
  nodesCreated,
  edgesCreated,
  finalStats: stats
};

console.error(`\n[build] done in ${elapsedSec}s — ${processed} ok, ${skipped} skipped, ${failures} failed`);
console.error(`[build] graph: ${stats.enabledNodes}/${stats.nodeCount} nodes, ${stats.enabledEdges}/${stats.edgeCount} edges, ${stats.refCount} sourceRefs`);
console.error(`[build] node types: ${stats.nodeTypeCounts.map((r) => `${r.type}=${r.c}`).join(", ")}`);
console.error(`[build] relation types: ${stats.relationTypeCounts.map((r) => `${r.type}=${r.c}`).join(", ")}`);

if (jsonOutput) log({ step: "summary", ...summary });

if (rebuild) {
  closeGraphDatabase(db);
  replaceNotebookGraphFile(notebookId, tempGraphPath);
  console.error("[build] temp graph validated and swapped into place");
} else {
  closeNotebookGraph(notebookId);
}
process.exit(failures > 0 && processed === 0 ? 1 : 0);
