# API

All endpoints are served by `server/index.js`.

## Status

### `GET /api/status`

Returns Ollama connectivity, default model, and model names from `/api/tags`.

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["bge-m3:latest", "gemma4:e2b"]
}
```

## Documents

### `POST /api/upload`

Multipart upload field: `file`.

Returns a full document payload for encrypted browser persistence. Normal documents include best-effort `summary` and `topics`.

### `GET /api/documents`

Returns runtime server-memory document summaries only.

### `GET /api/documents/:id`

Returns a runtime server-memory full document payload if still available.

### `DELETE /api/documents/:id`

Deletes the runtime server-memory document copy only.

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

### `DELETE /api/notebooks/:id/documents/:documentId`

Admin. Removes a single notebook document.

