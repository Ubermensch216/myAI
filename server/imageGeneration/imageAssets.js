import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const ASSET_DIR = path.join(rootDir, "data", "generated-assets");
const RETENTION_HOURS = clampInt(process.env.IMAGE_RETENTION_HOURS, 24, 1, 720);
const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;
const ASSET_ID_RE = /^img_[a-z0-9]+_[a-z0-9]+$/i;

let dirReady = null;

function ensureDir() {
  if (!dirReady) dirReady = fs.mkdir(ASSET_DIR, { recursive: true });
  return dirReady;
}

function newAssetId() {
  return `img_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

/**
 * Persist a base64 PNG as a server temp file. Returns the asset descriptor.
 * Browsers keep only this descriptor (assetId + meta), never the bytes.
 */
export async function saveAsset(base64Png, meta = {}) {
  await ensureDir();
  const assetId = newAssetId();
  const filePath = path.join(ASSET_DIR, `${assetId}.png`);
  await fs.writeFile(filePath, Buffer.from(base64Png, "base64"));
  return {
    assetId,
    width: meta.width ?? null,
    height: meta.height ?? null,
    seed: meta.seed ?? null
  };
}

/** Resolve an assetId to an on-disk path, or null if missing/invalid. */
export async function getAssetPath(assetId) {
  if (!ASSET_ID_RE.test(String(assetId || ""))) return null;
  const filePath = path.join(ASSET_DIR, `${assetId}.png`);
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

export async function deleteAsset(assetId) {
  if (!ASSET_ID_RE.test(String(assetId || ""))) return false;
  try {
    await fs.unlink(path.join(ASSET_DIR, `${assetId}.png`));
    return true;
  } catch {
    return false;
  }
}

/** Delete assets older than the retention window. */
export async function sweepExpiredAssets() {
  try {
    await ensureDir();
    const now = Date.now();
    const entries = await fs.readdir(ASSET_DIR);
    let removed = 0;
    for (const name of entries) {
      if (!name.endsWith(".png")) continue;
      const filePath = path.join(ASSET_DIR, name);
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > RETENTION_MS) {
          await fs.unlink(filePath);
          removed += 1;
        }
      } catch {
        /* ignore individual file errors */
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

let sweepTimer = null;

/** Start a periodic retention sweep (idempotent). */
export function startRetentionSweep() {
  if (sweepTimer) return;
  sweepExpiredAssets().catch(() => {});
  sweepTimer = setInterval(() => sweepExpiredAssets().catch(() => {}), 60 * 60 * 1000);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
