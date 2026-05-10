import express from "express";
import { requireAdmin } from "./auth.js";
import {
  openNotebookGraph,
  getStats,
  listNodes,
  topNodes,
  edgesAmong,
  findNodesByAlias,
  neighborsOf,
  sourceRefsOf,
  getNode,
  getEdge,
  getMeta,
  setNodeEnabled,
  clearNodeOverride,
  setEdgeEnabled,
  clearEdgeOverride
} from "./rag/graph/store.js";
import { describeOntology } from "./rag/graph/ontology.js";
import { notebookHasGraph } from "./rag/graph/expander.js";

export const graphAdminRouter = express.Router();

graphAdminRouter.get("/ontology", requireAdmin, (_req, res) => {
  res.json(describeOntology());
});

function ensureGraph(req, res) {
  const { notebookId } = req.params;
  if (!notebookId) {
    res.status(400).json({ error: "notebookId required" });
    return null;
  }
  if (!notebookHasGraph(notebookId)) {
    res.status(404).json({ error: "no_graph", notebookId });
    return null;
  }
  return notebookId;
}

graphAdminRouter.get("/:notebookId/stats", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
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

graphAdminRouter.get("/:notebookId/nodes", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const type = typeof req.query.type === "string" && req.query.type.trim() ? req.query.type.trim() : null;
    const search = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const enabledOnly = req.query.enabledOnly !== "0";
    const nodes = listNodes(db, { type, search, limit, offset, enabledOnly });
    res.json({ notebookId, nodes, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.get("/:notebookId/search", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!term) { res.json({ notebookId, nodes: [] }); return; }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const nodes = findNodesByAlias(db, term, limit);
    res.json({ notebookId, nodes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.get("/:notebookId/subgraph", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const mode = typeof req.query.mode === "string" ? req.query.mode : "top";
    const limit = Math.min(400, Math.max(10, parseInt(req.query.limit, 10) || 80));
    const type = typeof req.query.type === "string" && req.query.type.trim() ? req.query.type.trim() : null;
    const includeDisabled = req.query.includeDisabled === "1";

    let nodes = [];
    if (mode === "around") {
      const seedId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
      if (!seedId) { res.status(400).json({ error: "nodeId required for mode=around" }); return; }
      const hops = Math.min(2, Math.max(1, parseInt(req.query.hops, 10) || 1));
      const seedNode = getNode(db, seedId);
      if (!seedNode) { res.status(404).json({ error: "seed node not found" }); return; }
      const accumulated = new Map();
      accumulated.set(seedNode.id, {
        id: seedNode.id, type: seedNode.type, label: seedNode.label, confidence: seedNode.confidence,
        enabled: seedNode.enabled, manualOverride: seedNode.manualOverride, hop: 0
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
                id: r.neighbor_id, type: r.neighbor_type, label: r.neighbor_label, confidence: r.confidence,
                enabled: 1, manualOverride: 0, hop: h
              });
              next.push(r.neighbor_id);
            }
          }
        }
        frontier = next;
      }
      nodes = Array.from(accumulated.values());
    } else {
      // mode === "top" (default)
      nodes = topNodes(db, { limit, type, enabledOnly: !includeDisabled }).map((n) => ({ ...n, hop: 0 }));
    }

    const ids = nodes.map((n) => n.id);
    const edges = edgesAmong(db, ids, { enabledOnly: !includeDisabled });

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

graphAdminRouter.get("/:notebookId/node/:nodeId", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const node = getNode(db, req.params.nodeId);
    if (!node) { res.status(404).json({ error: "node not found" }); return; }
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

graphAdminRouter.get("/:notebookId/edge/:edgeId", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const edge = getEdge(db, req.params.edgeId);
    if (!edge) { res.status(404).json({ error: "edge not found" }); return; }
    const refs = sourceRefsOf(db, "edge", edge.id, 20);
    res.json({ notebookId, edge, refs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.post("/:notebookId/node/:nodeId/toggle", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const enabled = req.body && req.body.enabled !== undefined ? Boolean(req.body.enabled) : null;
    if (enabled === null) { res.status(400).json({ error: "enabled (boolean) required" }); return; }
    const ok = setNodeEnabled(db, req.params.nodeId, enabled);
    if (!ok) { res.status(404).json({ error: "node not found" }); return; }
    res.json({ ok: true, node: getNode(db, req.params.nodeId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.post("/:notebookId/node/:nodeId/clear-override", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const ok = clearNodeOverride(db, req.params.nodeId);
    if (!ok) { res.status(404).json({ error: "node not found" }); return; }
    res.json({ ok: true, node: getNode(db, req.params.nodeId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.post("/:notebookId/edge/:edgeId/toggle", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const enabled = req.body && req.body.enabled !== undefined ? Boolean(req.body.enabled) : null;
    if (enabled === null) { res.status(400).json({ error: "enabled (boolean) required" }); return; }
    const ok = setEdgeEnabled(db, req.params.edgeId, enabled);
    if (!ok) { res.status(404).json({ error: "edge not found" }); return; }
    res.json({ ok: true, edge: getEdge(db, req.params.edgeId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

graphAdminRouter.post("/:notebookId/edge/:edgeId/clear-override", requireAdmin, async (req, res) => {
  const notebookId = ensureGraph(req, res);
  if (!notebookId) return;
  try {
    const db = await openNotebookGraph(notebookId);
    const ok = clearEdgeOverride(db, req.params.edgeId);
    if (!ok) { res.status(404).json({ error: "edge not found" }); return; }
    res.json({ ok: true, edge: getEdge(db, req.params.edgeId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
