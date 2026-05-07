# API

All endpoints are served by `server/index.js`.

## Status

### `GET /api/status`

Returns Ollama connectivity, default model, model names from `/api/tags`, and
non-blocking department RAG backend health.

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["bge-m3:latest", "gemma4:e2b"],
  "rag": {
    "department": {
      "backend": { "vector": "qdrant", "lexical": "memory" },
      "qdrant": {
        "configured": true,
        "ok": true,
        "collection": "myai_notebook_chunks",
        "vectorName": "dense_bge_m3",
        "pointsCount": 1200
      },
      "sqlite": {
        "configured": true,
        "ok": true,
        "path": "D:\\Dev\\myAI\\data\\indexes\\department-rag.sqlite",
        "chunks": 1200
      }
    }
  },
  "queues": {
    "embedding": {
      "concurrency": 2,
      "running": 0,
      "queued": 0,
      "maxQueued": 64,
      "completed": 120,
      "rejected": 0
    },
    "mapReduce": {
      "concurrency": 2,
      "running": 0,
      "queued": 0,
      "maxQueued": 32,
      "completed": 8,
      "rejected": 0
    },
    "analysis": {
      "concurrency": 2,
      "running": 0,
      "queued": 0,
      "maxQueued": 32,
      "completed": 42,
      "rejected": 0
    }
  },
  "rateLimits": {
    "chat": { "max": 20, "windowMs": 60000 },
    "visualize": { "max": 10, "windowMs": 60000 },
    "upload": { "max": 8, "windowMs": 60000 },
    "lightweight": { "max": 30, "windowMs": 60000 },
    "adminWrite": { "max": 10, "windowMs": 60000 },
    "keying": { "header": null }
  }
}
```

Qdrant health is reported as degraded metadata only. A Qdrant outage does not
make `/api/status` fail when Ollama itself is reachable.

When Qdrant is configured but unhealthy, `rag.department.qdrant.reason` is
classified where possible:

- `qdrant_auth_failed`: `QDRANT_API_KEY` does not match the running Qdrant
  service, or Qdrant rejected the JWT/API key.
- `qdrant_timeout`: Qdrant did not respond within `QDRANT_TIMEOUT_MS`.
- `qdrant_unreachable`: the URL, container/service, firewall, or network path is
  not reachable.

The response may include `qdrant.hint` with operator guidance. After changing
`.env`, restart the myAI Node process so the new values are loaded.

## Admin RAG Status

### `GET /api/admin/rag/status`

Admin. Returns detailed department RAG health, queue depths, configured rate
limits, and model names. This endpoint is intended for workstation operations
screens and deployment checks.

## Documents

### `POST /api/upload`

Multipart upload field: `file`.

Optional header: `X-MyAI-Document-Key`.

Returns a full document payload for encrypted browser persistence. Normal documents include best-effort `summary` and `topics`. The same header scopes the short-lived runtime cache used by `GET`/`DELETE /api/documents/:id`.

### `GET /api/documents`

Disabled. Runtime personal-document cache entries are not listable.

### `GET /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Returns a runtime server-memory full document payload if still available.

### `DELETE /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Deletes the runtime server-memory document copy only.

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

If notebook or analysis metadata exists, the response includes `X-Notebook-Meta` as base64 JSON:

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ],
  analysisMode: "map_reduce" // or null
}
```

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

Returns Korean public holidays for the requested year. Uses the configured public API key when available, otherwise a limited fixed-solar-holiday fallback.

## Admin And Notebooks

### `GET /api/admin/status`

Public. Returns:

```js
{ configured: boolean }
```

### `POST /api/admin/verify`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

### `GET /api/notebooks`

Public notebook summaries.

### `GET /api/notebooks/:id`

Public notebook manifest summary plus document summaries.

### `POST /api/notebooks`

Admin. Body:

```js
{ name, description }
```

### `PATCH /api/notebooks/:id`

Admin. Body:

```js
{ name, description }
```

### `DELETE /api/notebooks/:id`

Admin. Removes the entire notebook directory.

### `POST /api/notebooks/:id/documents`

Admin multipart upload field: `file`. Parses and stores chunks. Images are rejected for notebooks.

### `POST /api/notebooks/:id/ingest-jobs`

Admin multipart upload field: `file`. Creates a background notebook ingest job
and returns immediately:

```js
{
  job: {
    id,
    notebookId,
    status: "queued" | "running" | "completed" | "failed",
    stage,       // "queued" | "parsing" | "indexing" | "completed" | "failed"
    progress,    // 0–100
    fileName,
    sizeBytes,
    createdAt,
    updatedAt,
    startedAt,
    finishedAt,
    document,    // populated on completion
    error        // populated on failure
  }
}
```

### `GET /api/notebooks/:id/ingest-jobs`

Admin. Lists recent persisted ingest jobs for one notebook.

### `GET /api/notebooks/:id/ingest-jobs/:jobId`

Admin. Returns one persisted ingest job.

### `POST /api/notebooks/:id/ingest-jobs/:jobId/retry`

Admin. Retries a failed ingest job when the original upload file is still
available in the server-side job directory.

### `DELETE /api/notebooks/:id/documents/:documentId`

Admin. Removes a single notebook document.
