# Department RAG Architecture

This document describes the department RAG stack: Qdrant (vector) + SQLite FTS5
(lexical) + cross-encoder reranker on top of the JSON source-of-truth
in `data/notebooks/`. All components have graceful fallback to JSON/in-memory
retrieval when optional services are unavailable.

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
| `server/reranker.js` | Cross-encoder reranking via Ollama `/api/rerank`; timeout + graceful fallback. |
| `server/ingest/notebookIngestJobs.js` | Async ingest job queue with retry and startup recovery. |
| `npm run rag:check` / `rag:rebuild` | Index consistency checks and full index rebuilds. |
| `npm run rag:quality-test:quick` | Fast Recall@K / MRR@K evaluation for representative golden cases. |
| `npm run rag:quality-test` | Full Recall@K / MRR@K evaluation against `fixtures/rag/department-golden.json`. |

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
POST /api/notebooks/:id/ingest-jobs/:jobId/retry
```

The current synchronous upload endpoint remains available for compatibility.
The admin UI now creates ingest jobs and polls job status while uploads are
parsed, embedded, and indexed in the background.

On server startup, queued or running jobs are recovered from `data/ingest-jobs/`.
Jobs with a preserved upload file are queued again. Jobs whose upload file is
missing are marked failed so the admin UI can show the failure instead of
leaving them stuck forever.

Model-calling work is guarded by lightweight in-process queues:

| Queue | Protects | Default |
|---|---|---:|
| `chat` | Optional streaming chat gate when `CHAT_QUEUE_ENABLED=true` | 4 running / 32 queued |
| `embedding` | Ollama `/api/embed` calls during ingest and query embedding | 2 running / 64 queued |
| `analysis` | Query expansion, upload summaries, visualization JSON calls | 2 running / 32 queued |
| `map_reduce` | Map-Reduce map and reduce Ollama calls | 2 running / 32 queued |

Queued tasks respect `AbortSignal`, so cancelled chat or analysis requests do
not sit in the queue and later consume GPU work. Queue depths are exposed
through `/api/status`. Streaming chat is outside the queue by default; enable
`CHAT_QUEUE_ENABLED=true` only when the workstation needs a hard interactive
concurrency cap.

The server also applies lightweight in-process rate limits to chat, upload,
visualization, follow-up, calendar intent, and admin write routes. These limits
reduce accidental overload on trusted LAN deployments, but reverse-proxy limits
remain the stronger production control.

## Query Strategy

```text
prompt + notebookId
-> query expansion
-> query embeddings
-> Qdrant dense search filtered by notebookId
-> SQLite FTS5 lexical search scoped by notebook token
-> RRF fusion
-> optional reranker
-> budget-fit context and citations
-> Ollama streaming answer
```

The first implementation enables Qdrant dense search and SQLite FTS5 lexical
search as independent backends. If either backend is unavailable, the JSON
source-of-truth search remains the fallback. `departmentRag.js` only loads all
notebook chunks for this fallback path, for empty-query first-chunk fitting, or
when external indexes return no usable candidates. Successful Qdrant/SQLite
queries stay `O(topK)` with respect to notebook JSON I/O.

SQLite FTS stores a deterministic `nbscope<notebookId>` token in each row's
`searchText`. The same token is required in every notebook lexical query
`MATCH` expression, which narrows candidates inside FTS before the
`notebookId` metadata predicate is applied.

Fallback order:

1. Qdrant dense search, when `DEPARTMENT_VECTOR_BACKEND=qdrant`.
2. SQLite FTS5 lexical search, when `DEPARTMENT_LEXICAL_BACKEND=sqlite`.
3. Existing JSON chunk search with query expansion, BM25/CJK, embeddings, and RRF.
4. Greedy first-chunk fit for empty or unrankable queries.

Retrieval telemetry records whether a request loaded the full notebook JSON
corpus through `fallbackLoadedAllChunks`. This field is present both at the log
entry top level and in `corpus`.

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
EMBED_QUEUE_CONCURRENCY=2
MAP_REDUCE_QUEUE_CONCURRENCY=2
ANALYSIS_QUEUE_CONCURRENCY=2
```

Use `DEPARTMENT_LEXICAL_BACKEND=sqlite` on department workstations once the
index has been rebuilt. The SQLite index uses `node:sqlite`, so department
deployments should run Node.js 24 or newer and may emit a Node experimental
warning on current Node 24 builds. Rebuild the SQLite index after changing
lexical indexing rules such as notebook scope tokens.

Use `.env.department.example` as the starting point for a workstation `.env`.
Qdrant can be started locally with:

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env.department.example up -d
```

For portable deployments, prefer the root Compose stack. It runs the app,
Qdrant, and Ollama together:

```bash
cp deploy/container.env.example .env
docker compose up -d --build
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

See `docs/CONTAINER_DEPLOYMENT.md` for volume, GPU, backup, and update details.

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

Evaluate the current golden set:

```powershell
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

As of the local 35-case fixture, the baseline is:

```text
Recall@10: 1.0000
MRR@10:    0.9167
```
