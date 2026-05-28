# Department RAG Architecture

Department RAG combines a notebook JSON source of truth with optional Qdrant dense vectors, SQLite FTS5 lexical search, optional notebook knowledge graphs, and an optional external reranker. Every optional layer degrades to JSON/BM25 fallback.

## Goals

- Keep personal browser data out of server storage.
- Keep `data/notebooks/` as the durable source of truth.
- Centralize access checks, citations, logging, and fallback in Express.
- Use Qdrant for semantic search and SQLite FTS5 for exact Korean/legal terms.
- Make indexes rebuildable and safe to lose.
- Keep reranking optional because local Ollama does not provide `/api/rerank`.

## Components

| Component | Role |
|---|---|
| `server/notebooks.js` | manifest/document source of truth, ingest, index writes, cache invalidation |
| `server/rag/departmentRag.js` | query orchestration and fallback control |
| `server/indexes/qdrantVectorIndex.js` | Qdrant collection, upsert, delete, search, health |
| `server/indexes/sqliteFtsIndex.js` | SQLite FTS5 lexical index with notebook scope tokens |
| `server/rag/graph/*` | graph ontology, extraction, store, expansion, rebuild jobs |
| `server/reranker.js` | optional external `/api/rerank` integration |
| `server/ingest/notebookIngestJobs.js` | persistent async ingest jobs with retry/startup recovery |
| `server/rag/retrievalLogger.js` | privacy-safe retrieval telemetry |
| `scripts/check-department-rag-index.mjs` | source-vs-index check |
| `scripts/rebuild-department-rag-index.mjs` | index rebuild |
| `scripts/rag-quality-test.mjs` | Recall/MRR evaluation |

## Qdrant Collection

Default collection:

```text
myai_notebook_chunks
```

Default named vector:

```text
dense_bge_m3
size: 1024
distance: Cosine
```

Important payload fields:

| Field | Purpose |
|---|---|
| `notebookId` | mandatory query filter |
| `documentId` | delete/rebuild scope |
| `documentName` | citation display |
| `documentType` | citation display/filter |
| `chunkIndex` | stable document order |
| `locator` | page/sheet/part citation label |
| `text` | prompt context |
| `textHash` | drift detection |
| `embeddingModel` / `embeddingDim` | model consistency |
| `chunkerVersion` | safe rechunking boundary |

## Ingest

Synchronous path remains for compatibility:

```text
admin upload
-> parseUpload()
-> chunkDocumentSections()
-> embedTexts()
-> analyzeDocument()
-> write source JSON
-> upsert enabled indexes
```

Preferred async path:

```text
queued -> parsing -> embedding -> indexing -> ready
                         |           |
                         v           v
                      retryable    retryable
```

API:

```text
POST /api/notebooks/:id/ingest-jobs
GET  /api/notebooks/:id/ingest-jobs
GET  /api/notebooks/:id/ingest-jobs/:jobId
POST /api/notebooks/:id/ingest-jobs/:jobId/retry
```

Queued/running jobs are recovered on startup. Jobs without a preserved upload file are marked failed instead of remaining stuck.

## Query

```text
prompt + notebookId
-> notebook access check when active
-> query expansion
-> query embeddings
-> Qdrant dense search filtered by notebookId
-> SQLite FTS5 lexical search scoped by notebook token
-> optional graph expansion
-> RRF fusion
-> optional reranker
-> greedy context fit
-> JSON fallback if indexed paths fail/no-hit
```

Normal indexed hits stay bounded by candidate count and do not load every notebook chunk JSON. `fallbackLoadedAllChunks` in retrieval telemetry records when the fallback path had to load the full corpus.

## Graph Index

Optional graph path:

```text
data/notebooks/<notebookId>/graph.sqlite
data/notebooks/<notebookId>/graph-jobs/
```

Admin rebuilds write to a temporary graph, validate it, then swap it into place. Failed rebuilds preserve the previous graph.

Query expansion setting:

```env
KG_EXPANSION_ENABLED=1
KG_EXPAND_TERMS=8
KG_EXPAND_NEIGHBORS=8
KG_EXPAND_REFS=4
KG_EXPAND_MAX=12
KG_FUSION_WEIGHT=0.3
```

## Operations Environment

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<server-only-token>
QDRANT_COLLECTION=myai_notebook_chunks
QDRANT_VECTOR_NAME=dense_bge_m3
DEPARTMENT_LEXICAL_BACKEND=sqlite
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

Use local SSD/NVMe for Qdrant and SQLite. Back up `data/notebooks/` as the source of truth; indexes can be rebuilt from it.

## Scripts

```powershell
npm.cmd run rag:check
npm.cmd run rag:rebuild
npm.cmd run rag:check -- nb_<id>
npm.cmd run rag:rebuild -- nb_<id>
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

Graph-specific:

```powershell
node scripts/build-notebook-graph.mjs nb_<id> --rebuild
node scripts/eval-graph-ab.mjs --quick
```

## Migration Units

1. Qdrant config, health checks, adapter, and JSON fallback.
2. Rebuild/check scripts.
3. Dual-write on notebook add/delete.
4. SQLite FTS5 lexical adapter and RRF fusion.
5. Persistent async ingest jobs.
6. Optional external reranker and golden-set quality tests.
7. Compose deployment, backup/restore, and operational docs.
