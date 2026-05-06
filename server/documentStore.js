import crypto from "node:crypto";
import { summarizeDocument } from "./documents.js";
import { loadLocalEnv } from "./env.js";

loadLocalEnv();

// In-memory only by design. The browser is the source of truth: clients persist
// uploaded documents in IndexedDB (encrypted) and re-send the full payload on
// every /api/chat call. The server cache here is just a same-process convenience
// for same-browser /api/documents/:id hydration and is expected to be empty
// after a restart.
const documents = new Map();
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const DOCUMENT_CACHE_TTL_MS = clampInt(
  process.env.DOCUMENT_CACHE_TTL_MS,
  DEFAULT_CACHE_TTL_MS,
  60_000,
  24 * 60 * 60 * 1000
);
const DOCUMENT_CACHE_MAX_ENTRIES = clampInt(
  process.env.DOCUMENT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_ENTRIES,
  1,
  5000
);

export function addDocument(document, options = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stored = {
    id,
    createdAt: now,
    cachedAt: now,
    lastAccessedAt: now,
    expiresAt: new Date(Date.now() + DOCUMENT_CACHE_TTL_MS).toISOString(),
    ownerKey: normalizeOwnerKey(options.ownerKey),
    ...document
  };
  documents.set(id, stored);
  pruneDocumentCache();
  return summarizeDocument(stored);
}

export function getDocument(id, options = {}) {
  pruneDocumentCache();
  const document = documents.get(id);
  if (!document || !canAccessDocument(document, options.ownerKey)) return null;
  document.lastAccessedAt = new Date().toISOString();
  return document;
}

export function getCachedDocumentUnsafe(id) {
  pruneDocumentCache();
  return documents.get(id) ?? null;
}

export function removeDocument(id, options = {}) {
  pruneDocumentCache();
  const document = documents.get(id);
  if (!document || !canAccessDocument(document, options.ownerKey)) return false;
  return documents.delete(id);
}

function canAccessDocument(document, ownerKey) {
  const expected = normalizeOwnerKey(document.ownerKey);
  const provided = normalizeOwnerKey(ownerKey);
  return Boolean(expected && provided && timingSafeEqual(expected, provided));
}

function normalizeOwnerKey(value) {
  return String(value ?? "").trim().slice(0, 128);
}

function pruneDocumentCache() {
  const now = Date.now();
  for (const [id, document] of documents) {
    if (Date.parse(document.expiresAt || "") <= now) documents.delete(id);
  }
  while (documents.size > DOCUMENT_CACHE_MAX_ENTRIES) {
    const oldest = Array.from(documents.entries())
      .sort((left, right) =>
        Date.parse(left[1].lastAccessedAt || left[1].cachedAt || 0)
        - Date.parse(right[1].lastAccessedAt || right[1].cachedAt || 0)
      )[0];
    if (!oldest) break;
    documents.delete(oldest[0]);
  }
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
