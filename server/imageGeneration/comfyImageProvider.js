import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.js";
import { createLinkedAbortController } from "../abort.js";

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

const COMFY_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const GEN_TIMEOUT_MS = clampInt(process.env.IMAGE_GEN_TIMEOUT_MS, 180000, 5000, 600000);
const HEALTH_TIMEOUT_MS = 2500;
const WORKFLOW_TEXT2IMG = process.env.COMFYUI_WORKFLOW_TEXT2IMG || "";

/**
 * ComfyUI image provider (advanced workflows: text2img, ControlNet, upscale).
 * Implements the same interface as diffusersProvider. Generation requires a
 * pinned workflow JSON (COMFYUI_WORKFLOW_TEXT2IMG) whose placeholder tokens are
 * substituted per request. Keep workflows version-pinned and custom nodes on an
 * allowlist (see docs/IMAGE_GENERATION.md).
 *
 * NOTE: This is interface-complete and config-driven. Validate the workflow
 * graph against your ComfyUI install before enabling IMAGE_PROVIDER=comfyui.
 */
export const comfyImageProvider = {
  name: "comfyui",
  workerUrl: COMFY_URL,

  async generate(options, { signal } = {}) {
    const workflow = await loadWorkflow();
    const graph = substituteWorkflow(workflow, options);
    const controller = createLinkedAbortController(signal, GEN_TIMEOUT_MS, "ComfyUI generation timed out.");
    try {
      const queued = await fetchJson(`${COMFY_URL}/prompt`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: graph })
      });
      const promptId = queued?.prompt_id;
      if (!promptId) throw new Error("ComfyUI did not return a prompt_id");
      const images = await pollHistory(promptId, controller.signal);
      if (!images.length) throw new Error("ComfyUI returned no images");
      return {
        images,
        meta: { model: "comfyui", tier: "comfyui", device: "comfyui", seed: options.seed ?? null, batch: images.length }
      };
    } finally {
      controller.cleanup();
    }
  },

  async health() {
    const controller = createLinkedAbortController(null, HEALTH_TIMEOUT_MS, "ComfyUI health timed out");
    try {
      const response = await fetch(`${COMFY_URL}/system_stats`, { signal: controller.signal });
      if (!response.ok) return { ok: false, error: `status ${response.status}` };
      return { ok: true, model: "comfyui", tier: "comfyui", workflowConfigured: Boolean(WORKFLOW_TEXT2IMG) };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      controller.cleanup();
    }
  },

  async capabilities() {
    const health = await this.health();
    if (!health.ok) return null;
    return {
      tier: "comfyui",
      model: "comfyui",
      device: "comfyui",
      max_width: clampInt(process.env.IMAGE_MAX_WIDTH, 1024, 256, 4096),
      max_height: clampInt(process.env.IMAGE_MAX_HEIGHT, 1024, 256, 4096),
      max_batch: clampInt(process.env.IMAGE_MAX_BATCH, 4, 1, 8),
      default_steps: 20,
      style_presets: []
    };
  }
};

async function loadWorkflow() {
  if (!WORKFLOW_TEXT2IMG) {
    throw new Error("COMFYUI_WORKFLOW_TEXT2IMG is not configured. Pin a workflow JSON to enable ComfyUI.");
  }
  const filePath = path.isAbsolute(WORKFLOW_TEXT2IMG) ? WORKFLOW_TEXT2IMG : path.join(rootDir, WORKFLOW_TEXT2IMG);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

// Replace placeholder tokens (e.g. "%PROMPT%") in the workflow graph with the
// request values. The pinned workflow controls which nodes receive them.
function substituteWorkflow(workflow, options) {
  const replacements = {
    "%PROMPT%": options.prompt || "",
    "%NEGATIVE%": options.negativePrompt || "",
    "%WIDTH%": options.width || 1024,
    "%HEIGHT%": options.height || 1024,
    "%STEPS%": options.steps || 20,
    "%SEED%": Number.isInteger(options.seed) ? options.seed : Math.floor(Math.random() * 2 ** 31),
    "%BATCH%": options.batch || 1
  };
  const json = JSON.stringify(workflow);
  const substituted = json.replace(/%PROMPT%|%NEGATIVE%|%WIDTH%|%HEIGHT%|%STEPS%|%SEED%|%BATCH%/g, (token) => {
    const value = replacements[token];
    return typeof value === "string" ? value.replace(/"/g, '\\"') : String(value);
  });
  return JSON.parse(substituted);
}

async function pollHistory(promptId, signal) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (signal?.aborted) throw new Error("aborted");
    await sleep(1000);
    const history = await fetchJson(`${COMFY_URL}/history/${promptId}`, { signal }).catch(() => null);
    const entry = history?.[promptId];
    if (!entry) continue;
    const outputs = entry.outputs || {};
    const images = [];
    for (const nodeId of Object.keys(outputs)) {
      for (const img of outputs[nodeId]?.images || []) {
        const b64 = await fetchImageBase64(img, signal).catch(() => null);
        if (b64) images.push(b64);
      }
    }
    if (images.length) return images;
    if (entry.status?.completed) return images;
  }
  throw new Error("ComfyUI generation timed out while polling history");
}

async function fetchImageBase64(img, signal) {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output"
  });
  const response = await fetch(`${COMFY_URL}/view?${params.toString()}`, { signal });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ComfyUI ${url} failed: ${response.status} ${text.slice(0, 160)}`.trim());
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
