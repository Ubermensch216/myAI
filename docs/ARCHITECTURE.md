# Architecture

myAI is a plain HTML/CSS/JavaScript frontend backed by a Node.js/Express server and local Ollama. The browser owns private per-user state. The server owns shared department notebooks, model orchestration, operational indexes, and admin workflows.

## Deployment Topology

```text
[Personal PC - browser]                 [Department workstation]
  IndexedDB AES-GCM                       Node.js/Express :3000
  |- rooms + messages                      |- Ollama :11434
  |- personal room uploads                 |- Qdrant :6333 optional
  |- generated room sources                |- data/notebooks/
  |- Studio drafts/outputs                 |- data/indexes/
  |- calendar events                       |- data/logs/
  `- settings                              `- uploads/ temp parse only
       |
       ` fetch() -> http(s)://<host>:3000/api
```

Personal uploads are parsed on the server as temporary files, returned to the browser, and persisted only in encrypted IndexedDB. Department notebooks are shared server-side state under `data/notebooks/`.

## Data Ownership

| Data | Location | Notes |
|---|---|---|
| Chat rooms/messages | Browser IndexedDB | encrypted by local AES-GCM key |
| Personal uploads | Browser IndexedDB | server temp file deleted after parse |
| Generated room sources | Browser IndexedDB | marked generated/needs verification |
| Studio drafts/outputs/source guides | Browser IndexedDB | can be reused or submitted for promotion |
| Calendar events/settings | Browser IndexedDB | local-only |
| Law Workbench review state | Browser IndexedDB | includes official evidence snapshot and review result/error |
| Department notebooks | `data/notebooks/` | admin-managed source of truth |
| Qdrant vector index | Qdrant storage | rebuildable from notebooks |
| SQLite FTS index | `data/indexes/department-rag.sqlite` | rebuildable from notebooks |
| Notebook graph index | `data/notebooks/<id>/graph.sqlite` | optional per-notebook index |
| Usage logs | `data/logs/usage-YYYY-MM-DD.jsonl` | metadata only |
| Retrieval/law logs | `data/logs/` | metadata only |
| Source promotion queue | `data/source-promotions/promotions.json` | reviewed before notebook ingest |

## Chat Flow

```text
public/modules/chat.js
-> POST /api/chat
-> server/promptRouter.js resolves one route:
   strict_law_search | map_reduce | compliance_review | law |
   notebook_rag | web_search | normal_chat
-> server/ollama.js builds prompts and evidence context
-> Ollama streams text
-> browser renders incrementally and persists state
-> /api/followups generates suggestions unless no-evidence state suppresses them
```

Important route rules:

- `lawSearchMode: true` forces `strict_law_search`, excluding uploads, notebooks, and web search.
- `mode: "map_reduce"` forces Precision Analysis unless law-search mode is active.
- Department legal-review intent chooses compliance review and can derive a notebook query override.
- Selected notebook chooses department RAG when no stricter route has already matched.
- Explicit web search runs only in normal chat with no active files and no notebook.

## Evidence Sources

| Source | Trigger | Citation family |
|---|---|---|
| Uploaded room documents | files in `/api/chat` body | attachment/internal metadata |
| Generated room sources | generated documents in room materials | attachment/internal metadata with generated trust flags |
| Department notebook RAG | `notebookId` | `[N]` |
| Naver Search | explicit normal-chat search prompt | `[W]` |
| Korean Law Engine | explicit legal prompts or law mode | `[L]` |
| Decisions | law research/decision prompts | `[D]` |
| Map-Reduce | `mode: "map_reduce"` | inline chunk markers such as `[1.2]` |

No-evidence answers suppress source panels and follow-up suggestions.

## Answer Export And Generated Sources

Answer export:

```text
assistant answer action
-> POST /api/export
-> server/exportFiles.js
-> browser downloads MD/XLSX/PDF/HWPX/DOCX
```

Answer-as-source:

```text
assistant answer action
-> POST /api/source-workflow/from-answer
-> generatedSource payload
-> room.documents
-> encrypted IndexedDB
```

Generated sources use `origin: "assistant_answer"`, `trustLevel: "generated"`, `sourceTrust: 0.5`, and labels equivalent to AI-generated / needs verification. `server/ollama.js` treats them as secondary references.

## Studio Workflows

Studio Document:

```text
assistant answer or Studio output
-> public/modules/documentStudio.js
-> POST /api/studio/document/from-answer
-> visual editor / plain-text fallback
-> POST /api/studio/document/export
```

Source guide:

```text
active uploads and/or selected notebook
-> POST /api/source-workflow/source-guide
-> room.studio.outputs
```

Promotion:

```text
Studio output promotion request
-> POST /api/source-workflow/promotions
-> Admin Console promotion review
-> PATCH /api/admin/source-promotions/:id
-> approved markdown ingested into target notebook
```

Mind map:

```text
active uploaded documents
-> POST /api/studio/mindmap
-> server/mindmap.js samples chunks and builds hierarchy
-> public/modules/studio.js renders SVG tree
```

Notebook graph:

```text
selected notebook with graph.sqlite
-> /api/studio/graph/*
-> graphStudioApi checks normal notebook read access
-> Cytoscape renders enabled nodes/edges
```

Admin graph moderation and rebuilds use `/api/admin/graph/*` with `ADMIN_TOKEN`. The Studio graph router also has admin-only rebuild compatibility endpoints under `/api/studio/graph/:notebookId/rebuild`.

## Law And Compliance

Law Workbench:

```text
public/modules/lawWorkbench.js
-> POST /api/law/workbench
-> official statutes/decisions/ordinances/links/history/impact metadata
-> POST /api/law/workbench/review
-> LLM review result or explicit error
-> optional POST /api/law/workbench/report to Studio Document
```

The review endpoint receives only `query`, `conditions`, the supplied `workbench` payload, and `documents` explicitly attached in the Law Workbench UI. It does not discover active chat-room attachments.

GRC Workbench:

```text
primary view "grc"
-> window.MyAIFrontend.mountGrcWorkbench()
-> POST /api/compliance/grc/review
-> optional POST /api/compliance/grc/report/pdf
-> save-to-Studio via myai:grc:save-output
```

The Svelte bundle is built from `src/main.ts` and `src/components/GrcWorkbench.svelte` into `public/dist/`.

## Department RAG

```text
notebookId
-> notebook access check when configured
-> expandQuery()
-> embedTexts()
-> Qdrant dense search if enabled
-> SQLite FTS5 lexical search if enabled
-> optional graph expansion if KG_EXPANSION_ENABLED=1
-> RRF fusion
-> optional external rerank
-> greedyFit()
-> lazy JSON fallback when indexed paths fail or return no candidates
-> citations returned through X-Notebook-Meta
```

`ADMIN_TOKEN` is a management credential only. Notebook reads use group/level or Super access tokens when Department Notebook Access Control is active.

## Precision Analysis

```text
composer material panel toggle
-> POST /api/chat { mode: "map_reduce" }
-> load all selected notebook chunks or active room document chunks
-> map batches through server/mapReduce.js
-> final reduce stream
-> inline citation popup metadata
```

The composer material panel owns detailed material inspection. The room list shows compact state icons only.

## Calendar

```text
calendar-like prompt
-> public/modules/calendar.js keyword prefilter
-> POST /api/agent/intent
-> server/calendarAgent.js returns structured intent
-> browser mutates local state.calendar.events
```

The LLM never directly mutates calendar data.

## Visualization

```text
CSV/XLSX prompt + table data
-> POST /api/visualize
-> LLM proposes a plan
-> server validates columns and computes data
-> browser renders SVG/table/KPI/infographic
```

## Module Responsibilities

- `server/index.js` - Express setup, primary routes, static serving, upload handling, rate-limit mounts.
- `server/ollama.js` - streaming chat, prompt assembly, model calls, RAG and Map-Reduce dispatch.
- `server/promptRouter.js` - deterministic chat route classifier; no model calls.
- `server/parsers.js` - file parsers and document chunk prep.
- `server/chunking.js` - flat and hierarchical chunking policy.
- `server/notebooks.js` - notebook manifests, documents, access policies, index writes, chunk cache.
- `server/rag/departmentRag.js` - department retrieval orchestration.
- `server/rag/graph/*` - notebook graph ontology, extraction, store, expansion, rebuild jobs.
- `server/indexes/*` - Qdrant and SQLite adapters.
- `server/sourceWorkflow/*` - generated sources, source guides, promotion review.
- `server/studioDocument/*` - document templates, answer-to-document, AI edit, export.
- `server/law/*` - Korean Law Engine and Law Workbench.
- `server/compliance/*` - department legal review and GRC review.
- `server/stats/*` - usage telemetry and Admin Stats.
- `public/app.js` - frontend routing/orchestration and Svelte GRC mount.
- `public/modules/chat.js` - chat, upload, streaming, source badges.
- `public/modules/notebook.js` - notebook UI, access login, admin panels, promotion review.
- `public/modules/documentStudio.js` - Studio document workflows.
- `public/modules/lawWorkbench.js` - Law Workbench UI and dedicated document scope.
- `public/modules/graphStudio.js` - Cytoscape notebook graph viewer.
- `public/modules/calendar.js` - local calendar UI and operations.

## Persistence

Browser DB:

```text
DB name: ollama-chatter-secure
stores: records, keys
record: app-state
key: local-aes-gcm-key
```

Server durable state:

```text
data/notebooks/<notebookId>/manifest.json
data/notebooks/<notebookId>/docs/<documentId>.json
data/notebooks/<notebookId>/graph.sqlite
data/source-promotions/promotions.json
data/logs/*.jsonl
data/indexes/department-rag.sqlite
```
