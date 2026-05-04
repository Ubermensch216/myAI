import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { slidingChunkText } from "./parsers.js";
import { multiQueryHybridSelect, greedyFit } from "./retrieval.js";
import { pageSections } from "./documents.js";
import { embedTexts } from "./embeddings.js";
import { expandQuery } from "./queryExpansion.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const NOTEBOOKS_DIR = path.join(rootDir, "data", "notebooks");
const CHUNK_WINDOW_CHARS = Number(process.env.CHUNK_WINDOW_CHARS || process.env.CHUNK_TARGET_CHARS || 1024);
const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS || 256);
const NOTEBOOK_QUERY_BUDGET = Number(process.env.NOTEBOOK_QUERY_BUDGET || 12000);
const NOTEBOOK_ID_PATTERN = /^nb_[a-f0-9]{16}$/;
const DOCUMENT_ID_PATTERN = /^doc_[a-f0-9]{16}$/;

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
    addedAt: documentEntry.addedAt
  };
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
  if (!cleanName) throw new Error("노트북 이름이 필요합니다.");
  if (cleanName.length > 80) throw new Error("노트북 이름은 80자 이내여야 합니다.");

  const cleanDescription = String(description ?? "").trim().slice(0, 400);
  const now = new Date().toISOString();
  const id = generateId("nb");
  const manifest = {
    id,
    name: cleanName,
    description: cleanDescription,
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
    if (!cleanName) throw new Error("노트북 이름이 필요합니다.");
    if (cleanName.length > 80) throw new Error("노트북 이름은 80자 이내여야 합니다.");
    manifest.name = cleanName;
  }
  if (typeof description === "string") {
    manifest.description = description.trim().slice(0, 400);
  }
  manifest.updatedAt = new Date().toISOString();

  await writeManifest(notebookId, manifest);
  return summarizeNotebook(manifest);
}

export async function deleteNotebook(notebookId) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return false;
  await fs.rm(notebookDir(notebookId), { recursive: true, force: true });
  return true;
}

export async function addNotebookDocument(notebookId, parsedDocument) {
  const manifest = await readManifest(notebookId);
  if (!manifest) throw new Error("노트북을 찾을 수 없습니다.");
  if (!parsedDocument || parsedDocument.kind !== "document") {
    throw new Error("이미지가 아닌 문서 파일만 노트북에 추가할 수 있습니다.");
  }

  const id = generateId("doc");
  const sections = pageSections(parsedDocument);
  const chunks = [];
  for (const section of sections) {
    if (!section.text) continue;
    const pieces = slidingChunkText(section.text, {
      windowChars: CHUNK_WINDOW_CHARS,
      overlapChars: CHUNK_OVERLAP_CHARS
    });
    pieces.forEach((piece, partIndex) => {
      chunks.push({
        index: chunks.length,
        text: piece,
        page: section.page,
        label: section.label || "",
        part: pieces.length > 1 ? partIndex + 1 : null,
        partTotal: pieces.length > 1 ? pieces.length : null
      });
    });
  }

  if (!chunks.length) {
    throw new Error("문서에서 본문 텍스트를 추출하지 못했습니다.");
  }

  // Batch-generate embeddings; silently degrade to BM25-only on failure.
  try {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    vectors.forEach((vec, i) => { chunks[i].embedding = vec; });
  } catch (err) {
    console.warn(`[notebooks] 임베딩 생성 실패 (BM25 전용 모드로 전환): ${err.message}`);
  }

  const now = new Date().toISOString();
  const documentRecord = {
    id,
    notebookId,
    name: parsedDocument.fileName,
    type: parsedDocument.fileType,
    addedAt: now,
    chunkCount: chunks.length,
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
    sizeBytes: Buffer.byteLength(serialized, "utf8")
  });
  manifest.updatedAt = now;
  await writeManifest(notebookId, manifest);

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
  return true;
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

export async function queryNotebook(notebookId, query, options = {}) {
  const manifest = await readManifest(notebookId);
  if (!manifest) return { ok: false, reason: "notebook_not_found", chunks: [] };

  const budget = Number.isFinite(options.budget) ? options.budget : NOTEBOOK_QUERY_BUDGET;
  const trimmedQuery = String(query ?? "").trim();

  const allChunks = [];
  for (const entry of manifest.documents || []) {
    const record = await loadDocumentRecord(notebookId, entry.id);
    if (!record) continue;
    for (const chunk of record.chunks || []) {
      allChunks.push({
        text: chunk.text,
        documentId: entry.id,
        documentName: entry.name,
        documentType: entry.type,
        page: chunk.page,
        label: chunk.label,
        part: chunk.part,
        partTotal: chunk.partTotal,
        chunkIndex: chunk.index
      });
    }
  }

  if (!allChunks.length) {
    return { ok: true, notebook: summarizeNotebook(manifest), chunks: [] };
  }

  let ranked = [];
  if (trimmedQuery) {
    const queries = await expandQuery(trimmedQuery).catch(() => [trimmedQuery]);
    let queryEmbeddings = queries.map(() => null);
    try {
      const vectors = await embedTexts(queries);
      queryEmbeddings = vectors;
    } catch {
      // BM25 fallback — embedding model unavailable
    }
    ranked = multiQueryHybridSelect(allChunks, queries, queryEmbeddings, budget);
  }

  const selected = ranked.length ? ranked : greedyFit(allChunks, budget);

  const citations = selected.map((chunk, index) => ({
    citationId: index + 1,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    documentType: chunk.documentType,
    locator: formatLocator(chunk),
    text: chunk.text,
    chunkIndex: chunk.chunkIndex
  }));

  return {
    ok: true,
    notebook: summarizeNotebook(manifest),
    chunks: citations
  };
}

function formatLocator(chunk) {
  const parts = [];
  if (chunk.label) parts.push(chunk.label);
  if (chunk.page != null) parts.push(`${chunk.page}쪽`);
  if (chunk.part) parts.push(`part ${chunk.part}/${chunk.partTotal}`);
  return parts.join(" · ");
}

