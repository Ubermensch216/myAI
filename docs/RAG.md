# RAG And Map-Reduce

## Dual Profile Architecture

The app runs two distinct RAG profiles with different durability and latency
properties. The split is by data origin, not by configuration:

| Profile | Source | Storage | Retrieval entry | Backend |
|---------|--------|---------|-----------------|---------|
| `personal` | Browser-uploaded room attachments (per session) | Encrypted IndexedDB; transmitted in `/api/chat` body | `server/ollama.js#buildContext` | In-process BM25 + cosine + RRF over chunks parsed from the request body |
| `department` | Admin-curated notebooks (`data/notebooks/<id>/`) | Server filesystem JSON manifest + per-document chunk records | `server/rag/departmentRag.js#searchNotebook` | Pluggable — default `DEPARTMENT_VECTOR_BACKEND=json` and `DEPARTMENT_LEXICAL_BACKEND=memory`; `qdrant` and `sqlite` are recognized degraded-safe backends. |

The chat handler in `server/ollama.js` routes by context: when a `notebookId`
is on the request, the department profile fires. Personal context is always
included from the request body documents (when present), so a single chat
turn can blend both profiles' citations in one prompt.

When Department Notebook Access Control is configured, `/api/chat` validates
the access token before any department notebook retrieval or whole-notebook
Map-Reduce run starts. `ADMIN_TOKEN` remains a management credential and does
not grant chat-time notebook read access.

Admins configure notebook read access from Settings → Admin Console. Access
Management defines groups, enabled levels, level passwords, and optional Super
access; Department Notebook Management assigns allowed groups and minimum
level per notebook. Normal users authenticate from the department-notebook
selector before selecting restricted notebooks.

Web search is a separate, lower-priority context source. Naver Search can run
only for explicit search prompts in normal chat. It is skipped whenever
uploaded files are present or `notebookId` is selected, so file-grounded and
department RAG-grounded answers do not silently mix in external web evidence.

`server/rag/ragConfig.js` exposes profile name constants (`PROFILE_PERSONAL`,
`PROFILE_DEPARTMENT`) and resolves the department backend choice. The
retrieval JSONL log writes the profile and backend per entry, so future
migrations can be measured A/B against the same notebooks.

The target vectorDB architecture and migration units live in
[Department RAG Architecture](DEPARTMENT_RAG_ARCHITECTURE.md).

## Models

Recommended local settings:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
```

`bge-m3` is a good default for Korean semantic retrieval. On 2026-05-05, local direct checks confirmed `bge-m3:latest` is installed and returns 1024-dimensional vectors through `/api/embed`.

## Uploaded Room Documents

Room attachments are stored durably in encrypted browser IndexedDB. On each chat turn, the client sends the active room documents to `POST /api/chat`. When total text exceeds 400K chars, the browser first applies query-aware section trimming before sending.

Long document context flow:

```text
documents in browser
-> public/modules/chat.js#queryTrimDocuments()   // browser-side; skipped when total ≤ 400K chars
   -> score sections by query keyword overlap
   -> greedily fill 400K-char budget, highest-scored sections first
   -> images (kind != "document") pass through untouched
-> server/ollama.js#collectChunks()
-> server/chunking.js#chunkDocumentSections()
-> server/queryExpansion.js#expandQuery()
-> server/embeddings.js#embedTexts()
-> server/retrieval.js#multiQueryHybridSelect()
-> selected context injected into system prompt
```

If embeddings fail, retrieval falls back to BM25/CJK bigram ranking.

## Document Pre-Analysis

`server/documentAnalysis.js` runs during normal upload and notebook ingest when `DOC_ANALYSIS_ENABLED` is true.

It samples the document head/tail up to `DOC_ANALYSIS_MAX_INPUT_CHARS`, asks Ollama for JSON, and stores:

```js
{
  summary: string,
  topics: string[]
}
```

Failures return `{ summary: "", topics: [] }` so upload/ingest can continue.

## Department Notebooks

Notebook storage:

```text
data/notebooks/<notebookId>/manifest.json
data/notebooks/<notebookId>/docs/<documentId>.json
```

Ingest flows:

```text
[Synchronous — POST /api/notebooks/:id/documents]
admin upload -> parseUpload() -> chunkDocumentSections()
-> embedTexts(chunks) -> analyzeDocument()
-> write document JSON + manifest
-> dual-write to Qdrant (if configured) + SQLite FTS5 (if configured)

[Async job — POST /api/notebooks/:id/ingest-jobs]
admin upload -> notebookIngestJobs.js creates job record
-> background runner: same pipeline above, with retry
-> job status polled via GET /api/notebooks/:id/ingest-jobs/:jobId
```

Query flow:

```text
server/rag/departmentRag.js#searchNotebook(notebookId, query)
-> notebooks.js#getNotebookManifest()
-> expandQuery()               // LLM query variants
-> embedTexts(queries)         // validated against manifest.embedding.dim
-> searchQdrantNotebookChunks()   // when DEPARTMENT_VECTOR_BACKEND=qdrant
-> searchSqliteNotebookChunks()   // when DEPARTMENT_LEXICAL_BACKEND=sqlite
-> fuseRankings() via RRF
-> rerankChunks()              // cross-encoder, when RAG_RERANK_ENABLED=true
-> greedyFit(budget)
-> lazy fallback: loadNotebookChunksForRetrieval() + multiQueryHybridSelect()
   only when external indexes fail or return no usable candidates
-> return citations + cited document summaries
-> retrievalLogger JSONL entry { profile, backend, rerank, timing, fallbackLoadedAllChunks, ... }
```

`notebooks.js` owns manifest CRUD, ingest, dual-write, and the chunk cache. The retrieval
orchestration lives in `server/rag/departmentRag.js`; ingest jobs in
`server/ingest/notebookIngestJobs.js`.

When `DEPARTMENT_VECTOR_BACKEND=qdrant`, the department path first attempts
Qdrant dense search through `server/indexes/qdrantVectorIndex.js`. If Qdrant is
not configured, unavailable, missing its collection, or returns no candidates,
the request falls back to the existing JSON chunk search. The full notebook JSON
chunk load is lazy: normal Qdrant/SQLite hits do not read every chunk from
`data/notebooks/`.

When `DEPARTMENT_LEXICAL_BACKEND=sqlite`, the department path also searches
`server/indexes/sqliteFtsIndex.js` and fuses those lexical candidates with
vector candidates using RRF before context budget fitting. The SQLite FTS
`searchText` includes a per-notebook scope token, and every lexical query
requires that token in the `MATCH` expression so notebook filtering happens in
the FTS candidate stage instead of only as a post-filter.

The selected chunks become `[N]` citation IDs. `server/ollama.js` injects them into the system prompt, and `server/index.js` exposes citation metadata through `X-Notebook-Meta`.

If retrieval returns no usable evidence and the assistant says the requested
information cannot be found, the frontend hides the citation panel and does not
generate follow-up suggestions for that no-evidence answer.

## Reranker

When `RAG_RERANK_ENABLED=true`, the department RAG pipeline passes the top
`RERANK_TOP_K` (default 40) RRF-fused candidates to `server/reranker.js` for
cross-encoder scoring via Ollama `/api/rerank`.

```env
RAG_RERANK_ENABLED=true
RERANK_MODEL=bge-reranker-v2-m3
RERANK_TOP_K=40
RERANK_TIMEOUT_MS=8000
```

On timeout or Ollama error, the reranker degrades gracefully — results return
in RRF order with `reranked: false` logged. The reranker call is queued through
`modelQueue.rerankQueue` so it respects GPU concurrency limits.

Quality evaluation:

- `npm run rag:quality-test:quick` evaluates the representative cases marked
  with `"quick": true` in `fixtures/rag/department-golden.json`; use this in
  the normal development loop after retrieval changes.
- `npm run rag:quality-test -- --k 10` evaluates the full annotated fixture for
  release or deployment checks. The current local baseline fixture contains 35
  enabled chunk-level cases across two department notebooks.
- Add `--compare-rerank` to the full command when a reranker model is available
  and you want the with/without reranker delta.

## Notebook Chunk Cache

Notebook ingest stores `chunks[].embedding`, and `server/notebooks.js` carries those embeddings into query-time chunk objects before calling `multiQueryHybridSelect()`. This enables BM25/CJK bigram ranking and semantic vector ranking to be fused with RRF when the query embedding call succeeds.

Notebook JSON fallback and whole-notebook Map-Reduce share a small in-memory
chunk cache keyed by the notebook manifest. Normal department RAG queries that
find Qdrant/SQLite candidates bypass full notebook chunk loading; fallback,
empty-query first-chunk fit, and Map-Reduce still use the cache.
`NOTEBOOK_CHUNK_CACHE_MAX` controls how many notebooks can stay hot in memory;
document add/delete and notebook delete invalidate the related entry.

## Map-Reduce Whole Analysis

In the UI this mode is exposed as **Precision Analysis** (`정밀 분석`) inside
the composer material panel. It is enabled only when the active room has at
least one uploaded document or a selected department notebook. Internally,
Map-Reduce is activated with:

```js
{ mode: "map_reduce" }
```

Input source:

- active notebook: `loadAllNotebookChunks(notebookId)`
- no notebook: active room documents via `collectChunks(documents)`

Flow:

```text
chunks
-> truncate at MAP_REDUCE_MAX_CHUNKS if needed
-> group by MAP_REDUCE_BATCH_CHUNKS
-> run map calls with MAP_REDUCE_PARALLELISM
-> stream final reduce answer
```

This mode is intended for full-document/full-notebook analysis, not normal fast chat.
The composer material panel is the single place where users inspect the active
material tree:

```text
자료(n개)
|- 부서노트북(0/1)
|  |- selected notebook name
|- 첨부(n)
|  |- uploaded file name
```

The room list only shows compact state icons for whether a room has uploaded
attachments and/or a selected department notebook.
