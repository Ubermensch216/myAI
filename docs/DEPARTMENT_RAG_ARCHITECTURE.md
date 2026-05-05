# Department RAG Architecture

This document is the build plan for moving department notebooks from the
current JSON + in-memory retrieval path to an open-source workstation RAG stack
backed by a persistent vector database.

## Design Goals

- Keep the browser/private-data boundary unchanged: personal rooms, uploads,
  calendar events, and settings remain in encrypted IndexedDB.
- Treat department notebooks as shared server-side knowledge managed by admins.
- Keep `data/notebooks/` as the source of truth until an explicit metadata-store
  migration is complete.
- Use Qdrant as the department vector index and keep lexical retrieval as a
  separate, replaceable layer.
- Make each migration step reversible. If Qdrant or a future lexical index is
  unavailable, chat should degrade to the current JSON/BM25 path.

## Target Topology

```text
[Personal PC browser]
  IndexedDB AES-GCM
  rooms, personal uploads, calendar, settings
        |
        | fetch()
        v
[Department workstation]
  Node.js / Express :3000
  Ollama :11434
  Qdrant :6333
  data/notebooks/
  data/logs/
```

The browser never talks directly to Qdrant. All RAG reads and writes go through
the Express server so access rules, citations, logging, and fallback behavior
stay centralized.

## Core Components

| Component | Role |
|---|---|
| `server/notebooks.js` | Notebook manifests and document records. Remains the source of truth. |
| `server/rag/departmentRag.js` | Department retrieval orchestration and fallback control. |
| `server/indexes/qdrantVectorIndex.js` | Qdrant collection lifecycle, point upsert/delete/search, health checks. |
| `server/indexes/sqliteFtsIndex.js` | SQLite FTS5 lexical index for exact Korean terms, IDs, titles, and CJK bigram matching. |
| `server/rag/retrievalLogger.js` | Privacy-safe JSONL retrieval telemetry. |
| Admin rebuild scripts | Future index consistency checks, rebuilds, and snapshots. |

## Qdrant Collection

Default collection:

```text
myai_notebook_chunks
```

Dense vector:

```text
name: dense_bge_m3
size: 1024
distance: Cosine
```

Payload fields:

| Field | Purpose |
|---|---|
| `notebookId` | Mandatory filter for every department query. |
| `documentId` | Delete/rebuild scope and citation metadata. |
| `documentName` | Citation display. |
| `documentType` | Citation display and optional filters. |
| `chunkIndex` | Stable ordering within a document. |
| `locator` | Page/sheet/part label for citations. |
| `text` | Retrieval context text. |
| `textHash` | Drift detection during rebuild checks. |
| `embeddingModel` | Prevent mixed-model collections. |
| `embeddingDim` | Prevent dimension mismatch. |
| `chunkerVersion` | Enables safe future rechunking. |
| `createdAt` | Operations/debugging. |

Payload indexes should be created for `notebookId`, `documentId`, `documentType`,
and any future access-control field that commonly appears in filters.

## Ingest Strategy

Phase 1 keeps admin uploads synchronous but dual-writes the index:

```text
admin upload
-> parseUpload()
-> chunkDocumentSections()
-> embedTexts()
-> write data/notebooks source record
-> upsert Qdrant points
-> invalidate in-process notebook cache
```

The source record is written before Qdrant is treated as authoritative. If the
Qdrant write fails, the document remains available through JSON fallback and the
admin UI can surface a degraded index status later.

Phase 2 moves ingest into jobs:

```text
queued -> parsing -> embedding -> indexing -> ready
                         |           |
                         v           v
                      retryable    retryable
```

Jobs make large department notebooks safer because a single failed embedding
batch or Qdrant write does not block or corrupt the manifest.

The backend foundation is available through admin endpoints:

```text
POST /api/notebooks/:id/ingest-jobs
GET  /api/notebooks/:id/ingest-jobs
GET  /api/notebooks/:id/ingest-jobs/:jobId
```

The current synchronous upload endpoint remains available while the admin UI is
updated to poll job progress.

## Query Strategy

```text
prompt + notebookId
-> query expansion
-> query embeddings
-> Qdrant dense search filtered by notebookId
-> lexical search filtered by notebookId
-> RRF fusion
-> optional reranker
-> budget-fit context and citations
-> Ollama streaming answer
```

The first implementation enables Qdrant dense search and SQLite FTS5 lexical
search as independent backends. If either backend is unavailable, the JSON
source-of-truth search remains the fallback.

Fallback order:

1. Qdrant dense search, when `DEPARTMENT_VECTOR_BACKEND=qdrant`.
2. Existing JSON chunk search with query expansion, BM25/CJK, embeddings, and RRF.
3. Greedy first-chunk fit for empty or unrankable queries.

## Operations

Recommended environment:

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<server-only-token>
QDRANT_COLLECTION=myai_notebook_chunks
QDRANT_VECTOR_NAME=dense_bge_m3
EMBED_MODEL=bge-m3
EMBED_DIM=1024
DEPARTMENT_LEXICAL_BACKEND=sqlite
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
```

Use `DEPARTMENT_LEXICAL_BACKEND=sqlite` on department workstations once the
index has been rebuilt. The SQLite index uses `node:sqlite` and may emit a Node
experimental warning on current Node 24 builds.

Use `.env.department.example` as the starting point for a workstation `.env`.
Qdrant can be started locally with:

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env.department.example up -d
```

Run Qdrant on local SSD/NVMe storage, not a network filesystem. Back up both
Qdrant snapshots and `data/notebooks/` together, because Qdrant is an index and
the notebook files remain the rebuildable source of truth.

## Migration Units

1. Add Qdrant config, health checks, adapter boundary, and safe JSON fallback.
2. Add rebuild/check scripts that can populate Qdrant from `data/notebooks/`.
3. Add dual-write on notebook document add/delete.
4. Add SQLite FTS5 lexical adapter and RRF fusion against Qdrant dense results.
5. Move admin notebook ingest to persistent jobs with retry/progress.
6. Add reranking and a golden-question quality test set.
7. Add deployment package: compose file, environment example, backup/restore
   scripts, and operational runbook.

## Current Scripts

Check source-vs-index status:

```powershell
npm.cmd run rag:check
```

Rebuild enabled indexes from all notebooks. With `DEPARTMENT_VECTOR_BACKEND=qdrant`
this populates Qdrant; with `DEPARTMENT_LEXICAL_BACKEND=sqlite` this populates
the SQLite FTS index:

```powershell
$env:QDRANT_URL = "http://127.0.0.1:6333"
npm.cmd run rag:rebuild
```

Limit either command to one notebook:

```powershell
npm.cmd run rag:check -- nb_<id>
npm.cmd run rag:rebuild -- nb_<id>
```
