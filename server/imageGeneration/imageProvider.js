import { loadLocalEnv } from "../env.js";
import { diffusersProvider } from "./diffusersProvider.js";
import { comfyImageProvider } from "./comfyImageProvider.js";

loadLocalEnv();

/**
 * Provider abstraction. Feature code (jobs, API, infographic asset planner)
 * calls imageProvider.* and never the worker directly, so the backend can be
 * swapped via IMAGE_PROVIDER (diffusers | comfyui).
 */
const PROVIDERS = {
  diffusers: diffusersProvider,
  comfyui: comfyImageProvider
};

function resolveProvider() {
  const name = String(process.env.IMAGE_PROVIDER || "diffusers").trim().toLowerCase();
  return PROVIDERS[name] || diffusersProvider;
}

export function getProviderName() {
  return resolveProvider().name;
}

export function isImageProviderConfigured() {
  return Boolean(process.env.IMAGE_WORKER_URL || resolveProvider().workerUrl);
}

export function generateImages(options, ctx = {}) {
  return resolveProvider().generate(options, ctx);
}

export function getWorkerHealth() {
  return resolveProvider().health();
}

export function getWorkerCapabilities() {
  return resolveProvider().capabilities();
}
