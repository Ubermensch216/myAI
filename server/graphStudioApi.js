import express from "express";
import {
  openNotebookGraph,
  getStats,
  topNodes,
  edgesAmong,
  findNodesByAlias,
  neighborsOf,
  sourceRefsOf,
  getNode,
  getEdge,
  getMeta
} from "./rag/graph/store.js";
import { describeOntology } from "./rag/graph/ontology.js";
import { notebookHasGraph } from "./rag/graph/expander.js";
import { startRebuild, getRebuildJob, snapshotJob } from "./rag/graph/builder.js";
import { listNotebooks, getNotebook } from "./notebooks.js";
import {
  canAccessNotebook,
  getAccessFromRequest,
  isAccessControlConfigured,
  requireNotebookAccess
} from "./accessControl.js";
import { requireAdmin } from "./auth.js";

export const graphStudioRouter = express.Router();

graphStudioRouter.get("/ontology", (_req, res) => {
  res.json(describeOntology());
});

graphStudioRouter.get("/notebooks", async (req, res) => {
  try {
    const notebooks = await listNotebooks();
    const accessConfigured = await isAccessControlConfigured();
    const access = accessConfigured ? await getAccessFromRequest(req) : null;
    const visible = (accessConfigured ? notebooks.filter((nb) => canAccessNotebook(access, nb)) : notebooks)
      .filter((nb) => notebookHasGraph(nb.id))
      .map((nb) => ({ id: nb.id, name: nb.name, description: nb.description || "" }));
    res.json({ notebooks: visible });
  } catch (e) {
    res.status(500).json({ error: e.message, notebooks: [] });
  }
});

async function ensureNotebookAndAccess(req, res, { requireGraph = true } = {}) {
  const { notebookId } = req.params;
  if (!notebookId) {
    res.status(400).json({ error: "notebookId required" });
    return null;
  }
  const notebook = await getNotebook(notebookId);
  if (!notebook) {
    res.status(404).json({ error: "notebook not found", notebookId });
    return null;
  }
  if (await isAccessControlConfigured()) {
    const access = await requireNotebookAccess(req, res, notebook);
    if (!access) return null;
  }
  if (requireGraph && !notebookHasGraph(notebookId)) {
    res.status(404).json({ error: "no_graph", notebookId });
    return null;
  }
  return notebookId;
}

graphStudioRouter.post("/:notebookId/rebuild", requireAdmin, async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res, { requireGraph: false });
  if (!notebookId) return;
  try {
    const result = await startRebuild(notebookId, { concurrency: 1 });
    if (!result.ok) {
      res.status(409).json({ error: "already_running", job: result.job });
      return;
    }
    res.status(202).json({ ok: true, job: result.job });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphStudioRouter.get("/:notebookId/rebuild/status", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res, { requireGraph: false });
  if (!notebookId) return;
  const job = getRebuildJob(notebookId);
  res.json({ notebookId, job: snapshotJob(job) });
});

graphStudioRouter.get("/:notebookId/stats", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const stats = getStats(db);
    res.json({
      notebookId,
      ontologyVersion: getMeta(db, "ontology_version") || null,
      ...stats
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphStudioRouter.get("/:notebookId/search", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!term) { res.json({ notebookId, nodes: [] }); return; }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const nodes = findNodesByAlias(db, term, limit).filter((n) => n.enabled !== 0);
    res.json({ notebookId, nodes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphStudioRouter.get("/:notebookId/subgraph", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const mode = typeof req.query.mode === "string" ? req.query.mode : "top";
    const limit = Math.min(400, Math.max(10, parseInt(req.query.limit, 10) || 80));
    const type = typeof req.query.type === "string" && req.query.type.trim() ? req.query.type.trim() : null;

    let nodes = [];
    if (mode === "around") {
      const seedId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
      if (!seedId) { res.status(400).json({ error: "nodeId required for mode=around" }); return; }
      const hops = Math.min(2, Math.max(1, parseInt(req.query.hops, 10) || 1));
      const seedNode = getNode(db, seedId);
      if (!seedNode || seedNode.enabled === 0) {
        res.status(404).json({ error: "seed node not found" });
        return;
      }
      const accumulated = new Map();
      accumulated.set(seedNode.id, {
        id: seedNode.id, type: seedNode.type, label: seedNode.label,
        confidence: seedNode.confidence, hop: 0
      });
      let frontier = [seedNode.id];
      for (let h = 1; h <= hops && accumulated.size < limit; h++) {
        const next = [];
        for (const id of frontier) {
          const nb = neighborsOf(db, id, { directions: "both", limit: 24 });
          for (const r of nb) {
            if (accumulated.size >= limit) break;
            if (!accumulated.has(r.neighbor_id)) {
              accumulated.set(r.neighbor_id, {
                id: r.neighbor_id, type: r.neighbor_type, label: r.neighbor_label,
                confidence: r.confidence, hop: h
              });
              next.push(r.neighbor_id);
            }
          }
        }
        frontier = next;
      }
      nodes = Array.from(accumulated.values());
    } else {
      nodes = topNodes(db, { limit, type, enabledOnly: true })
        .map((n) => ({ ...n, hop: 0 }));
    }

    const ids = nodes.map((n) => n.id);
    const edges = edgesAmong(db, ids, { enabledOnly: true });

    res.json({
      notebookId,
      mode,
      counts: { nodes: nodes.length, edges: edges.length },
      nodes,
      edges
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphStudioRouter.get("/:notebookId/node/:nodeId", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const node = getNode(db, req.params.nodeId);
    if (!node || node.enabled === 0) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    const neighbors = neighborsOf(db, node.id, { directions: "both", limit: 40 }).map((r) => ({
      edgeId: r.edge_id,
      relType: r.type,
      confidence: r.confidence,
      direction: r.direction,
      neighborId: r.neighbor_id,
      neighborType: r.neighbor_type,
      neighborLabel: r.neighbor_label
    }));
    const refs = sourceRefsOf(db, "node", node.id, 20);
    res.json({ notebookId, node, neighbors, refs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphStudioRouter.get("/:notebookId/edge/:edgeId", async (req, res) => {
  const notebookId = await ensureNotebookAndAccess(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const edge = getEdge(db, req.params.edgeId);
    if (!edge || edge.enabled === 0) {
      res.status(404).json({ error: "edge not found" });
      return;
    }
    const refs = sourceRefsOf(db, "edge", edge.id, 20);
    res.json({ notebookId, edge, refs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
