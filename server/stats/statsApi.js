import express from "express";
import {
  readUsageLogs,
  aggregateSummary,
  aggregateByGroup,
  aggregateByNotebook,
  aggregateSessions
} from "./statsLogReader.js";

export const statsApiRouter = express.Router();

function parseRangeDays(query) {
  const raw = String(query?.range || "7d");
  const match = raw.match(/^(\d+)d$/);
  if (!match) return 7;
  const days = parseInt(match[1], 10);
  return Math.min(Math.max(days, 1), 365);
}

statsApiRouter.get("/summary", async (req, res) => {
  try {
    const days = parseRangeDays(req.query);
    const records = await readUsageLogs({ days });
    const kpi = aggregateSummary(records);
    res.json({ ok: true, range: `${days}d`, kpi });
  } catch (err) {
    console.error("[stats/summary]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

statsApiRouter.get("/groups", async (req, res) => {
  try {
    const days = parseRangeDays(req.query);
    const records = await readUsageLogs({ days });
    const groups = aggregateByGroup(records);
    res.json({ ok: true, range: `${days}d`, groups });
  } catch (err) {
    console.error("[stats/groups]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

statsApiRouter.get("/notebooks", async (req, res) => {
  try {
    const days = parseRangeDays(req.query);
    const records = await readUsageLogs({ days });
    const notebooks = aggregateByNotebook(records);
    res.json({ ok: true, range: `${days}d`, notebooks });
  } catch (err) {
    console.error("[stats/notebooks]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

statsApiRouter.get("/sessions", async (req, res) => {
  try {
    const days = parseRangeDays(req.query);
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
    const records = await readUsageLogs({ days });
    const result = aggregateSessions(records, { page, pageSize });
    res.json({ ok: true, range: `${days}d`, ...result });
  } catch (err) {
    console.error("[stats/sessions]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
