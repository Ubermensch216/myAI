import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const DAILY_LIMIT = clampInt(process.env.IMAGE_DAILY_LIMIT_PER_USER, 50, 1, 100000);
const MAX_PROMPT_CHARS = 2000;

// In-memory per-user daily counters: key `${user}:${YYYY-MM-DD}` -> count.
// Resets naturally as the date key changes; pruned opportunistically.
const counters = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
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
}

/** Release a reserved slot when a job fails before doing real work. */
export function releaseDailyQuota(access) {
  const key = `${userKey(access)}:${today()}`;
  const used = counters.get(key) || 0;
  if (used > 0) counters.set(key, used - 1);
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
