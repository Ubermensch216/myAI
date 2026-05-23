import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../env.js";
import { tokenize } from "../retrieval.js";

loadLocalEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const DEFAULT_DB_PATH = path.join(rootDir, "data", "indexes", "department-rag.sqlite");
const DEFAULT_LIMIT = 80;

let sqliteModulePromise = null;
let database = null;

export function getSqliteFtsConfig() {
  const dbPath = String(process.env.SQLITE_FTS_PATH || DEFAULT_DB_PATH).trim() || DEFAULT_DB_PATH;
  return {
    path: path.resolve(rootDir, dbPath),
    searchLimit: Math.max(1, Number(process.env.SQLITE_FTS_SEARCH_LIMIT || DEFAULT_LIMIT))
  };
}

export async function getSqliteFtsHealth() {
  const config = getSqliteFtsConfig();
  try {
    const db = await openDatabase();
    const row = db.prepare("SELECT COUNT(*) AS count FROM department_chunks").get();
    return {
      configured: true,
      ok: true,
      path: config.path,
      chunks: Number(row?.count || 0)
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      path: config.path,
      error: error.message
    };
  }
}

export async function upsertNotebookDocumentLexical({ notebookId, documentRecord }) {
  if (!notebookId || !documentRecord?.id) {
    throw new Error("SQLite FTS upsert requires notebookId and documentRecord.id.");
  }
  const db = await openDatabase();
  deleteDocumentRows(db, notebookId, documentRecord.id);

  const insert = db.prepare(`
    INSERT INTO department_chunks
      (notebookId, documentId, chunkIndex, documentName, documentType, locator, payload, searchText)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.exec("BEGIN");
  try {
    const chunks = Array.isArray(documentRecord.chunks) ? documentRecord.chunks : [];
    for (const [index, chunk] of chunks.entries()) {
      const payload = buildChunkPayload({ notebookId, documentRecord, chunk, index });
      insert.run(
        notebookId,
        documentRecord.id,
        chunk.index ?? index,
        documentRecord.name || "",
        documentRecord.type || "",
        payload.locator,
        JSON.stringify(payload),
        buildSearchText(payload)
      );
      inserted += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { ok: true, inserted };
}

export async function deleteNotebookDocumentLexical({ notebookId, documentId }) {
  if (!notebookId || !documentId) {
    throw new Error("SQLite FTS delete requires notebookId and documentId.");
  }
  const db = await openDatabase();
  const result = deleteDocumentRows(db, notebookId, documentId);
  return { ok: true, deleted: result.changes || 0 };
}

export async function deleteNotebookLexical({ notebookId }) {
  if (!notebookId) throw new Error("SQLite FTS delete requires notebookId.");
  const db = await openDatabase();
  const result = db.prepare("DELETE FROM department_chunks WHERE notebookId = ?").run(notebookId);
  return { ok: true, deleted: result.changes || 0 };
}

export async function countSqliteNotebookChunks({ notebookId }) {
  const db = await openDatabase();
  const row = db.prepare("SELECT COUNT(*) AS count FROM department_chunks WHERE notebookId = ?").get(notebookId);
  return { ok: true, count: Number(row?.count || 0) };
}

export async function searchSqliteNotebookChunks({ notebookId, queries, limit }) {
  if (!notebookId) {
    return { ok: false, chunks: [], reason: "missing_notebook" };
  }
  const queryMatch = buildFtsQuery(queries);
  if (!queryMatch) {
    return { ok: false, chunks: [], reason: "empty_query" };
  }
  const scopeMatch = `"${escapeFtsToken(scopeToken(notebookId))}"`;
  const match = `${scopeMatch} AND (${queryMatch})`;

  const config = getSqliteFtsConfig();
  const db = await openDatabase();
  const rows = db.prepare(`
    SELECT payload, bm25(department_chunks) AS score
    FROM department_chunks
    WHERE department_chunks MATCH ? AND notebookId = ?
    ORDER BY score
    LIMIT ?
  `).all(match, notebookId, Math.max(1, Number(limit || config.searchLimit)));

  return {
    ok: true,
    chunks: rows.map((row, index) => payloadToChunk(row.payload, { lexicalRank: index + 1, lexicalScore: row.score })),
    match
  };
}

async function openDatabase() {
  if (database) return database;
  const config = getSqliteFtsConfig();
  fs.mkdirSync(path.dirname(config.path), { recursive: true });
  const { DatabaseSync } = await loadSqliteModule();
  database = new DatabaseSync(config.path);
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS department_chunks USING fts5(
      notebookId UNINDEXED,
      documentId UNINDEXED,
      chunkIndex UNINDEXED,
      documentName UNINDEXED,
      documentType UNINDEXED,
      locator UNINDEXED,
      payload UNINDEXED,
      searchText,
      tokenize = 'unicode61'
    );
  `);
  return database;
}

function loadSqliteModule() {
  sqliteModulePromise ||= import("node:sqlite");
  return sqliteModulePromise;
}

function deleteDocumentRows(db, notebookId, documentId) {
  return db.prepare("DELETE FROM department_chunks WHERE notebookId = ? AND documentId = ?").run(notebookId, documentId);
}

function buildChunkPayload({ notebookId, documentRecord, chunk, index }) {
  return {
    notebookId,
    documentId: documentRecord.id,
    documentName: documentRecord.name,
    documentType: documentRecord.type,
    page: chunk.page,
    label: chunk.label,
    part: chunk.part,
    partTotal: chunk.partTotal,
    chunkIndex: chunk.index ?? index,
    parentIndex: chunk.parentIndex ?? null,
    locator: formatLocator(chunk),
    text: String(chunk.text || "")
  };
}

function buildSearchText(payload) {
  return [
    scopeToken(payload.notebookId),
    payload.documentName,
    payload.documentType,
    payload.locator,
    payload.text,
    tokenize(`${payload.documentName}\n${payload.locator}\n${payload.text}`).join(" ")
  ].filter(Boolean).join("\n");
}

function scopeToken(notebookId) {
  return `nbscope${String(notebookId || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function buildFtsQuery(queries) {
  const tokens = [];
  for (const query of Array.isArray(queries) ? queries : [queries]) {
    for (const token of tokenize(query)) {
      if (token.length < 2 && !/\d/.test(token)) continue;
      tokens.push(token);
    }
  }
  const unique = Array.from(new Set(tokens)).slice(0, 64);
  if (!unique.length) return "";
  return unique.map((token) => `"${escapeFtsToken(token)}"`).join(" OR ");
}

function escapeFtsToken(token) {
  return String(token).replace(/"/g, '""');
}

function payloadToChunk(rawPayload, scores = {}) {
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  return {
    text: String(payload.text || ""),
    documentId: payload.documentId,
    documentName: payload.documentName,
    documentType: payload.documentType,
    page: payload.page,
    label: payload.label,
    part: payload.part,
    partTotal: payload.partTotal,
    chunkIndex: payload.chunkIndex,
    parentIndex: payload.parentIndex ?? null,
    locator: payload.locator || "",
    lexicalRank: scores.lexicalRank,
    lexicalScore: scores.lexicalScore
  };
}

function formatLocator(chunk) {
  const parts = [];
  if (chunk.label) parts.push(chunk.label);
  if (chunk.page != null) parts.push(`${chunk.page}쪽`);
  if (chunk.part) parts.push(`part ${chunk.part}/${chunk.partTotal}`);
  return parts.join(" · ");
}
