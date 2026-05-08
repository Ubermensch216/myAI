# API

All endpoints are served by `server/index.js`.

## Status

### `GET /api/status`

Returns Ollama connectivity, model names, department RAG backend health, Naver
Search configuration status, model queue depths, and rate-limit settings.

Example shape:

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["bge-m3:latest", "gemma4:e2b"],
  "rag": {
    "department": {
      "backend": { "vector": "qdrant", "lexical": "sqlite" },
      "qdrant": { "configured": true, "ok": true, "collection": "myai_notebook_chunks" },
      "sqlite": { "configured": true, "ok": true, "path": "data/indexes/department-rag.sqlite" }
    }
  },
  "search": {
    "naver": { "enabled": true, "configured": true }
  },
  "queues": {
    "embedding": { "concurrency": 2, "running": 0, "queued": 0 },
    "mapReduce": { "concurrency": 2, "running": 0, "queued": 0 },
    "analysis": { "concurrency": 2, "running": 0, "queued": 0 }
  },
  "rateLimits": {
    "chat": { "max": 20, "windowMs": 60000 },
    "visualize": { "max": 10, "windowMs": 60000 },
    "upload": { "max": 8, "windowMs": 60000 },
    "lightweight": { "max": 30, "windowMs": 60000 },
    "adminWrite": { "max": 10, "windowMs": 60000 }
  }
}
```

Qdrant health is reported as degraded metadata only. A Qdrant outage does not
make `/api/status` fail when Ollama itself is reachable. After changing `.env`,
restart the Node process so status reflects the new values.

## Admin RAG Status

### `GET /api/admin/rag/status`

Admin-oriented status for department RAG health, queue depths, configured rate
limits, and model names.

## Documents

### `POST /api/upload`

Multipart upload field: `file`.

Optional header: `X-MyAI-Document-Key`.

Returns a parsed document payload for encrypted browser persistence. Normal
documents include best-effort `summary` and `topics`. The same document key
scopes the short-lived runtime cache used by `GET` and `DELETE
/api/documents/:id`.

### `GET /api/documents`

Disabled. Runtime personal-document cache entries are not listable.

### `GET /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Returns a
runtime server-memory copy if it is still cached.

### `DELETE /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Deletes the
runtime server-memory copy only.

## Chat

### `POST /api/chat`

Body:

```js
{
  model,
  messages,
  documents,
  personalization,
  notebookId, // optional
  mode        // optional; "map_reduce" activates whole-analysis mode
}
```

Streams plain text from Ollama.

When `NAVER_SEARCH_ENABLED=true` and `NAVER_SEARCH_CLIENT_ID` /
`NAVER_SEARCH_CLIENT_SECRET` are configured, explicit web-search prompts such
as "네이버에서 ... 검색해줘", "최신 뉴스 찾아줘", or "웹에서 조회해줘" cause
the server to call Naver Search before streaming. Normalized search results are
added to model context and may be cited as `[W1]`, `[W2]`, etc.

Naver Search is intentionally skipped when uploaded files are included in the
chat payload or when `notebookId` is selected. Those paths must stay grounded in
the uploaded file context or department notebook RAG context.

If notebook, web-search, or analysis metadata exists, the response includes
`X-Notebook-Meta` as base64 JSON:

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ],
  webSearch: {
    ok,
    query,
    error,
    citations: [
      { citationId, documentName, documentType, locator, url, sourceName }
    ]
  },
  analysisMode: "map_reduce" // or null
}
```

The frontend merges notebook citations and Naver web citations into one source
panel. If the assistant answer is a no-evidence response, such as "관련 정보를
찾을 수 없습니다", the frontend suppresses both the source panel and follow-up
suggestions for that answer.

## Answer Export

### `GET /api/export/formats`

Returns the answer-download formats exposed by the frontend message action
menu: `md`, `xlsx`, `pdf`, `hwpx`, and `docx`.

### `POST /api/export`

Body:

```js
{
  format,  // "md" | "xlsx" | "pdf" | "hwpx" | "docx"
  title,
  content
}
```

Returns a downloadable file with `Content-Disposition: attachment`. The
frontend sends the already-rendered assistant answer text from the message
action menu. `.doc` is intentionally not supported; Word export uses `.docx`.
PDF export embeds a Korean-capable server font when one is available.

## Visualization

### `POST /api/visualize`

Body:

```js
{
  prompt,
  model,
  messages,
  documents,
  personalization
}
```

Returns:

```js
{ visualization }
```

The LLM proposes a plan, and `server/visualization.js` validates and computes
the final chart/table/KPI data from the uploaded CSV/XLSX rows.

## Follow-Ups

### `POST /api/followups`

Body:

```js
{
  model,
  messages,
  personalization
}
```

Returns:

```js
{ suggestions: ["...", "...", "..."] }
```

The frontend does not request or display follow-up suggestions for no-evidence
assistant answers.

## Calendar Agent

### `POST /api/agent/intent`

Body:

```js
{
  prompt,
  model,
  currentDate,
  messages,
  pendingAction
}
```

Returns:

```js
{
  intent: "chat" | "calendar.propose" | "calendar.create" | "calendar.list" | "calendar.delete" | "calendar.update",
  payload: {},
  fallbackReason
}
```

## Holidays

### `GET /api/holidays?year=2026`

Returns Korean public holidays for the requested year. Uses the configured
public API key when available, otherwise a limited fixed-solar-holiday fallback.

## Admin And Notebooks

### `GET /api/admin/status`

Public. Returns whether `ADMIN_TOKEN` is configured:

```js
{ configured: boolean }
```

### `POST /api/admin/verify`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

### `GET /api/notebooks`

Public notebook summaries.

### `GET /api/notebooks/:id`

Public notebook detail.

### `POST /api/notebooks`

Admin. Creates a notebook.

### `PATCH /api/notebooks/:id`

Admin. Updates notebook metadata.

### `DELETE /api/notebooks/:id`

Admin. Deletes a notebook and invalidates related indexes/cache.

### `POST /api/notebooks/:id/documents`

Admin. Synchronous document upload endpoint kept for compatibility.

### `POST /api/notebooks/:id/ingest-jobs`

Admin. Preferred async notebook ingest path. Creates a persistent ingest job
with retry and startup recovery.

### `GET /api/notebooks/:id/ingest-jobs`

Admin. Lists notebook ingest jobs.

### `GET /api/notebooks/:id/ingest-jobs/:jobId`

Admin. Gets one ingest job.

### `POST /api/notebooks/:id/ingest-jobs/:jobId/retry`

Admin. Retries a failed ingest job when the preserved upload file is available.

### `DELETE /api/notebooks/:id/documents/:documentId`

Admin. Deletes a notebook document and removes related index entries.
