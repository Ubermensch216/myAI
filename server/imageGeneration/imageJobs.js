import crypto from "node:crypto";
import { imageQueue } from "../modelQueue.js";
import { createAbortError } from "../abort.js";
import { generateImages } from "./imageProvider.js";
import { saveAsset } from "./imageAssets.js";

const JOB_TTL_MS = 30 * 60 * 1000; // keep finished jobs 30 min for polling
const MAX_JOBS = 500;

// In-memory job store. Jobs are short-lived; assets persist on disk separately.
const jobs = new Map();

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

  // Fire-and-forget; failures are captured on the job.
  imageQueue
    .run(async () => {
      if (controller.signal.aborted) throw controller.signal.reason || createAbortError();
      job.status = "running";
      job.updatedAt = Date.now();
      const result = await generateImages(options, { signal: controller.signal });
      const assets = [];
      for (const b64 of result.images) {
        assets.push(await saveAsset(b64, result.meta));
      }
      job.assets = assets;
      job.meta = sanitizeMeta(result.meta);
      job.status = "done";
      job.updatedAt = Date.now();
    }, { signal: controller.signal, label: "image_generate" })
    .catch((error) => {
      job.status = "error";
      job.error = error?.message || "이미지 생성에 실패했습니다.";
      job.statusCode = error?.statusCode || 500;
      job.updatedAt = Date.now();
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
