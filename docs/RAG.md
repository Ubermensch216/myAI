# RAG And Map-Reduce

myAI has two RAG profiles: browser-owned personal room documents and server-owned department notebooks. Both feed evidence into chat, but their storage, access rules, and fallback behavior differ.

## Profiles

| Profile | Source | Storage | Retrieval |
|---|---|---|---|
| `personal` | active room uploads and generated room sources | encrypted browser IndexedDB, sent in `/api/chat` body | in-process chunking, BM25/CJK, optional embeddings, RRF |
| `department` | admin-curated notebooks | `data/notebooks/<id>/` plus optional Qdrant/SQLite/graph indexes | query expansion, Qdrant, SQLite FTS5, optional graph expansion, RRF, optional rerank, JSON fallback |

When a `notebookId` is present, department RAG runs after notebook read access is validated. Personal documents can still be included unless a stricter route such as `lawSearchMode` excludes them.

## Models

Recommended local settings:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

`bge-m3` is the default Korean-capable embedding model. Local checks on 2026-05-05 confirmed 1024-dimensional vectors through Ollama `/api/embed`.

## Personal Documents

Personal documents live in encrypted IndexedDB. On each chat turn, the browser sends active room documents in the request body.

Flow:

```text
documents in browser
-> optional query-aware browser trimming for very large text
-> server/ollama.js collectChunks()
-> server/chunking.js chunkDocumentSections()
-> query expansion + embeddings when available
-> server/retrieval.js hybrid selection
-> context injected into prompt
```

If embeddings fail, retrieval falls back to lexical BM25/CJK ranking. Generated room sources are included as secondary references and are marked generated/needs verification in UI and metadata.

## Document Pre-Analysis

`server/documentAnalysis.js` runs on uploads and notebook ingest when `DOC_ANALYSIS_ENABLED` is not `false`.

Stored fields:

```js
{ summary: string, topics: string[] }
```

Failures return empty values so upload/ingest continues.

## Department Notebook Storage

```text
data/notebooks/<notebookId>/manifest.json
data/notebooks/<notebookId>/docs/<documentId>.json
data/notebooks/<notebookId>/graph.sqlite        optional
data/notebooks/<notebookId>/graph-jobs/         graph rebuild history
```

`data/notebooks/` is the source of truth. Qdrant, SQLite FTS5, and graph indexes are rebuildable operational indexes.

## Ingest

Synchronous compatibility path:

```text
POST /api/notebooks/:id/documents
-> parseUpload()
-> chunkDocumentSections()
-> embedTexts()
-> analyzeDocument()
-> write notebook document JSON
-> dual-write enabled indexes
```

Preferred async path:

```text
POST /api/notebooks/:id/ingest-jobs
-> persistent job
-> parse, embed, analyze, index
-> retry support and startup recovery
```

Job endpoints:

```text
GET  /api/notebooks/:id/ingest-jobs
GET  /api/notebooks/:id/ingest-jobs/:jobId
POST /api/notebooks/:id/ingest-jobs/:jobId/retry
```

## Department Query Flow

```text
server/rag/departmentRag.js searchNotebook()
-> manifest and access context
-> expandQuery()
-> embedTexts()
-> Qdrant dense search if DEPARTMENT_VECTOR_BACKEND=qdrant
-> SQLite FTS5 lexical search if DEPARTMENT_LEXICAL_BACKEND=sqlite
-> optional graph expansion when KG_EXPANSION_ENABLED=1
-> RRF fusion
-> optional rerankChunks()
-> greedyFit()
-> lazy JSON fallback when indexed paths fail or return no usable candidates
-> citations and retrieval telemetry
```

Normal Qdrant/SQLite hits do not load every notebook JSON chunk. Full chunk loading is reserved for fallback, empty-query first-chunk fitting, and whole-notebook Map-Reduce.

## Department Access Control

Notebook access control is inactive until at least one enabled group level password or enabled Super password exists. Once active:

- `/api/notebooks`, `/api/notebooks/:id`, `/api/chat` with `notebookId`, and Map-Reduce over a notebook require a notebook-read token.
- Admin management still uses `ADMIN_TOKEN`.
- `ADMIN_TOKEN` is not accepted as a normal chat-time read identity.
- Level 1 is highest privilege, then Level 2, then Level 3.

## Qdrant And SQLite

Recommended department `.env`:

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=myai_notebook_chunks
QDRANT_VECTOR_NAME=dense_bge_m3
DEPARTMENT_LEXICAL_BACKEND=sqlite
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
```

Qdrant filters every search by notebook. SQLite FTS stores a notebook-scope token in `searchText` and requires it in every `MATCH` query before metadata filtering.

## Knowledge Graph Expansion

Notebook knowledge graphs are optional SQLite indexes:

```text
data/notebooks/<notebookId>/graph.sqlite
```

Graph build/rebuild:

```powershell
node scripts/build-notebook-graph.mjs <notebookId> --rebuild
```

Admin API rebuild:

```text
POST /api/admin/graph/:notebookId/rebuild
GET  /api/admin/graph/:notebookId/rebuild/status
GET  /api/admin/graph/:notebookId/rebuild/jobs
```

Query-time graph expansion is off by default:

```env
KG_EXPANSION_ENABLED=1
KG_EXPAND_TERMS=8
KG_EXPAND_NEIGHBORS=8
KG_EXPAND_REFS=4
KG_EXPAND_MAX=12
KG_FUSION_WEIGHT=0.3
```

When enabled, graph matches add supplemental chunk references as a weighted ranking list before RRF. Missing or empty graphs fall through to normal retrieval.

## Reranker

`RAG_RERANK_ENABLED=false` by default.

```env
RAG_RERANK_ENABLED=true
RERANK_MODEL=bge-reranker-v2-m3
RERANK_TOP_K=40
RERANK_TIMEOUT_MS=8000
```

Ollama does not expose `/api/rerank`, so enabling this requires an external reranker service compatible with `server/reranker.js`, such as HF Text Embeddings Inference configured for a cross-encoder. On error or timeout, candidates remain in RRF order and telemetry records `reranked: false`.

## Precision Analysis / Map-Reduce

UI entry: composer material panel Precision Analysis toggle.

Request:

```js
{ mode: "map_reduce" }
```

Sources:

- selected notebook: all notebook chunks through `loadAllNotebookChunks()`
- no notebook: active room documents through `collectChunks()`

Flow:

```text
chunks
-> cap by MAP_REDUCE_MAX_CHUNKS
-> group by MAP_REDUCE_BATCH_CHUNKS
-> map calls with MAP_REDUCE_PARALLELISM
-> final reduce stream
-> inline citation popup metadata
```

Important settings:

```env
MAP_REDUCE_BATCH_CHUNKS=4
MAP_REDUCE_MAX_CHUNKS=80
MAP_REDUCE_PARALLELISM=2
MAP_REDUCE_MAP_TIMEOUT_MS=120000
MAP_REDUCE_MAP_RETRY=1
OLLAMA_KEEP_ALIVE=30m
```

## Caches And Logs

- `NOTEBOOK_CHUNK_CACHE_MAX` controls the in-process notebook chunk LRU used by fallback and Map-Reduce.
- `RETRIEVAL_LOG_ENABLED=false` disables privacy-safe retrieval logs.
- Retrieval telemetry includes backend choice, timing, rerank state, and whether fallback loaded all chunks.
- Usage telemetry is separate and documented in [USAGE_TELEMETRY.md](USAGE_TELEMETRY.md).

## Quality Checks

```powershell
npm.cmd run rag:check
npm.cmd run rag:rebuild
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

Use the quick suite during normal development and the full suite before release/deployment or after retrieval changes.
