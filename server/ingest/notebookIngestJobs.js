import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseUpload } from "../parsers.js";
import { addNotebookDocument } from "../notebooks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const JOBS_DIR = path.join(rootDir, "data", "ingest-jobs");
const JOB_ID_PATTERN = /^job_[a-f0-9]{16}$/;
const RECOVERABLE_STATUSES = new Set(["queued", "running"]);

export async function createNotebookIngestJob(notebookId, uploadFile) {
  if (!uploadFile?.path) throw new Error("Upload file is required.");
  const id = `job_${crypto.randomBytes(8).toString("hex")}`;
  const jobDir = path.join(JOBS_DIR, id);
  const uploadPath = path.join(jobDir, `upload${path.extname(uploadFile.originalname || "") || ".bin"}`);
  const job = {
    id,
    notebookId,
    status: "queued",
    stage: "queued",
    progress: 0,
    fileName: uploadFile.originalname,
    mimeType: uploadFile.mimetype,
    sizeBytes: uploadFile.size || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    uploadPath,
    document: null,
    error: ""
  };

  await fs.mkdir(jobDir, { recursive: true });
  await fs.rename(uploadFile.path, uploadPath);
  await writeJob(job);

  queueMicrotask(() => {
    runNotebookIngestJob(job.id, uploadPath).catch(() => {});
  });

  return publicJob(job);
}

export async function getNotebookIngestJob(notebookId, jobId) {
  const job = await readJob(jobId);
  if (!job || job.notebookId !== notebookId) return null;
  return publicJob(job);
}

export async function retryNotebookIngestJob(notebookId, jobId) {
  let job = await readJob(jobId);
  if (!job || job.notebookId !== notebookId) return null;
  if (job.status !== "failed") {
    throw new Error("실패한 작업만 재시도할 수 있습니다.");
  }
  if (!job.uploadPath) {
    throw new Error("재시도할 원본 업로드 파일이 남아 있지 않습니다.");
  }
  try {
    await fs.access(job.uploadPath);
  } catch {
    throw new Error("재시도할 원본 업로드 파일을 찾을 수 없습니다.");
  }

  job = await updateJob(job, {
    status: "queued",
    stage: "queued",
    progress: 0,
    startedAt: null,
    finishedAt: null,
    document: null,
    error: ""
  });

  queueMicrotask(() => {
    runNotebookIngestJob(job.id, job.uploadPath).catch(() => {});
  });

  return publicJob(job);
}

export async function listNotebookIngestJobs(notebookId) {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true }).catch(() => []);
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
    const job = await readJob(entry.name).catch(() => null);
    if (job?.notebookId === notebookId) jobs.push(publicJob(job));
  }
  jobs.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return jobs;
}

export async function recoverNotebookIngestJobs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true }).catch(() => []);
  const recovered = [];
  const failed = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
    let job = await readJob(entry.name).catch(() => null);
    if (!job || !RECOVERABLE_STATUSES.has(job.status)) continue;
    if (!job.uploadPath) {
      job = await markRecoveryFailed(job, "서버 재시작 후 복구할 원본 업로드 파일 경로가 없습니다.");
      failed.push(publicJob(job));
      continue;
    }
    try {
      await fs.access(job.uploadPath);
    } catch {
      job = await markRecoveryFailed(job, "서버 재시작 후 복구할 원본 업로드 파일을 찾을 수 없습니다.");
      failed.push(publicJob(job));
      continue;
    }

    job = await updateJob(job, {
      status: "queued",
      stage: "queued",
      progress: 0,
      startedAt: null,
      finishedAt: null,
      error: ""
    });
    recovered.push(publicJob(job));
    queueMicrotask(() => {
      runNotebookIngestJob(job.id, job.uploadPath).catch(() => {});
    });
  }

  return { recovered, failed };
}

async function runNotebookIngestJob(jobId, uploadPath) {
  let job = await readJob(jobId);
  if (!job) return;
  try {
    job = await updateJob(job, {
      status: "running",
      stage: "parsing",
      progress: 10,
      startedAt: new Date().toISOString()
    });

    const parsed = await parseUpload({
      path: uploadPath,
      originalname: job.fileName,
      mimetype: job.mimeType
    });

    job = await updateJob(job, { stage: "indexing", progress: 55 });
    const document = await addNotebookDocument(job.notebookId, parsed, async (processed, total) => {
      const pct = 55 + Math.round((processed / total) * 40);
      await updateJob(job, { progress: pct });
    });

    await updateJob(job, {
      status: "completed",
      stage: "completed",
      progress: 100,
      document,
      uploadPath: null,
      finishedAt: new Date().toISOString()
    });
    await fs.unlink(uploadPath).catch(() => {});
  } catch (error) {
    await updateJob(job, {
      status: "failed",
      stage: "failed",
      error: error.message,
      finishedAt: new Date().toISOString()
    }).catch(() => {});
  }
}

async function readJob(jobId) {
  if (!JOB_ID_PATTERN.test(String(jobId || ""))) return null;
  try {
    const raw = await fs.readFile(jobPath(jobId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function updateJob(job, patch) {
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeJob(next);
  return next;
}

async function markRecoveryFailed(job, message) {
  return updateJob(job, {
    status: "failed",
    stage: "failed",
    error: message,
    finishedAt: new Date().toISOString()
  });
}

async function writeJob(job) {
  await fs.mkdir(path.dirname(jobPath(job.id)), { recursive: true });
  await fs.writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, jobId, "job.json");
}

function publicJob(job) {
  return {
    id: job.id,
    notebookId: job.notebookId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    document: job.document,
    error: job.error
  };
}
