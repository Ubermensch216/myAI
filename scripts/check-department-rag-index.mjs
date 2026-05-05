import { listNotebooks, getNotebookManifest, loadNotebookChunksForRetrieval } from "../server/notebooks.js";
import { resolvedDepartmentBackend } from "../server/rag/ragConfig.js";
import { countQdrantNotebookChunks, getQdrantHealth } from "../server/indexes/qdrantVectorIndex.js";
import { countSqliteNotebookChunks, getSqliteFtsHealth } from "../server/indexes/sqliteFtsIndex.js";

const notebookFilter = process.argv[2] || process.env.NOTEBOOK_ID || "";
let exitCode = 0;

const backend = resolvedDepartmentBackend();
const qdrant = await getQdrantHealth();
const sqlite = backend.lexical === "sqlite"
  ? await getSqliteFtsHealth()
  : { configured: false, ok: false, reason: "sqlite_fts_not_enabled" };
const notebooks = await listNotebooks();
const selected = notebookFilter
  ? notebooks.filter((notebook) => notebook.id === notebookFilter)
  : notebooks;

if (notebookFilter && !selected.length) {
  console.error(`Notebook not found: ${notebookFilter}`);
  process.exit(1);
}

const rows = [];
for (const notebook of selected) {
  const manifest = await getNotebookManifest(notebook.id);
  const chunks = manifest ? await loadNotebookChunksForRetrieval(notebook.id, manifest) : [];
  let indexedChunks = null;
  let lexicalChunks = null;
  let status = "not_checked";
  let error = "";

  if (!qdrant.configured) {
    status = "qdrant_not_configured";
  } else if (!qdrant.ok) {
    status = qdrant.reason || "qdrant_unavailable";
    error = qdrant.error || "";
    exitCode = 1;
  } else {
    try {
      const count = await countQdrantNotebookChunks({ notebookId: notebook.id });
      indexedChunks = count.count;
      status = indexedChunks === chunks.length ? "ok" : "mismatch";
      if (status !== "ok") exitCode = 1;
    } catch (err) {
      status = "count_failed";
      error = err.message;
      exitCode = 1;
    }
  }

  let lexicalStatus = "not_enabled";
  let lexicalError = "";
  if (backend.lexical === "sqlite") {
    if (!sqlite.ok) {
      lexicalStatus = "sqlite_unavailable";
      lexicalError = sqlite.error || "";
      exitCode = 1;
    } else {
      try {
        const count = await countSqliteNotebookChunks({ notebookId: notebook.id });
        lexicalChunks = count.count;
        lexicalStatus = lexicalChunks === chunks.length ? "ok" : "mismatch";
        if (lexicalStatus !== "ok") exitCode = 1;
      } catch (err) {
        lexicalStatus = "count_failed";
        lexicalError = err.message;
        exitCode = 1;
      }
    }
  }

  rows.push({
    notebookId: notebook.id,
    name: notebook.name,
    expectedChunks: chunks.length,
    indexedChunks,
    status,
    error,
    lexicalChunks,
    lexicalStatus,
    lexicalError
  });
}

const report = {
  ok: exitCode === 0,
  backend,
  qdrant,
  sqlite,
  checkedAt: new Date().toISOString(),
  notebooks: rows
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = exitCode;
