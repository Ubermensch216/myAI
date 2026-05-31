import express from "express";
import { getAccessFromRequest } from "../accessControl.js";
import { extractRequestToken } from "../auth.js";
import { logUsageEvent } from "../stats/statsLogger.js";
import { imageQueue } from "../modelQueue.js";
import {
  getProviderName,
  getWorkerCapabilities,
  getWorkerHealth,
  isImageProviderConfigured
} from "./imageProvider.js";
import { createImageJob, getJobSnapshot, cancelJob } from "./imageJobs.js";
import { deleteAsset, getAssetPath, startRetentionSweep } from "./imageAssets.js";
import {
  ImageSafetyError,
  getDailyLimit,
  releaseDailyQuota,
  reserveDailyQuota,
  validatePrompt
} from "./imageSafety.js";

startRetentionSweep();

export const imageApiRouter = express.Router();

imageApiRouter.post("/generate", async (request, response) => {
  let access = null;
  try {
    access = await getAccessFromRequest(request).catch(() => null);
    const prompt = validatePrompt(request.body?.prompt);
    reserveDailyQuota(access);

    const options = {
      prompt,
      negativePrompt: clampStr(request.body?.negativePrompt, 1000),
      stylePreset: clampStr(request.body?.stylePreset, 40) || null,
      width: toInt(request.body?.width),
      height: toInt(request.body?.height),
      steps: toInt(request.body?.steps),
      guidance: toNum(request.body?.guidance),
      seed: toInt(request.body?.seed),
      batch: clampBatch(request.body?.batch)
    };

    const jobId = createImageJob(options);

    logUsageEvent({
      rawToken: extractRequestToken(request),
      groupId: access?.groupId || "anon",
      level: access?.level != null ? `L${access.level}` : "anon",
      eventType: "image_generate",
      endpoint: "/api/image/generate",
      success: true
    }).catch(() => {});

    response.status(202).json({ jobId, status: "queued" });
  } catch (error) {
    if (error instanceof ImageSafetyError && error.statusCode !== 429) {
      releaseDailyQuota(access);
    }
    response.status(error.statusCode || 400).json({ error: error.message });
  }
});

imageApiRouter.get("/jobs/:jobId", (request, response) => {
  const snapshot = getJobSnapshot(request.params.jobId);
  if (!snapshot) {
    response.status(404).json({ error: "작업을 찾을 수 없습니다." });
    return;
  }
  response.json(snapshot);
});

imageApiRouter.post("/jobs/:jobId/cancel", (request, response) => {
  const cancelled = cancelJob(request.params.jobId);
  response.json({ ok: cancelled });
});

imageApiRouter.get("/assets/:assetId", async (request, response) => {
  const filePath = await getAssetPath(request.params.assetId);
  if (!filePath) {
    response.status(404).json({ error: "이미지를 찾을 수 없습니다." });
    return;
  }
  response.type("png");
  response.setHeader("Cache-Control", "private, max-age=3600");
  response.sendFile(filePath, (error) => {
    if (error && !response.headersSent) response.status(500).end();
  });
});

imageApiRouter.delete("/assets/:assetId", async (request, response) => {
  const ok = await deleteAsset(request.params.assetId);
  response.json({ ok });
});

/** Admin status payload (mounted at /api/admin/image/status by the main server). */
export async function getImageStatus() {
  const [worker, capabilities] = await Promise.all([
    getWorkerHealth(),
    getWorkerCapabilities()
  ]);
  return {
    provider: getProviderName(),
    configured: isImageProviderConfigured(),
    worker,
    capabilities,
    queue: imageQueue.stats(),
    dailyLimit: getDailyLimit()
  };
}

/** Lightweight availability summary for /api/status (no capabilities fetch). */
export async function getImageAvailability() {
  const worker = await getWorkerHealth();
  return {
    provider: getProviderName(),
    configured: isImageProviderConfigured(),
    available: Boolean(worker?.ok),
    tier: worker?.tier || null,
    model: worker?.model || null
  };
}

function clampStr(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampBatch(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(1, Math.trunc(n)));
}
