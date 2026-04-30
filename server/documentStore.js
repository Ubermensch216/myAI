import crypto from "node:crypto";
import { summarizeDocument } from "./documents.js";

// In-memory only by design. The browser is the source of truth: clients persist
// uploaded documents in IndexedDB (encrypted) and re-send the full payload on
// every /api/chat call. The server cache here is just a same-process convenience
// for /api/documents/:id and is expected to be empty after a restart.
const documents = new Map();

export function addDocument(document) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stored = { id, createdAt: now, ...document };
  documents.set(id, stored);
  return summarizeDocument(stored);
}

export function getDocument(id) {
  return documents.get(id) ?? null;
}

export function listDocuments() {
  return Array.from(documents.values()).map(summarizeDocument);
}

export function removeDocument(id) {
  return documents.delete(id);
}
