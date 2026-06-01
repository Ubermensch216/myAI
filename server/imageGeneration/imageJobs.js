import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageQueue } from "../modelQueue.js";
import { createAbortError } from "../abort.js";
import { generateImages } from "./imageProvider.js";
import { saveAsset } from "./imageAssets.js";

const JOB_TTL_MS = 30 * 60 * 1000; // keep finished jobs 30 min for polling
const MAX_JOBS = 500;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(rootDir, "data");
const JOBS_FILE = path.join(DATA_DIR, "image-jobs.json");

// Job store. Snapshots persist to disk so a Node restart keeps finished jobs
// pollable (their assets live on disk). In-flight jobs cannot be resumed — the
// worker request is gone with the old process — so they load back as errors.
const jobs = new Map();
loadJobs();

// Fields that are safe to serialize (the live AbortController is not).
function serializableJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    request: job.request,
    assets: job.assets,
    meta: job.meta,
    error: job.error,
    statusCode: job.statusCode ?? null
  };
}

function loadJobs() {
  try {
    const arr = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    for (const snap of arr) {
      if (!snap?.id) continue;
      const finished = snap.status === "done" || snap.status === "error";
      if (finished && now - (snap.updatedAt || 0) > JOB_TTL_MS) continue;
      const interrupted = snap.status === "queued" || snap.status === "running";
      jobs.set(snap.id, {
        ...snap,
        status: interrupted ? "error" : snap.status,
        error: interrupted ? "서버 재시작으로 중단되었습니다." : snap.error,
        statusCode: interrupted ? 503 : (snap.statusCode ?? null),
        updatedAt: interrupted ? now : snap.updatedAt,
        _controller: new AbortController()
      });
    }
  } catch {
    // Missing or corrupt file → start with an empty job store.
  }
}

let saveTimer = null;

/** Debounced atomic persist of the job snapshots. */
function scheduleJobSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistJobs().catch(() => {});
  }, 1000);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

async function persistJobs() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const arr = [...jobs.values()].map(serializableJob);
    const tmp = `${JOBS_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(arr), "utf8");
    await fsp.rename(tmp, JOBS_FILE);
  } catch {
    // Best-effort; persistence failure must not break generation.
  }
}

function newJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const finished = job.status === "done" || job.status === "error";
    if (finished && now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < oldest.length - MAX_JOBS; i++) jobs.delete(oldest[i][0]);
  }
}

/**
 * Create an async image-generation job. Returns the job id immediately; the
 * work runs on imageQueue (concurrency 1) so it never blocks the request or
 * the text queues.
 */
export function createImageJob(options) {
  pruneJobs();
  const id = newJobId();
  const controller = new AbortController();
  const job = {
    id,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    request: { prompt: options.prompt, stylePreset: options.stylePreset || null },
    assets: [],
    meta: null,
    error: null,
    _controller: controller
  };
  jobs.set(id, job);
  scheduleJobSave();

  // Fire-and-forget; failures are captured on the job.
  imageQueue
    .run(async () => {
      if (controller.signal.aborted) throw controller.signal.reason || createAbortError();
      job.status = "running";
      job.updatedAt = Date.now();
      scheduleJobSave();
      const result = await generateImages(options, { signal: controller.signal });
      const assets = [];
      for (const b64 of result.images) {
        assets.push(await saveAsset(b64, result.meta));
      }
      job.assets = assets;
      job.meta = sanitizeMeta(result.meta);
      job.status = "done";
      job.updatedAt = Date.now();
      scheduleJobSave();
    }, { signal: controller.signal, label: "image_generate" })
    .catch((error) => {
      job.status = "error";
      job.error = error?.message || "이미지 생성에 실패했습니다.";
      job.statusCode = error?.statusCode || 500;
      job.updatedAt = Date.now();
      scheduleJobSave();
    });

  return id;
}

export function getJobSnapshot(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    assets: job.assets,
    meta: job.meta,
    error: job.error,
    createdAt: new Date(job.createdAt).toISOString()
  };
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status === "queued" || job.status === "running") {
    job._controller.abort(createAbortError("이미지 생성이 취소되었습니다."));
    job.status = "error";
    job.error = "취소됨";
    job.updatedAt = Date.now();
    scheduleJobSave();
    return true;
  }
  return false;
}

function sanitizeMeta(meta = {}) {
  return {
    model: meta.model || null,
    tier: meta.tier || null,
    device: meta.device || null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    steps: meta.steps ?? null,
    seed: meta.seed ?? null,
    batch: meta.batch ?? null
  };
}
