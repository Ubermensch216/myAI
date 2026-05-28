# API

All routes are served by `server/index.js` or routers mounted from it. Most responses are JSON except streaming chat and binary exports.

## Status

### `GET /api/status`

Returns Ollama connectivity, configured models, RAG backend health, search/law status, queue depths, and rate limits. Qdrant/SQLite problems are reported as degraded metadata and do not make the app status fail when Ollama is reachable.

### `GET /api/admin/rag/status`

Admin-only RAG/queue/rate-limit status for the Admin Console.

### `GET /api/admin/status`

Public. Returns whether `ADMIN_TOKEN` is configured.

### `POST /api/admin/verify`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

## Documents And Uploads

### `POST /api/upload`

Multipart field: `file`.

Optional header: `X-MyAI-Document-Key`.

Parses PDF, DOCX, XLSX, CSV, PPTX, HWPX, and common image formats. Returns a document payload for encrypted browser persistence. Temp upload files are deleted after parsing. A short-lived runtime cache is scoped by the document key.

### `GET /api/documents`

Disabled. Runtime personal-document cache entries are not listable.

### `GET /api/documents/:id`

Requires the same `X-MyAI-Document-Key` used at upload. Returns the runtime cache copy if still present.

### `DELETE /api/documents/:id`

Deletes the runtime cache copy only.

## Chat

### `POST /api/chat`

Body:

```js
{
  model,
  messages,
  documents,
  personalization,
  notebookId,
  mode,          // "map_reduce" for Precision Analysis
  lawSearchMode  // true for strict Korean Law Engine only
}
```

Streams plain text from Ollama. Metadata is returned through `X-Notebook-Meta` as base64 JSON when notebook, law, web, compliance, or analysis metadata exists.

Core metadata shape:

```js
{
  notebook,
  citations,
  webSearch,
  law,
  compliance,
  analysisMode
}
```

Citation families:

- `[N]`: department notebook.
- `[W]`: Naver Search.
- `[L]`: statutes, law articles, interpretations, admin rules, ordinances, annexes, linked law sources.
- `[D]`: Constitutional Court or administrative-appeal decisions.
- Map-Reduce markers such as `[1.2]`: chunk-level inline popup citations.

Naver Search runs only for explicit normal-chat search prompts and is skipped when uploaded files or `notebookId` are present. `lawSearchMode: true` excludes uploaded documents, notebooks, and web search.

## Follow-Ups

### `POST /api/followups`

Body:

```js
{ model, messages, personalization }
```

Returns `{ suggestions: [...] }`. The frontend suppresses follow-ups for no-evidence answers.

## Visualization

### `POST /api/visualize`

Body:

```js
{ prompt, model, messages, documents, personalization }
```

The LLM proposes a visualization plan. `server/visualization.js` validates exact columns and computes final SVG/table/KPI/infographic data from uploaded rows.

## Calendar And Holidays

### `POST /api/agent/intent`

Body:

```js
{ prompt, model, currentDate, messages, pendingAction }
```

Returns:

```js
{
  intent: "chat" | "calendar.propose" | "calendar.create" |
          "calendar.list" | "calendar.delete" | "calendar.update",
  payload,
  fallbackReason
}
```

The browser performs all calendar mutations locally.

### `GET /api/holidays?year=2026`

Returns Korean public holidays from the configured public API or a limited fallback.

## Export

### `GET /api/export/formats`

Returns `md`, `xlsx`, `pdf`, `hwpx`, and `docx`.

### `POST /api/export`

Body:

```js
{ format, title, content }
```

Returns a downloadable file. `.doc` is not supported; Word export uses `.docx`.

## Source Workflow

### `POST /api/source-workflow/from-answer`

Body:

```js
{
  messageId,
  title,
  answerMarkdown,
  format, // "md" | "pdf" | "docx" | "hwpx"
  metadata
}
```

Returns `generatedSource`, a document-like room source marked as generated/needs verification. Binary `dataBase64` is included only when the generated file is below `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES`.

### `POST /api/source-workflow/source-guide`

Body:

```js
{ title, documents, notebookId, model }
```

Builds a source guide from uploaded room documents and/or the selected department notebook. If notebook access control is active, a normal notebook-read access token is required unless the request is admin-authenticated.

### `POST /api/source-workflow/promotions`

Creates a pending department-notebook promotion request for a Studio output. It does not modify the notebook until admin approval.

### `GET /api/admin/source-promotions`

Admin-only. Lists pending and reviewed promotion requests without full markdown body.

### `PATCH /api/admin/source-promotions/:id`

Admin-only. Body:

```js
{ status: "approved" | "rejected", reviewNote, approvedBy }
```

Approval ingests reviewed markdown into the target notebook with provenance metadata.

## Studio

### `POST /api/studio/mindmap`

Body:

```js
{ model, documents }
```

Builds a hierarchical mind-map graph from current room uploads only. Web search and department RAG are not used.

### `GET /api/studio/document/templates`

Returns built-in document templates.

### `POST /api/studio/document/from-answer`

Converts answer markdown into a template-structured document draft. If structuring fails, the frontend opens the original answer as plain text.

### `POST /api/studio/document/ai-edit`

Applies an AI edit to a bounded Studio document text selection/body using `server/studioDocument/aiEdit.js`.

### `POST /api/studio/document/export`

Exports the edited Studio document as HWPX, DOCX, PDF, or MD. Legacy block payloads are normalized server-side.

## Studio Graph

Studio graph endpoints use normal notebook read access and return only enabled graph content.

```text
GET  /api/studio/graph/ontology
GET  /api/studio/graph/notebooks
GET  /api/studio/graph/:notebookId/stats
GET  /api/studio/graph/:notebookId/search?q=term&limit=20
GET  /api/studio/graph/:notebookId/subgraph?mode=top|around&type=&limit=&nodeId=&hops=
GET  /api/studio/graph/:notebookId/node/:nodeId
GET  /api/studio/graph/:notebookId/edge/:edgeId
POST /api/studio/graph/:notebookId/rebuild        // admin-only compatibility route
GET  /api/studio/graph/:notebookId/rebuild/status
```

## Korean Law Engine

All `/api/law/*` routes are mounted from `server/law/lawApi.js`. Most require `LAW_API_ENABLED=true` and `LAW_OC` or `KOREAN_LAW_API_KEY`, except decision routes which use the decision API config.

```text
GET  /api/law/status
GET  /api/law/tools
GET  /api/law/terms?q=&limit=
POST /api/law/execute
POST /api/law/workbench
POST /api/law/workbench/review
POST /api/law/workbench/report
POST /api/law/search
POST /api/law/ai-search
POST /api/law/research
POST /api/law/action-plan
POST /api/law/article
POST /api/law/article/at
POST /api/law/article/diff
POST /api/law/history
POST /api/law/time-travel
POST /api/law/verify-citations
POST /api/law/precedents/search
POST /api/law/precedents/detail
POST /api/law/interpretations/search
POST /api/law/interpretations/detail
POST /api/law/admin-rules/search
POST /api/law/admin-rules/detail
POST /api/law/ordinances/search
POST /api/law/ordinances/detail
POST /api/law/annexes/search
POST /api/law/annexes/detail
POST /api/law/impact-map
POST /api/law/three-tier
POST /api/law/delegated-laws
POST /api/law/linked-ordinances
POST /api/law/linked-ordinance-articles
POST /api/law/linked-laws-from-ordinance
POST /api/law/decisions/search
POST /api/law/decisions/detail
```

Law Workbench review diagnostics are logged without prompt text or document body. The review endpoint does not auto-attach chat-room documents.

## Compliance And GRC

### `POST /api/compliance/grc/review`

Body includes target text, optional policy text or notebook id, and model. Returns structured GRC review JSON including summary, risk, per-rule results, missing information, and `draftOpinion`.

### `POST /api/compliance/grc/report/pdf`

Generates a GRC report PDF from a structured review payload.

Department legal-review chat flows are routed through `/api/chat` by `server/promptRouter.js` and `server/compliance/*`.

## Access Control

Notebook access control is inactive until at least one enabled group level password or enabled Super password exists. Once active, notebook reads and chat requests with `notebookId` require `Authorization: Bearer <access token>`.

```text
GET    /api/access/options
GET    /api/access/status
POST   /api/access/login
POST   /api/access/logout
GET    /api/admin/access/groups
POST   /api/admin/access/groups
PATCH  /api/admin/access/groups/:groupId
DELETE /api/admin/access/groups/:groupId
POST   /api/admin/access/groups/:groupId/levels/:level/password
DELETE /api/admin/access/groups/:groupId/levels/:level/password
PATCH  /api/admin/access/groups/:groupId/levels/:level
POST   /api/admin/access/super/password
PATCH  /api/admin/access/super
```

Level 1 is highest privilege, then Level 2, then Level 3. `ADMIN_TOKEN` is not a chat-time notebook-read credential.

## Notebooks And Ingest

```text
GET    /api/notebooks
GET    /api/notebooks/:id
POST   /api/notebooks
PATCH  /api/notebooks/:id
PATCH  /api/notebooks/:id/access
DELETE /api/notebooks/:id
POST   /api/notebooks/:id/documents
DELETE /api/notebooks/:id/documents/:documentId
POST   /api/notebooks/:id/ingest-jobs
GET    /api/notebooks/:id/ingest-jobs
GET    /api/notebooks/:id/ingest-jobs/:jobId
POST   /api/notebooks/:id/ingest-jobs/:jobId/retry
```

Async ingest jobs are preferred for large notebooks. The synchronous document upload route remains for compatibility.

## Admin RAG Evaluation

All endpoints require `ADMIN_TOKEN`.

```text
GET    /api/admin/rag-eval/golden
PUT    /api/admin/rag-eval/golden
PUT    /api/admin/rag-eval/golden/case
DELETE /api/admin/rag-eval/golden/case?suiteId=&caseId=
GET    /api/admin/rag-eval/runs?limit=50
POST   /api/admin/rag-eval/runs
GET    /api/admin/rag-eval/runs/:id
GET    /api/admin/rag-eval/runs/:id/stream
DELETE /api/admin/rag-eval/runs/:id
GET    /api/admin/rag-eval/retrieval-log/summary?days=7&profile=department&notebookId=
```

Run progress streams through SSE.

## Admin Knowledge Graph

All endpoints require `ADMIN_TOKEN`.

```text
GET  /api/admin/graph/ontology
GET  /api/admin/graph/:notebookId/stats
GET  /api/admin/graph/:notebookId/nodes?type=&q=&limit=&offset=&enabledOnly=
GET  /api/admin/graph/:notebookId/search?q=&limit=
GET  /api/admin/graph/:notebookId/subgraph
GET  /api/admin/graph/:notebookId/node/:nodeId
GET  /api/admin/graph/:notebookId/edge/:edgeId
POST /api/admin/graph/:notebookId/node/:nodeId/toggle
POST /api/admin/graph/:notebookId/node/:nodeId/clear-override
POST /api/admin/graph/:notebookId/edge/:edgeId/toggle
POST /api/admin/graph/:notebookId/edge/:edgeId/clear-override
POST /api/admin/graph/:notebookId/rebuild
GET  /api/admin/graph/:notebookId/rebuild/status
GET  /api/admin/graph/:notebookId/rebuild/jobs?limit=20
```

## Admin Statistics

All endpoints require `ADMIN_TOKEN` and read metadata-only usage JSONL logs.

```text
GET /api/admin/stats/summary?range=7d
GET /api/admin/stats/groups?range=7d
GET /api/admin/stats/notebooks?range=7d
GET /api/admin/stats/knowledge-packs?range=7d
GET /api/admin/stats/sessions?range=7d&page=1&pageSize=50
```

`range` accepts `<N>d` and is clamped by the reader. Session page size is clamped server-side.
