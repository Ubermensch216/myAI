import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function jobsDir(notebookId) {
  return path.join(rootDir, "data", "notebooks", notebookId, "graph-jobs");
}

function jobPath(notebookId, jobId) {
  return path.join(jobsDir(notebookId), `${jobId}.json`);
}

function eventsPath(notebookId, jobId) {
  return path.join(jobsDir(notebookId), `${jobId}.events.jsonl`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listJobFiles(notebookId) {
  try {
    const dir = jobsDir(notebookId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.endsWith(".events.json"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export function createRebuildJobId() {
  return `${safeTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;
}

export function persistRebuildJob(job) {
  if (!job?.notebookId || !job?.jobId) return;
  const dir = jobsDir(job.notebookId);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = jobPath(job.notebookId, job.jobId);
  const tmpPath = `${finalPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, finalPath);
}

export function appendRebuildJobEvent(notebookId, jobId, event) {
  if (!notebookId || !jobId) return;
  try {
    const dir = jobsDir(notebookId);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      at: new Date().toISOString(),
      ...event
    };
    fs.appendFileSync(eventsPath(notebookId, jobId), `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Best-effort operational telemetry only.
  }
}

export function readRebuildJob(notebookId, jobId) {
  if (!notebookId || !jobId) return null;
  return readJson(jobPath(notebookId, jobId));
}

export function listRebuildJobs(notebookId, limit = 20) {
  return listJobFiles(notebookId)
    .map(readJson)
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
    .slice(0, Math.max(1, Number(limit) || 20));
}

export function readLatestRebuildJob(notebookId) {
  return listRebuildJobs(notebookId, 1)[0] || null;
}
