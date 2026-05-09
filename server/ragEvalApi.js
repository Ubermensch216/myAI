import express from "express";
import { requireAdmin } from "./auth.js";
import {
  getGoldenSet,
  saveGoldenSet,
  upsertGoldenCase,
  deleteGoldenCase,
  saveRun,
  getRun,
  listRuns,
  deleteRun
} from "./rag/evalStore.js";
import { runEvaluation } from "./rag/evalRunner.js";
import { summarizeRetrievalLog } from "./rag/retrievalLogReader.js";

export const ragEvalRouter = express.Router();

// In-memory job state. Survives only the server process — finished runs are
// saved to disk via evalStore.saveRun and listed by listRuns.
const activeRuns = new Map();
// runId -> { startedAt, status, lastProgress, listeners: Set<res>, controller, payload? }

function broadcast(runId, event, data) {
  const job = activeRuns.get(runId);
  if (!job) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.listeners) {
    try { res.write(line); } catch { /* ignore */ }
  }
}

function endStreams(runId) {
  const job = activeRuns.get(runId);
  if (!job) return;
  for (const res of job.listeners) {
    try { res.end(); } catch { /* ignore */ }
  }
  job.listeners.clear();
}

// ── Golden set ──────────────────────────────────────────────────────────────

ragEvalRouter.get("/golden", requireAdmin, async (_req, res) => {
  try {
    const golden = await getGoldenSet();
    res.json({ golden });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ragEvalRouter.put("/golden", requireAdmin, async (req, res) => {
  try {
    const golden = req.body?.golden;
    if (!golden || !Array.isArray(golden.suites)) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    await saveGoldenSet(golden);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ragEvalRouter.put("/golden/case", requireAdmin, async (req, res) => {
  try {
    const { suiteId, case: caseEntry } = req.body || {};
    if (!suiteId || !caseEntry?.id) {
      res.status(400).json({ error: "suiteId_and_case_id_required" });
      return;
    }
    const result = await upsertGoldenCase(suiteId, caseEntry);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

ragEvalRouter.delete("/golden/case", requireAdmin, async (req, res) => {
  try {
    const suiteId = String(req.query.suiteId || "");
    const caseId = String(req.query.caseId || "");
    if (!suiteId || !caseId) {
      res.status(400).json({ error: "suiteId_and_caseId_required" });
      return;
    }
    const result = await deleteGoldenCase(suiteId, caseId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Runs ────────────────────────────────────────────────────────────────────

ragEvalRouter.get("/runs", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const persisted = await listRuns({ limit });
    const active = [...activeRuns.entries()]
      .filter(([, job]) => job.status === "running")
      .map(([runId, job]) => ({
        runId,
        startedAt: job.startedAt,
        finishedAt: null,
        mode: job.mode || null,
        k: job.k ?? null,
        variants: (job.variants || []).map((v) => v.label),
        status: "running",
        progress: job.lastProgress || null
      }));
    res.json({ active, runs: persisted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ragEvalRouter.get("/runs/:id", requireAdmin, async (req, res) => {
  try {
    const job = activeRuns.get(req.params.id);
    if (job?.status === "running") {
      res.json({ runId: req.params.id, status: "running", startedAt: job.startedAt, progress: job.lastProgress || null });
      return;
    }
    if (job?.status === "done" && job.payload) {
      res.json({ ...job.payload, status: "done" });
      return;
    }
    if (job?.status === "error") {
      res.status(500).json({ runId: req.params.id, status: "error", error: job.error });
      return;
    }
    const persisted = await getRun(req.params.id);
    if (!persisted) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }
    res.json({ ...persisted, status: "done" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ragEvalRouter.delete("/runs/:id", requireAdmin, async (req, res) => {
  try {
    const job = activeRuns.get(req.params.id);
    if (job?.status === "running") {
      job.controller?.abort();
    }
    activeRuns.delete(req.params.id);
    const result = await deleteRun(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ragEvalRouter.post("/runs", requireAdmin, async (req, res) => {
  try {
    const { filter, k, variants } = req.body || {};
    const golden = await getGoldenSet();
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const variantList = Array.isArray(variants) && variants.length ? variants : [{ label: "default" }];
    const evalK = Math.max(1, Math.min(50, parseInt(k, 10) || 10));
    const filterObj = filter && typeof filter === "object" ? filter : {};

    const placeholderRunId = `run_pending_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const job = {
      startedAt,
      status: "running",
      lastProgress: null,
      listeners: new Set(),
      controller,
      mode: filterObj.quick ? "quick" : "full",
      k: evalK,
      variants: variantList
    };
    activeRuns.set(placeholderRunId, job);

    // Run in background.
    runEvaluation({
      golden,
      filter: filterObj,
      k: evalK,
      variants: variantList,
      signal: controller.signal,
      onProgress: (p) => {
        job.lastProgress = p;
        broadcast(placeholderRunId, "progress", p);
      }
    }).then(async (payload) => {
      // Replace placeholder with the real runId from runEvaluation.
      const realRunId = payload.runId;
      job.status = "done";
      job.payload = payload;
      activeRuns.delete(placeholderRunId);
      activeRuns.set(realRunId, job);
      try {
        await saveRun(realRunId, payload);
      } catch (err) {
        console.warn(`[rag-eval] saveRun failed: ${err.message}`);
      }
      broadcast(placeholderRunId, "done", { runId: realRunId, summary: payload.summary });
      endStreams(placeholderRunId);
      // Drop after a short grace period so late polls can find it.
      setTimeout(() => activeRuns.delete(realRunId), 5 * 60 * 1000);
    }).catch((err) => {
      job.status = "error";
      job.error = err.message;
      broadcast(placeholderRunId, "error", { error: err.message });
      endStreams(placeholderRunId);
      setTimeout(() => activeRuns.delete(placeholderRunId), 60 * 1000);
    });

    res.status(202).json({ runId: placeholderRunId, startedAt, status: "running" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

ragEvalRouter.get("/runs/:id/stream", requireAdmin, (req, res) => {
  const job = activeRuns.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "run_not_found_or_finished" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Initial sync.
  res.write(`event: hello\ndata: ${JSON.stringify({ runId: req.params.id, startedAt: job.startedAt, status: job.status })}\n\n`);
  if (job.lastProgress) {
    res.write(`event: progress\ndata: ${JSON.stringify(job.lastProgress)}\n\n`);
  }

  if (job.status === "done") {
    res.write(`event: done\ndata: ${JSON.stringify({ runId: req.params.id, summary: job.payload?.summary || null })}\n\n`);
    res.end();
    return;
  }
  if (job.status === "error") {
    res.write(`event: error\ndata: ${JSON.stringify({ error: job.error })}\n\n`);
    res.end();
    return;
  }

  job.listeners.add(res);
  req.on("close", () => job.listeners.delete(res));
});

// ── Retrieval log summary ────────────────────────────────────────────────────

ragEvalRouter.get("/retrieval-log/summary", requireAdmin, async (req, res) => {
  try {
    const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 7));
    const profile = req.query.profile ? String(req.query.profile) : undefined;
    const notebookId = req.query.notebookId ? String(req.query.notebookId) : undefined;
    const summary = await summarizeRetrievalLog({ days, profile, notebookId });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
