import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isValidEntityType, isValidRelationType, ONTOLOGY_VERSION } from "./ontology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");

const DEFAULT_CONFIDENCE_THRESHOLD = Number(process.env.KG_CONFIDENCE_THRESHOLD || 0.6);

let sqliteModulePromise = null;
const dbCache = new Map();

function loadSqlite() {
  sqliteModulePromise ||= import("node:sqlite");
  return sqliteModulePromise;
}

export function getNotebookGraphPath(notebookId) {
  return path.join(rootDir, "data", "notebooks", notebookId, "graph.sqlite");
}

export async function openNotebookGraph(notebookId) {
  if (!notebookId) throw new Error("notebookId required");
  if (dbCache.has(notebookId)) return dbCache.get(notebookId);
  const dbPath = getNotebookGraphPath(notebookId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);
  setMeta(db, "notebook_id", notebookId);
  setMeta(db, "ontology_version", ONTOLOGY_VERSION);
  dbCache.set(notebookId, db);
  return db;
}

export function closeNotebookGraph(notebookId) {
  const db = dbCache.get(notebookId);
  if (db) { db.close?.(); dbCache.delete(notebookId); }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      normalized_label TEXT NOT NULL,
      summary TEXT,
      confidence REAL DEFAULT 1.0,
      enabled INTEGER DEFAULT 1,
      extracted_by_model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON kg_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_normalized ON kg_nodes(normalized_label);

    CREATE TABLE IF NOT EXISTS kg_aliases (
      node_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      PRIMARY KEY (node_id, normalized_alias)
    );
    CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON kg_aliases(normalized_alias);

    CREATE TABLE IF NOT EXISTS kg_edges (
      id TEXT PRIMARY KEY,
      src_id TEXT NOT NULL,
      dst_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT,
      confidence REAL DEFAULT 1.0,
      enabled INTEGER DEFAULT 1,
      extracted_by_model TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edges_src ON kg_edges(src_id);
    CREATE INDEX IF NOT EXISTS idx_edges_dst ON kg_edges(dst_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON kg_edges(type);

    CREATE TABLE IF NOT EXISTS kg_source_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      quote TEXT,
      UNIQUE(ref_kind, ref_id, document_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_sourcerefs_lookup ON kg_source_refs(ref_kind, ref_id);
    CREATE INDEX IF NOT EXISTS idx_sourcerefs_chunk ON kg_source_refs(document_id, chunk_index);

    CREATE TABLE IF NOT EXISTS kg_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export function normalizeLabel(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function shortHash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export function makeNodeId(type, normalizedLabel) {
  return `n_${shortHash(`${type}|${normalizedLabel}`)}`;
}

export function makeEdgeId(srcId, type, dstId) {
  return `e_${shortHash(`${srcId}|${type}|${dstId}`)}`;
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM kg_meta WHERE key = ?").get(key);
  return row?.value;
}

export function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO kg_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function upsertAlias(db, nodeId, alias) {
  const normalized = normalizeLabel(alias);
  if (!normalized) return;
  db.prepare(`
    INSERT OR IGNORE INTO kg_aliases (node_id, alias, normalized_alias) VALUES (?, ?, ?)
  `).run(nodeId, alias, normalized);
}

export function upsertNode(db, { type, label, summary = "", confidence = 1.0, model = null, aliases = [] }) {
  if (!isValidEntityType(type)) throw new Error(`invalid entity type: ${type}`);
  const normalized = normalizeLabel(label);
  if (!normalized) throw new Error("empty label");
  const id = makeNodeId(type, normalized);
  const now = new Date().toISOString();
  const enabled = confidence >= DEFAULT_CONFIDENCE_THRESHOLD ? 1 : 0;

  db.prepare(`
    INSERT INTO kg_nodes (id, type, label, normalized_label, summary, confidence, enabled, extracted_by_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = CASE WHEN excluded.confidence > kg_nodes.confidence THEN excluded.label ELSE kg_nodes.label END,
      summary = CASE WHEN excluded.summary != '' AND length(excluded.summary) > length(coalesce(kg_nodes.summary, '')) THEN excluded.summary ELSE kg_nodes.summary END,
      confidence = MAX(kg_nodes.confidence, excluded.confidence),
      enabled = CASE WHEN MAX(kg_nodes.confidence, excluded.confidence) >= ${DEFAULT_CONFIDENCE_THRESHOLD} THEN 1 ELSE 0 END,
      updated_at = excluded.updated_at
  `).run(id, type, label, normalized, summary, confidence, enabled, model, now, now);

  upsertAlias(db, id, label);
  for (const a of aliases) upsertAlias(db, id, a);

  return id;
}

export function upsertEdge(db, { srcId, dstId, type, label = null, confidence = 1.0, model = null }) {
  if (!isValidRelationType(type)) throw new Error(`invalid relation type: ${type}`);
  if (!srcId || !dstId || srcId === dstId) return null;
  const id = makeEdgeId(srcId, type, dstId);
  const now = new Date().toISOString();
  const enabled = confidence >= DEFAULT_CONFIDENCE_THRESHOLD ? 1 : 0;
  db.prepare(`
    INSERT INTO kg_edges (id, src_id, dst_id, type, label, confidence, enabled, extracted_by_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      confidence = MAX(kg_edges.confidence, excluded.confidence),
      enabled = CASE WHEN MAX(kg_edges.confidence, excluded.confidence) >= ${DEFAULT_CONFIDENCE_THRESHOLD} THEN 1 ELSE 0 END,
      label = COALESCE(excluded.label, kg_edges.label)
  `).run(id, srcId, dstId, type, label, confidence, enabled, model, now);
  return id;
}

export function attachSourceRef(db, { kind, refId, documentId, chunkIndex, quote = "" }) {
  if (!["node", "edge"].includes(kind)) throw new Error("invalid kind");
  if (!refId || !documentId || chunkIndex === undefined || chunkIndex === null) return;
  const truncated = String(quote || "").slice(0, 400);
  db.prepare(`
    INSERT OR IGNORE INTO kg_source_refs (ref_kind, ref_id, document_id, chunk_index, quote)
    VALUES (?, ?, ?, ?, ?)
  `).run(kind, refId, documentId, Number(chunkIndex), truncated);
}

export function findNodesByAlias(db, term, limit = 10) {
  const normalized = normalizeLabel(term);
  if (!normalized) return [];
  return db.prepare(`
    SELECT DISTINCT n.id, n.type, n.label, n.summary, n.confidence
    FROM kg_aliases a
    JOIN kg_nodes n ON n.id = a.node_id
    WHERE n.enabled = 1
      AND (a.normalized_alias = ? OR a.normalized_alias LIKE ?)
    ORDER BY (CASE WHEN a.normalized_alias = ? THEN 1 ELSE 0 END) DESC, n.confidence DESC
    LIMIT ?
  `).all(normalized, `%${normalized}%`, normalized, limit);
}

export function neighborsOf(db, nodeId, opts = {}) {
  const { directions = "both", limit = 20 } = opts;
  const parts = [];
  const args = [];
  if (directions === "out" || directions === "both") {
    parts.push(`SELECT e.id AS edge_id, e.type, e.confidence, n.id AS neighbor_id, n.type AS neighbor_type, n.label AS neighbor_label, 'out' AS direction
      FROM kg_edges e JOIN kg_nodes n ON n.id = e.dst_id
      WHERE e.src_id = ? AND e.enabled = 1 AND n.enabled = 1`);
    args.push(nodeId);
  }
  if (directions === "in" || directions === "both") {
    parts.push(`SELECT e.id AS edge_id, e.type, e.confidence, n.id AS neighbor_id, n.type AS neighbor_type, n.label AS neighbor_label, 'in' AS direction
      FROM kg_edges e JOIN kg_nodes n ON n.id = e.src_id
      WHERE e.dst_id = ? AND e.enabled = 1 AND n.enabled = 1`);
    args.push(nodeId);
  }
  const sql = parts.join(" UNION ") + " ORDER BY 3 DESC LIMIT ?";
  args.push(limit);
  return db.prepare(sql).all(...args);
}

export function sourceRefsOf(db, kind, refId, limit = 10) {
  return db.prepare(`
    SELECT document_id AS documentId, chunk_index AS chunkIndex, quote
    FROM kg_source_refs
    WHERE ref_kind = ? AND ref_id = ?
    LIMIT ?
  `).all(kind, refId, limit);
}

export function getStats(db) {
  const row = (sql) => db.prepare(sql).get();
  return {
    nodeCount: row("SELECT COUNT(*) AS c FROM kg_nodes").c,
    enabledNodes: row("SELECT COUNT(*) AS c FROM kg_nodes WHERE enabled = 1").c,
    edgeCount: row("SELECT COUNT(*) AS c FROM kg_edges").c,
    enabledEdges: row("SELECT COUNT(*) AS c FROM kg_edges WHERE enabled = 1").c,
    refCount: row("SELECT COUNT(*) AS c FROM kg_source_refs").c,
    nodeTypeCounts: db.prepare("SELECT type, COUNT(*) AS c FROM kg_nodes GROUP BY type ORDER BY c DESC").all(),
    relationTypeCounts: db.prepare("SELECT type, COUNT(*) AS c FROM kg_edges GROUP BY type ORDER BY c DESC").all()
  };
}

export function clearGraph(db) {
  db.exec("BEGIN; DELETE FROM kg_source_refs; DELETE FROM kg_edges; DELETE FROM kg_aliases; DELETE FROM kg_nodes; COMMIT;");
}
