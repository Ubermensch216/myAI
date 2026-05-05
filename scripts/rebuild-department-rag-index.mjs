import { listNotebooks, getNotebookManifest, loadNotebookDocumentRecords } from "../server/notebooks.js";
import {
  ensureQdrantCollection,
  getQdrantConfig,
  getQdrantHealth,
  upsertNotebookDocumentVectors
} from "../server/indexes/qdrantVectorIndex.js";
import { resolvedDepartmentBackend } from "../server/rag/ragConfig.js";
import { upsertNotebookDocumentLexical } from "../server/indexes/sqliteFtsIndex.js";

const notebookFilter = process.argv[2] || process.env.NOTEBOOK_ID || "";
const backend = resolvedDepartmentBackend();
const config = getQdrantConfig();

if (backend.vector === "qdrant" && !config.configured) {
  console.error("QDRANT_URL is required. Example: QDRANT_URL=http://127.0.0.1:6333 npm run rag:rebuild");
  process.exit(1);
}

if (backend.vector === "qdrant") {
  const health = await getQdrantHealth();
  if (!health.ok && health.reason !== "collection_not_found") {
    console.error(`Qdrant is not ready: ${health.reason || "unknown"} ${health.error || ""}`.trim());
    process.exit(1);
  }
}

const notebooks = await listNotebooks();
const selected = notebookFilter
  ? notebooks.filter((notebook) => notebook.id === notebookFilter)
  : notebooks;

if (notebookFilter && !selected.length) {
  console.error(`Notebook not found: ${notebookFilter}`);
  process.exit(1);
}

let totalDocuments = 0;
let totalChunks = 0;
let totalUpserted = 0;
let totalLexical = 0;
let failures = 0;

for (const notebook of selected) {
  const manifest = await getNotebookManifest(notebook.id);
  if (!manifest) continue;
  if (backend.vector === "qdrant" && manifest.embedding?.dim) {
    await ensureQdrantCollection({ dimension: manifest.embedding.dim });
  }

  const records = await loadNotebookDocumentRecords(notebook.id, manifest);
  console.log(`[rag:rebuild] ${notebook.name} (${notebook.id}) documents=${records.length}`);

  for (const record of records) {
    totalDocuments += 1;
    totalChunks += Array.isArray(record.chunks) ? record.chunks.length : 0;
    if (backend.vector === "qdrant") {
      try {
        const result = await upsertNotebookDocumentVectors({
          notebookId: notebook.id,
          documentRecord: record,
          embeddingModel: record.embedding?.model || manifest.embedding?.model
        });
        totalUpserted += result.upserted || 0;
        console.log(`  qdrant ok ${record.name}: upserted=${result.upserted || 0}`);
      } catch (err) {
        failures += 1;
        console.error(`  qdrant failed ${record.name}: ${err.message}`);
      }
    }
    if (backend.lexical === "sqlite") {
      try {
        const result = await upsertNotebookDocumentLexical({
          notebookId: notebook.id,
          documentRecord: record
        });
        totalLexical += result.inserted || 0;
        console.log(`  sqlite ok ${record.name}: inserted=${result.inserted || 0}`);
      } catch (err) {
        failures += 1;
        console.error(`  sqlite failed ${record.name}: ${err.message}`);
      }
    }
  }
}

const summary = {
  ok: failures === 0,
  backend,
  collection: config.collection,
  vectorName: config.vectorName,
  notebooks: selected.length,
  documents: totalDocuments,
  chunks: totalChunks,
  upserted: totalUpserted,
  lexicalInserted: totalLexical,
  failures
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures ? 1 : 0;
