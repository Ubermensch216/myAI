import fs from "node:fs/promises";
import path from "node:path";

import { listNotebooks, getNotebookManifest, loadNotebookDocumentRecords } from "../server/notebooks.js";
import { embedTexts } from "../server/embeddings.js";
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
const EMBED_MODEL_NAME = process.env.EMBED_MODEL || "bge-m3";
const EMBED_BATCH_SIZE = Math.max(1, Number(process.env.EMBED_INGEST_BATCH_SIZE || 16));

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
  await ensureQdrantCollection({ dimension: config.vectorSize });
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
let totalEmbedded = 0;
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
        const embedded = await backfillMissingEmbeddings(notebook.id, record, manifest);
        totalEmbedded += embedded;
        if (embedded) {
          console.log(`  embedded ${record.name}: chunks=${embedded}`);
        }
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
  embedded: totalEmbedded,
  upserted: totalUpserted,
  lexicalInserted: totalLexical,
  failures
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures ? 1 : 0;

async function backfillMissingEmbeddings(notebookId, record, manifest) {
  const chunks = Array.isArray(record.chunks) ? record.chunks : [];
  const missing = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => !Array.isArray(chunk.embedding) || !chunk.embedding.length);

  if (!missing.length) return 0;

  let embeddedCount = 0;
  let embeddingDim = record.embedding?.dim || manifest.embedding?.dim || null;

  for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
    const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await embedTexts(batch.map(({ chunk }) => chunk.text || ""), {
      expectedDim: embeddingDim || undefined
    });

    if (!embeddingDim && vectors[0]?.length) {
      embeddingDim = vectors[0].length;
    }

    for (let i = 0; i < batch.length; i += 1) {
      chunks[batch[i].index].embedding = vectors[i];
      embeddedCount += 1;
    }
  }

  const now = new Date().toISOString();
  record.embedding = {
    model: record.embedding?.model || manifest.embedding?.model || EMBED_MODEL_NAME,
    dim: embeddingDim
  };
  record.ingest = {
    ...(record.ingest || {}),
    status: "completed",
    chunkCount: chunks.length,
    embeddedCount: chunks.length,
    failedCount: 0,
    finishedAt: now
  };

  if (!manifest.embedding && embeddingDim) {
    manifest.embedding = {
      model: record.embedding.model,
      dim: embeddingDim,
      createdAt: now,
      lastValidatedAt: now
    };
  } else if (manifest.embedding && embeddingDim) {
    manifest.embedding.lastValidatedAt = now;
  }

  const entry = (manifest.documents || []).find((document) => document.id === record.id);
  if (entry) {
    entry.ingest = record.ingest;
    entry.sizeBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  }
  manifest.updatedAt = now;

  const notebookDir = path.join(process.cwd(), "data", "notebooks", notebookId);
  await fs.writeFile(
    path.join(notebookDir, "docs", `${record.id}.json`),
    JSON.stringify(record),
    "utf8"
  );
  await fs.writeFile(
    path.join(notebookDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return embeddedCount;
}
