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
  mode        // optional; "map_reduce" activates Precision Analysis / Map-Reduce
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

## Studio

### `POST /api/studio/mindmap`

Body:

```js
{
  model,
  documents
}
```

Builds a mind-map graph from the current room's uploaded documents using a
two-pass LLM pipeline. The frontend sends the same browser-persisted document
payload used by chat.

**Pass 1 — concept extraction**: the server evenly samples chunks across the
full document (not just the leading sections) and asks Ollama to return a
structured concept list `{ concepts: [{ id, label, description, category }] }`.

**Pass 2 — mindmap structuring**: the server sends the concept list only (no
raw document text) and asks Ollama to derive node/edge relationships. Because
Pass 2 sees all concepts regardless of where they appeared in the source
document, cross-section relationships are not lost at chunk boundaries.

Web search and department notebook RAG are not used in this flow.

Returns:

```js
{
  mindmap: {
    title,
    generatedAt,
    documentCount,
    groups: [{ id, label }],
    nodes: [{ id, label, summary, group, importance, sourceRefs }],
    edges: [{ from, to, label, strength }],
    warnings: []
  }
}
```

If Ollama fails after documents are supplied, the server returns a deterministic
fallback graph from document names, summaries, and topics. Requests without
text-bearing uploaded documents return `400`.

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

Management UI lives under the main gear button:

```text
Settings
├─ Personal Settings
└─ Admin Console
   ├─ Department Notebook Management
   ├─ System Status
   ├─ Access Management
   │  ├─ Group Management
   │  └─ Super Access
   └─ RAG Evaluation
```

The Admin Console uses `ADMIN_TOKEN` for management routes. Normal notebook
read access uses `/api/access/login` tokens instead.

## Access Control

Department notebook access control is inactive until at least one group level or
Super password is configured. Once active, notebook reads and chat requests that
include `notebookId` require `Authorization: Bearer <access token>`. `ADMIN_TOKEN`
continues to protect management APIs only; it is not a user notebook-read token.

### `GET /api/access/options`

Public. Returns enabled login choices:

```js
{ groups: [{ id, name, description, levels: [1, 2, 3] }], super: { enabled } }
```

### `GET /api/access/status`

Public. With an access token, returns the current group/level or Super session:

```js
{ configured: boolean, authenticated: boolean, access: object | null }
```

### `POST /api/access/login`

Public. Authenticates a group/level password:

```js
{ groupId: "finance", level: 2, password: "..." }
```

or Super:

```js
{ super: true, password: "..." }
```

Returns `{ ok, access, token }` on success.

### `POST /api/access/logout`

Public. Stateless acknowledgement; the browser discards its session token.

### `GET /api/admin/access/groups`

Admin. Lists groups, per-level enabled/password-set flags, and Super status.
Password hashes are never returned.

### `POST /api/admin/access/groups`

Admin. Creates an access group.

### `PATCH /api/admin/access/groups/:groupId`

Admin. Updates group name, description, or enabled state.

### `DELETE /api/admin/access/groups/:groupId`

Admin. Deletes an access group.

### `POST /api/admin/access/groups/:groupId/levels/:level/password`

Admin. Replaces a Level 1-3 password. Existing passwords are not readable.

### `DELETE /api/admin/access/groups/:groupId/levels/:level/password`

Admin. Deletes a Level 1-3 password and disables that level, returning it to
the unset state.

### `PATCH /api/admin/access/groups/:groupId/levels/:level`

Admin. Enables or disables a level.

### `POST /api/admin/access/super/password`

Admin. Replaces the Super read-access password. When a Super password already
exists, the request must include the existing password:

```js
{ currentPassword: string, password: string, confirmPassword: string }
```

For first-time setup, `currentPassword` may be omitted. Existing passwords are
never returned by the API. `confirmPassword` must match `password`; the browser
checks this before sending, and the server validates it again.

### `PATCH /api/admin/access/super`

Admin. Enables or disables Super login.

### `GET /api/admin/status`

Public. Returns whether `ADMIN_TOKEN` is configured:

```js
{ configured: boolean }
```

### `POST /api/admin/verify`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

### `GET /api/notebooks`

Notebook summaries. When access control is active, returns only notebooks the
access token can read. Admin requests include access policies for management.

### `GET /api/notebooks/:id`

Notebook detail. When access control is active, unauthorized users receive 401
or 403. Admin requests include access policies for management.

### `POST /api/notebooks`

Admin. Creates a notebook.

### `PATCH /api/notebooks/:id`

Admin. Updates notebook metadata.

### `PATCH /api/notebooks/:id/access`

Admin. Updates notebook access policy:

```js
{ access: { groups: ["finance", "planning"], minLevel: 2 } }
```

`minLevel` uses Level 1 as the highest privilege. A user authenticated as
Level 1 can read notebooks that require Level 1, 2, or 3; Level 2 can read
notebooks that require Level 2 or 3; Level 3 can read only Level 3 notebooks.

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
