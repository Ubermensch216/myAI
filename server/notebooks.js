import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chunkDocumentSections } from "./chunking.js";
import { embedTexts } from "./embeddings.js";
import { analyzeDocument } from "./documentAnalysis.js";
import {
  deleteNotebookDocumentVectors,
  deleteNotebookVectors,
  getQdrantConfig,
  upsertNotebookDocumentVectors
} from "./indexes/qdrantVectorIndex.js";
import {
  deleteNotebookDocumentLexical,
  deleteNotebookLexical,
  upsertNotebookDocumentLexical
} from "./indexes/sqliteFtsIndex.js";
import { resolvedDepartmentBackend } from "./rag/ragConfig.js";
import { normalizeNotebookAccessPolicy } from "./accessControl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const NOTEBOOKS_DIR = path.join(rootDir, "data", "notebooks");
const NOTEBOOK_CHUNK_CACHE_MAX = Number(process.env.NOTEBOOK_CHUNK_CACHE_MAX || 4);
const EMBED_INGEST_BATCH_SIZE = Math.max(1, Number(process.env.EMBED_INGEST_BATCH_SIZE || 16));
const EMBED_INGEST_MAX_ATTEMPTS = Math.max(1, Number(process.env.EMBED_INGEST_MAX_ATTEMPTS || 2));
const EMBED_MODEL_NAME = process.env.EMBED_MODEL || "bge-m3";
const NOTEBOOK_ID_PATTERN = /^nb_[a-f0-9]{16}$/;
const DOCUMENT_ID_PATTERN = /^doc_[a-f0-9]{16}$/;
const notebookChunkCache = new Map();

async function ensureNotebooksDir() {
  await fs.mkdir(NOTEBOOKS_DIR, { recursive: true });
}

function notebookDir(notebookId) {
  const id = requireNotebookId(notebookId);
  return resolveInsideNotebooks(id);
}

function manifestPath(notebookId) {
  return path.join(notebookDir(notebookId), "manifest.json");
}

function docsDir(notebookId) {
  return path.join(notebookDir(notebookId), "docs");
}

function docPath(notebookId, documentId) {
  const id = requireDocumentId(documentId);
  return path.join(docsDir(notebookId), `${id}.json`);
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeNotebookId(value) {
  const id = String(value ?? "").trim();
  return NOTEBOOK_ID_PATTERN.test(id) ? id : null;
}

function normalizeDocumentId(value) {
  const id = String(value ?? "").trim();
  return DOCUMENT_ID_PATTERN.test(id) ? id : null;
}

function requireNotebookId(value) {
  const id = normalizeNotebookId(value);
  if (!id) throw new Error("Invalid notebook id.");
  return id;
}

function requireDocumentId(value) {
  const id = normalizeDocumentId(value);
  if (!id) throw new Error("Invalid document id.");
  return id;
}

function resolveInsideNotebooks(...segments) {
  const root = path.resolve(NOTEBOOKS_DIR);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Notebook path escaped storage root.");
  }
  return target;
}

async function readManifest(notebookId) {
  if (!normalizeNotebookId(notebookId)) return null;
  try {
    const raw = await fs.readFile(manifestPath(notebookId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeManifest(notebookId, manifest) {
  await fs.mkdir(notebookDir(notebookId), { recursive: true });
  await fs.writeFile(manifestPath(notebookId), JSON.stringify(manifest, null, 2), "utf8");
}

function summarizeNotebook(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description || "",
    access: normalizeNotebookAccessPolicy(manifest.access),
    documentCount: Array.isArray(manifest.documents) ? manifest.documents.length : 0,
    updatedAt: manifest.updatedAt || manifest.createdAt
  };
}

function summarizeDocument(documentEntry) {
  return {
    id: documentEntry.id,
    name: documentEntry.name,
    type: documentEntry.type,
    chunkCount: documentEntry.chunkCount || 0,
    sizeBytes: documentEntry.sizeBytes || 0,
    addedAt: documentEntry.addedAt,
    summary: documentEntry.summary || "",
    topics: Array.isArray(documentEntry.topics) ? documentEntry.topics : []
  };
}

function notebookCacheKey(manifest) {
  const documents = manifest.documents || [];
  return [
    manifest.updatedAt || manifest.createdAt || "",
    ...documents.map((entry) => `${entry.id}:${entry.chunkCount || 0}:${entry.sizeBytes || 0}`)
  ].join("|");
}

function invalidateNotebookCache(notebookId) {
  const id = normalizeNotebookId(notebookId);
  if (id) notebookChunkCache.delete(id);
}

function touchNotebookCache(notebookId, cacheEntry) {
  notebookChunkCache.delete(notebookId);
  notebookChunkCache.set(notebookId, cacheEntry);
  while (notebookChunkCache.size > NOTEBOOK_CHUNK_CACHE_MAX) {
    const oldestKey = notebookChunkCache.keys().next().value;
    notebookChunkCache.delete(oldestKey);
  }
}

function flattenNotebookChunk(entry, chunk) {
  const flattened = {
    text: chunk.text,
    documentId: entry.id,
    documentName: entry.name,
    documentType: entry.type,
    page: chunk.page,
    label: chunk.label,
    part: chunk.part,
    partTotal: chunk.partTotal,
    chunkIndex: chunk.index,
    locator: formatLocator(chunk)
  };
  if (Array.isArray(chunk.embedding)) {
    flattened.embedding = chunk.embedding;
  }
  return flattened;
}

async function loadNotebookChunks(notebookId, manifest) {
  const cacheKey = notebookCacheKey(manifest);
  const cached = notebookChunkCache.get(notebookId);
  if (cached?.key === cacheKey) {
    touchNotebookCache(notebookId, cached);
    return cached.chunks;
  }

  const chunks = [];
  for (const entry of manifest.documents || []) {
    const record = await loadDocumentRecord(notebookId, entry.id);
    if (!record) continue;
    for (const chunk of record.chunks || []) {
      chunks.push(flattenNotebookChunk(entry, chunk));
    }
  }

  touchNotebookCache(notebookId, { key: cacheKey, chunks });
  return chunks;
}

export async function listNotebooks() {
  await ensureNotebooksDir();
  const entries = await fs.readdir(NOTEBOOKS_DIR, { withFileTypes: true });
  const notebooks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(entry.name).catch(() => null);
    if (manifest && manifest.id) notebooks.push(summarizeNotebook(manifest));
  }
  notebooks.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return notebooks;
}

export async function getNotebook(notebookId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return null;
  return {
    ...summarizeNotebook(manifest),
    createdAt: manifest.createdAt,
    documents: (manifest.documents || []).map(summarizeDocument)
  };
}

export async function createNotebook({ name, description }) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new Error("프로젝트 이름이 필요합니다.");
  if (cleanName.length > 80) throw new Error("프로젝트 이름은 80자 이내여야 합니다.");

  const cleanDescription = String(description ?? "").trim().slice(0, 400);
  const now = new Date().toISOString();
  const id = generateId("nb");
  const manifest = {
    id,
    name: cleanName,
    description: cleanDescription,
    access: normalizeNotebookAccessPolicy(null),
    createdAt: now,
    updatedAt: now,
    documents: []
  };

  await fs.mkdir(docsDir(id), { recursive: true });
  await writeManifest(id, manifest);
  return summarizeNotebook(manifest);
}

export async function updateNotebook(notebookId, { name, description }) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return null;

  if (typeof name === "string") {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("프로젝트 이름이 필요합니다.");
    if (cleanName.length > 80) throw new Error("프로젝트 이름은 80자 이내여야 합니다.");
    manifest.name = cleanName;
  }
  if (typeof description === "string") {
    manifest.description = description.trim().slice(0, 400);
  }
  manifest.updatedAt = new Date().toISOString();

  await writeManifest(notebookId, manifest);
  return summarizeNotebook(manifest);
}

export async function updateNotebookAccess(notebookId, access) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return null;
  manifest.access = normalizeNotebookAccessPolicy(access);
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(notebookId, manifest);
  return {
    ...summarizeNotebook(manifest),
    createdAt: manifest.createdAt,
    documents: (manifest.documents || []).map(summarizeDocument)
  };
}

export async function deleteNotebook(notebookId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return false;
  await fs.rm(notebookDir(notebookId), { recursive: true, force: true });
  invalidateNotebookCache(notebookId);
  await removeNotebookVectorIndex(notebookId);
  await removeNotebookLexicalIndex(notebookId);
  return true;
}

async function ingestEmbeddingsBatched(chunks, expectedDim, onBatchDone = null) {
  const result = {
    embeddedCount: 0,
    failedCount: 0,
    dim: Number.isFinite(expectedDim) ? expectedDim : null,
    errors: []
  };
  for (let start = 0; start < chunks.length; start += EMBED_INGEST_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_INGEST_BATCH_SIZE);
    const texts = batch.map((c) => c.text);
    let vectors = null;
    let lastError = null;
    for (let attempt = 0; attempt < EMBED_INGEST_MAX_ATTEMPTS; attempt += 1) {
      try {
        vectors = await embedTexts(texts, {
          expectedDim: result.dim ?? undefined
        });
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!vectors) {
      result.failedCount += batch.length;
      result.errors.push(`batch@${start}: ${lastError?.message || "unknown"}`);
    } else {
      if (result.dim == null && vectors[0]?.length) {
        result.dim = vectors[0].length;
      }
      for (let i = 0; i < batch.length; i += 1) {
        batch[i].embedding = vectors[i];
      }
      result.embeddedCount += batch.length;
    }
    if (onBatchDone) await onBatchDone(start + batch.length, chunks.length);
  }
  return result;
}

export async function addNotebookDocument(notebookId, parsedDocument, onProgress = null) {
  const manifest = await readManifest(notebookId);
  if (!manifest) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (!parsedDocument || parsedDocument.kind !== "document") {
    throw new Error("이미지가 아닌 문서 파일만 프로젝트에 추가할 수 있습니다.");
  }

  const id = generateId("doc");
  const chunks = chunkDocumentSections(parsedDocument);

  if (!chunks.length) {
    throw new Error("문서에서 본문 텍스트를 추출하지 못했습니다.");
  }

  const startedAt = new Date().toISOString();
  const ingestResult = await ingestEmbeddingsBatched(chunks, manifest.embedding?.dim ?? null, onProgress);
  const finishedAt = new Date().toISOString();

  if (
    manifest.embedding?.dim &&
    ingestResult.dim &&
    manifest.embedding.dim !== ingestResult.dim
  ) {
    throw new Error(
      `임베딩 차원 불일치: 프로젝트=${manifest.embedding.dim}, 새 문서=${ingestResult.dim}. 동일한 임베딩 모델을 사용하세요.`
    );
  }

  if (ingestResult.errors.length) {
    console.warn(
      `[notebooks] 임베딩 부분 실패: ${ingestResult.embeddedCount}/${chunks.length} 성공. ${ingestResult.errors.join(" | ")}`
    );
  }

  const ingestStatus = ingestResult.failedCount === 0
    ? "completed"
    : ingestResult.embeddedCount > 0 ? "partial" : "failed_embedding";

  const analysis = await analyzeDocument(parsedDocument).catch((err) => {
    console.warn(`[notebooks] 문서 사전 분석 실패 (요약 없이 진행): ${err.message}`);
    return { summary: "", topics: [] };
  });

  const now = new Date().toISOString();
  const documentRecord = {
    id,
    notebookId,
    name: parsedDocument.fileName,
    type: parsedDocument.fileType,
    addedAt: now,
    chunkCount: chunks.length,
    summary: analysis.summary,
    topics: analysis.topics,
    embedding: ingestResult.dim
      ? { model: EMBED_MODEL_NAME, dim: ingestResult.dim }
      : null,
    ingest: {
      status: ingestStatus,
      chunkCount: chunks.length,
      embeddedCount: ingestResult.embeddedCount,
      failedCount: ingestResult.failedCount,
      startedAt,
      finishedAt
    },
    chunks
  };

  await fs.mkdir(docsDir(notebookId), { recursive: true });
  const serialized = JSON.stringify(documentRecord);
  await fs.writeFile(docPath(notebookId, id), serialized, "utf8");

  manifest.documents = manifest.documents || [];
  manifest.documents.push({
    id,
    name: documentRecord.name,
    type: documentRecord.type,
    addedAt: now,
    chunkCount: chunks.length,
    sizeBytes: Buffer.byteLength(serialized, "utf8"),
    summary: analysis.summary,
    topics: analysis.topics,
    ingest: documentRecord.ingest
  });
  if (!manifest.embedding && ingestResult.dim) {
    manifest.embedding = {
      model: EMBED_MODEL_NAME,
      dim: ingestResult.dim,
      createdAt: now,
      lastValidatedAt: now
    };
  } else if (manifest.embedding && ingestResult.dim) {
    manifest.embedding.lastValidatedAt = now;
  }
  manifest.updatedAt = now;
  await writeManifest(notebookId, manifest);
  invalidateNotebookCache(notebookId);
  await syncNotebookDocumentVectorIndex(notebookId, documentRecord, manifest);
  await syncNotebookDocumentLexicalIndex(notebookId, documentRecord);

  return summarizeDocument(manifest.documents.at(-1));
}

export async function removeNotebookDocument(notebookId, documentId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return false;
  const before = manifest.documents?.length ?? 0;
  manifest.documents = (manifest.documents || []).filter((entry) => entry.id !== documentId);
  if (manifest.documents.length === before) return false;

  manifest.updatedAt = new Date().toISOString();
  await writeManifest(notebookId, manifest);
  await fs.unlink(docPath(notebookId, documentId)).catch(() => {});
  invalidateNotebookCache(notebookId);
  await removeNotebookDocumentVectorIndex(notebookId, documentId);
  await removeNotebookDocumentLexicalIndex(notebookId, documentId);
  return true;
}

async function syncNotebookDocumentVectorIndex(notebookId, documentRecord, manifest) {
  if (!getQdrantConfig().configured) return;
  try {
    const result = await upsertNotebookDocumentVectors({
      notebookId,
      documentRecord,
      embeddingModel: documentRecord.embedding?.model || manifest.embedding?.model || EMBED_MODEL_NAME,
      embeddingDim: documentRecord.embedding?.dim || manifest.embedding?.dim
    });
    if (!result.ok) {
      console.warn(`[notebooks] Qdrant index skipped for ${documentRecord.id}: ${result.reason}`);
    }
  } catch (error) {
    console.warn(`[notebooks] Qdrant index sync failed for ${documentRecord.id}: ${error.message}`);
  }
}

async function removeNotebookDocumentVectorIndex(notebookId, documentId) {
  if (!getQdrantConfig().configured) return;
  try {
    const result = await deleteNotebookDocumentVectors({ notebookId, documentId });
    if (!result.ok) {
      console.warn(`[notebooks] Qdrant delete skipped for ${documentId}: ${result.reason}`);
    }
  } catch (error) {
    console.warn(`[notebooks] Qdrant delete failed for ${documentId}: ${error.message}`);
  }
}

async function removeNotebookVectorIndex(notebookId) {
  if (!getQdrantConfig().configured) return;
  try {
    const result = await deleteNotebookVectors({ notebookId });
    if (!result.ok) {
      console.warn(`[notebooks] Qdrant notebook delete skipped for ${notebookId}: ${result.reason}`);
    }
  } catch (error) {
    console.warn(`[notebooks] Qdrant notebook delete failed for ${notebookId}: ${error.message}`);
  }
}

async function syncNotebookDocumentLexicalIndex(notebookId, documentRecord) {
  if (resolvedDepartmentBackend().lexical !== "sqlite") return;
  try {
    const result = await upsertNotebookDocumentLexical({ notebookId, documentRecord });
    if (!result.ok) {
      console.warn(`[notebooks] SQLite FTS index skipped for ${documentRecord.id}: ${result.reason}`);
    }
  } catch (error) {
    console.warn(`[notebooks] SQLite FTS index sync failed for ${documentRecord.id}: ${error.message}`);
  }
}

async function removeNotebookDocumentLexicalIndex(notebookId, documentId) {
  if (resolvedDepartmentBackend().lexical !== "sqlite") return;
  try {
    await deleteNotebookDocumentLexical({ notebookId, documentId });
  } catch (error) {
    console.warn(`[notebooks] SQLite FTS delete failed for ${documentId}: ${error.message}`);
  }
}

async function removeNotebookLexicalIndex(notebookId) {
  if (resolvedDepartmentBackend().lexical !== "sqlite") return;
  try {
    await deleteNotebookLexical({ notebookId });
  } catch (error) {
    console.warn(`[notebooks] SQLite FTS notebook delete failed for ${notebookId}: ${error.message}`);
  }
}

async function loadDocumentRecord(notebookId, documentId) {
  try {
    const raw = await fs.readFile(docPath(notebookId, documentId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Read the raw notebook manifest. Department RAG (server/rag/departmentRag.js)
 * needs this to access manifest.embedding.dim and manifest.documents — fields
 * that getNotebookManifestSummary intentionally hides. Manifest stays the
 * source-of-truth even when Sprint 2 introduces Qdrant.
 */
export async function getNotebookManifest(notebookId) {
  return readManifest(notebookId);
}

/**
 * Load notebook chunks pre-flattened for retrieval, with locator strings and
 * embeddings inlined. Used by department RAG search.
 */
export async function loadNotebookChunksForRetrieval(notebookId, manifest) {
  return loadNotebookChunks(notebookId, manifest);
}

export async function loadNotebookDocumentRecords(notebookId, manifest = null) {
  const source = manifest || await readManifest(notebookId);
  if (!source) return [];
  const records = [];
  for (const entry of source.documents || []) {
    const record = await loadDocumentRecord(notebookId, entry.id);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Public alias of the internal summarize helper, exposed for the RAG layer
 * so it can shape the response without re-implementing the projection.
 */
export function summarizeNotebookManifest(manifest) {
  return summarizeNotebook(manifest);
}

function formatLocator(chunk) {
  const parts = [];
  if (chunk.label) parts.push(chunk.label);
  if (chunk.page != null) parts.push(`${chunk.page}쪽`);
  if (chunk.part) parts.push(`part ${chunk.part}/${chunk.partTotal}`);
  return parts.join(" · ");
}

/**
 * Return every chunk in a notebook, flattened across documents.
 * Used by Map-Reduce analysis where retrieval is bypassed and the entire
 * notebook is processed in batches. Returns [] if the notebook is missing
 * or empty.
 */
export async function loadAllNotebookChunks(notebookId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return [];
  return loadNotebookChunks(notebookId, manifest);
}

export async function getNotebookManifestSummary(notebookId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return null;
  return summarizeNotebook(manifest);
}

