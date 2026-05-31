import { loadLocalEnv } from "../env.js";
import { createLinkedAbortController } from "../abort.js";

loadLocalEnv();

const WORKER_URL = (process.env.IMAGE_WORKER_URL || "http://127.0.0.1:7861").replace(/\/+$/, "");
const GEN_TIMEOUT_MS = clampInt(process.env.IMAGE_GEN_TIMEOUT_MS, 180000, 5000, 600000);
const HEALTH_TIMEOUT_MS = 2500;

/**
 * Diffusers image provider: thin client over the Python image-worker.
 * Implements the imageProvider interface (generate/health/capabilities).
 */
export const diffusersProvider = {
  name: "diffusers",
  workerUrl: WORKER_URL,

  async generate(options, { signal } = {}) {
    const body = {
      prompt: options.prompt,
      negative_prompt: options.negativePrompt || "",
      style_preset: options.stylePreset || null,
      width: options.width ?? null,
      height: options.height ?? null,
      steps: options.steps ?? null,
      guidance: options.guidance ?? null,
      seed: Number.isInteger(options.seed) ? options.seed : null,
      batch: options.batch ?? 1
    };

    const controller = createLinkedAbortController(signal, GEN_TIMEOUT_MS, "Image generation timed out.");
    try {
      const response = await fetch(`${WORKER_URL}/generate`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const detail = await safeDetail(response);
        const error = new Error(`image worker /generate failed: ${response.status} ${detail}`.trim());
        if (response.status === 400) error.statusCode = 400;
        throw error;
      }
      const payload = await response.json();
      const images = Array.isArray(payload?.images) ? payload.images : [];
      if (!images.length) throw new Error("image worker returned no images");
      return { images, meta: payload.meta || {} };
    } finally {
      controller.cleanup();
    }
  },

  async health() {
    const controller = createLinkedAbortController(null, HEALTH_TIMEOUT_MS, "image worker health timed out");
    try {
      const response = await fetch(`${WORKER_URL}/health`, { signal: controller.signal });
      if (!response.ok) return { ok: false, error: `status ${response.status}` };
      const data = await response.json();
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      controller.cleanup();
    }
  },

  async capabilities() {
    const controller = createLinkedAbortController(null, HEALTH_TIMEOUT_MS, "image worker capabilities timed out");
    try {
      const response = await fetch(`${WORKER_URL}/capabilities`, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      controller.cleanup();
    }
  }
};

async function safeDetail(response) {
  try {
    const data = await response.json();
    return String(data?.detail || data?.error || "").slice(0, 200);
  } catch {
    return "";
  }
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
