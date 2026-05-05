# RAG And Map-Reduce

## Dual Profile Architecture

The app runs two distinct RAG profiles with different durability and latency
properties. The split is by data origin, not by configuration:

| Profile | Source | Storage | Retrieval entry | Backend |
|---------|--------|---------|-----------------|---------|
| `personal` | Browser-uploaded room attachments (per session) | Encrypted IndexedDB; transmitted in `/api/chat` body | `server/ollama.js#buildContext` | In-process BM25 + cosine + RRF over chunks parsed from the request body |
| `department` | Admin-curated notebooks (`data/notebooks/<id>/`) | Server filesystem JSON manifest + per-document chunk records | `server/rag/departmentRag.js#searchNotebook` | Pluggable — current default `DEPARTMENT_VECTOR_BACKEND=json` (in-memory cosine over loaded chunks). Sprint 2 will add `qdrant`. |

The chat handler in `server/ollama.js` routes by context: when a `notebookId`
is on the request, the department profile fires. Personal context is always
included from the request body documents (when present), so a single chat
turn can blend both profiles' citations in one prompt.

`server/rag/ragConfig.js` exposes profile name constants (`PROFILE_PERSONAL`,
`PROFILE_DEPARTMENT`) and resolves the department backend choice. The
retrieval JSONL log writes the profile and backend per entry, so future
migrations can be measured A/B against the same notebooks.

## Models

Recommended local settings:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
```

`bge-m3` is a good default for Korean semantic retrieval. On 2026-05-05, local direct checks confirmed `bge-m3:latest` is installed and returns 1024-dimensional vectors through `/api/embed`.

## Uploaded Room Documents

Room attachments are stored durably in encrypted browser IndexedDB. On each chat turn, the client sends the active room documents to `POST /api/chat`.

Long document context flow:

```text
documents from browser
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

Ingest flow:

```text
admin upload
-> parseUpload()
-> chunkDocumentSections()
-> embedTexts(chunks)
-> analyzeDocument()
-> write document JSON and manifest summary
```

Query flow:

```text
server/rag/departmentRag.js#searchNotebook(notebookId, query)
-> notebooks.js#getNotebookManifest()
-> notebooks.js#loadNotebookChunksForRetrieval()
-> expand query variants
-> embed query variants (validated against manifest.embedding.dim)
-> multiQueryHybridSelect()  // BM25 + cosine + RRF
-> return cited chunks and cited document summaries
-> retrieval JSONL log entry { profile: "department", backend, ... }
```

`notebooks.js` keeps manifest CRUD, ingest, and the chunk cache. The retrieval
function lives in `server/rag/departmentRag.js` so Sprint 2 can swap the
ranking implementation (Qdrant + SQLite FTS5) without touching ingest or
storage.

The selected chunks become `[N]` citation IDs. `server/ollama.js` injects them into the system prompt, and `server/index.js` exposes citation metadata through `X-Notebook-Meta`.

## Notebook Chunk Cache

Notebook ingest stores `chunks[].embedding`, and `server/notebooks.js` carries those embeddings into query-time chunk objects before calling `multiQueryHybridSelect()`. This enables BM25/CJK bigram ranking and semantic vector ranking to be fused with RRF when the query embedding call succeeds.

Notebook query and whole-notebook Map-Reduce share a small in-memory chunk cache keyed by the notebook manifest. The cache avoids re-reading and parsing every document JSON on repeated turns. `NOTEBOOK_CHUNK_CACHE_MAX` controls how many notebooks can stay hot in memory; document add/delete and notebook delete invalidate the related entry.

## Map-Reduce Whole Analysis

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
