import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const DAILY_LIMIT = clampInt(process.env.IMAGE_DAILY_LIMIT_PER_USER, 50, 1, 100000);
const MAX_PROMPT_CHARS = 2000;

// Defense-in-depth blocklist (the worker also enforces its own). Refuses
// obviously disallowed intent: explicit content and official-document forgery.
// NOTE: coarse by design — tune per deployment policy. See docs/IMAGE_GENERATION.md
// (Security) for how to extend this for closed-network / public-sector policy.
const BLOCKED_RE = /\bnsfw\b|\bnude\b|\bnaked\b|\bporn\w*|\bsexual\b|위조|가짜\s*공문|\bforged?\b/i;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(rootDir, "data");
const QUOTA_FILE = path.join(DATA_DIR, "image-quota.json");

// Per-user daily counters: key `${group}:${level}:${YYYY-MM-DD}` -> count.
// Persisted to disk so a Node restart does not reset quotas (which would let
// users bypass the daily cap). The key bucket is group+level, not an individual
// user id — see docs/IMAGE_GENERATION.md (Operations & Resilience).
const counters = new Map();
loadCounters();

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Load today's counters from disk at startup; stale days are dropped. */
function loadCounters() {
  try {
    const obj = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8"));
    const day = today();
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "number" && value > 0 && key.endsWith(`:${day}`)) {
        counters.set(key, value);
      }
    }
  } catch {
    // Missing or corrupt file → start with an empty quota table.
  }
}

let saveTimer = null;

/** Debounced atomic persist of the counter table. Quota is soft; best-effort. */
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistCounters().catch(() => {});
  }, 1000);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

async function persistCounters() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${QUOTA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(Object.fromEntries(counters)), "utf8");
    await fsp.rename(tmp, QUOTA_FILE);
  } catch {
    // Best-effort; an unwritable data dir must not break generation.
  }
}

function userKey(access) {
  const group = access?.groupId || "anon";
  const level = access?.level != null ? `L${access.level}` : "anon";
  return `${group}:${level}`;
}

export class ImageSafetyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ImageSafetyError";
    this.statusCode = statusCode;
  }
}

export function validatePrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) throw new ImageSafetyError("프롬프트를 입력하세요.");
  if (text.length > MAX_PROMPT_CHARS) {
    throw new ImageSafetyError(`프롬프트가 너무 깁니다 (최대 ${MAX_PROMPT_CHARS}자).`);
  }
  if (BLOCKED_RE.test(text)) {
    throw new ImageSafetyError("콘텐츠 정책에 따라 거부된 프롬프트입니다.");
  }
  return text;
}

/** Throw if the user exceeded the daily cap; otherwise reserve one slot. */
export function reserveDailyQuota(access) {
  const day = today();
  const key = `${userKey(access)}:${day}`;
  const used = counters.get(key) || 0;
  if (used >= DAILY_LIMIT) {
    throw new ImageSafetyError(`일일 이미지 생성 한도(${DAILY_LIMIT}건)를 초과했습니다.`, 429);
  }
  counters.set(key, used + 1);
  pruneStaleCounters(day);
  scheduleSave();
}

/** Release a reserved slot when a job fails before doing real work. */
export function releaseDailyQuota(access) {
  const key = `${userKey(access)}:${today()}`;
  const used = counters.get(key) || 0;
  if (used > 0) counters.set(key, used - 1);
  scheduleSave();
}

function pruneStaleCounters(currentDay) {
  if (counters.size < 256) return;
  for (const key of counters.keys()) {
    if (!key.endsWith(`:${currentDay}`)) counters.delete(key);
  }
}

export function getDailyLimit() {
  return DAILY_LIMIT;
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
