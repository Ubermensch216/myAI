# Agent Handoff

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX visualizations, a right-side Studio workspace, local calendar commands, department-notebook RAG, Korean law/compliance workflows, answer-as-room-source workflows, whole-document Map-Reduce analysis, room pinning, encrypted browser persistence, usage telemetry, and personalized UI settings.

This file is intentionally short. Keep long explanations in `docs/`.

## Quick Start

```powershell
cd D:\Dev\myAI
npm.cmd start
```

Open:

```text
http://localhost:3000
```

Useful checks:

```powershell
curl.exe -s http://127.0.0.1:11434/api/tags
curl.exe -s http://127.0.0.1:3000/api/status
npm.cmd test
npm.cmd run test:prompt-router
npm.cmd run test:source-workflow
npm.cmd run test:studio-document
npm.cmd run test:xlsx
npm.cmd run test:live
```

## Current Local Model Notes

- Recommended local `.env`: `OLLAMA_MODEL=gemma4:e2b`, `EMBED_MODEL=bge-m3`, `EMBED_DIM=1024`.
- On 2026-05-05, direct Ollama checks showed `bge-m3:latest` and `gemma4:e2b` installed.
- `POST /api/embed` with `bge-m3` returns 1024-dimensional vectors.
- `gemma4:e4b` may be used on hosts with enough memory for stronger review output.
- `/api/status` requires the app server to be running on port 3000.

## Important Server Files

- `server/index.js` - Express routes, uploads, static frontend, API dispatch, rate-limit mounts.
- `server/env.js` - project-root `.env` loader.
- `server/ollama.js` - Ollama chat streaming, prompt construction, context building, RAG and Map-Reduce dispatch.
- `server/promptRouter.js` - classifies `/api/chat` into `strict_law_search`, `map_reduce`, `compliance_review`, `law`, `notebook_rag`, `web_search`, or `normal_chat`.
- `server/exportFiles.js` - assistant answer export generators for MD, XLSX, PDF, HWPX, and DOCX.
- `server/sourceWorkflow/` - answer-as-source, source guide, generated-source metadata, and Studio-output promotion review.
- `server/studioDocument/` - Studio Document templates, answer-to-document conversion, AI edit, validation, and export.
- `server/mindmap.js` - Studio mind-map graph generation from current-room uploaded documents.
- `server/graphStudioApi.js` - Studio knowledge-graph endpoints for accessible department notebooks.
- `server/graphAdminApi.js` - Admin graph inspection, node/edge override, and rebuild endpoints.
- `server/notebooks.js` - department-notebook storage, access policy metadata, dual-write to Qdrant/SQLite, ingest, chunk cache.
- `server/accessControl.js` - group/level and Super read-access passwords, signed access tokens, notebook policy checks.
- `server/rag/departmentRag.js` - expand -> embed -> Qdrant/SQLite -> graph expansion -> RRF -> rerank -> greedyFit -> JSON fallback -> log.
- `server/rag/graph/` - notebook knowledge-graph ontology, extraction, store, rebuild jobs, and query expansion.
- `server/indexes/qdrantVectorIndex.js` - Qdrant collection lifecycle, upsert/delete/search, health.
- `server/indexes/sqliteFtsIndex.js` - SQLite FTS5 lexical index for BM25 and CJK bigram search.
- `server/ingest/notebookIngestJobs.js` - async ingest job queue with retry and startup recovery.
- `server/reranker.js` - cross-encoder reranking via `/api/rerank`; off by default because Ollama does not expose that endpoint.
- `server/modelQueue.js` - in-process queues for embedding, analysis, chat, rerank, and Map-Reduce.
- `server/retrieval.js` - BM25/CJK bigram, cosine similarity, RRF hybrid retrieval.
- `server/embeddings.js` - Ollama `/api/embed` helpers.
- `server/queryExpansion.js` - LLM query expansion for retrieval.
- `server/documentAnalysis.js` - upload-time summary/topic extraction.
- `server/mapReduce.js` - whole-document Precision Analysis.
- `server/calendarAgent.js` - natural-language calendar intent classifier.
- `server/visualization.js` - visualization plan validation and chart data computation.
- `server/compliance/` - department legal-review intent, review-type catalog, prompt construction, and GRC review.
- `server/law/` - Korean Law Engine routes, law.go.kr and decision API clients, citation verification, research, annexes, law-structure links, decisions, impact map, time-travel, and Law Workbench review/report APIs.
- `server/ragEvalApi.js` - Admin RAG Evaluation API, background runs, SSE progress, retrieval-log summaries.
- `server/parsers.js` - PDF/DOCX/XLSX/CSV/PPTX/HWPX/image parsing and chunking.
- `server/auth.js` - `ADMIN_TOKEN` middleware.
- `server/stats/` - privacy-safe usage telemetry writer, reader, and Admin Stats API.
- `server/imageGeneration/` - ComfyUI and Diffusers image providers, jobs queue, and asset storage.
- `services/image-worker/` - FastAPI image generation worker (running Diffusers locally).

## Important Frontend Files

- `public/index.html` - app shell and dialogs.
- `public/app.js` - orchestrator: init, routing, room management, drag/drop, global key bindings, GRC bundle mounting.
- `public/modules/state.js` - global `state`, `elements`, shared utilities including `showConfirmDialog`.
- `public/modules/persistence.js` - IndexedDB and WebCrypto AES-GCM app state save/load.
- `public/modules/chat.js` - streaming chat, message rendering, upload, stop generation, source badges, query-aware trimming.
- `public/modules/calendar.js` - calendar rendering, CRUD, recurrence, reminders, ICS import/export.
- `public/modules/notebook.js` - notebook selector, access login, Admin Console notebook/RAG/access/promotion panels.
- `public/modules/studio.js` - Studio tool controls and mind-map SVG rendering.
- `public/modules/documentStudio.js` - Studio Document Editor, source guides, output library, export.
- `public/modules/docTool.js` - client-side PDF/XLSX/TXT merge and split.
- `public/modules/safeDoc/` - 문서보안 view: client-only personal-information detection and de-identification. `index.js` (public API), `controller.js` (event binders), `detect/` (rules engine), `parsers/` (txt/csv/pdf/xlsx/docx/hwpx), `vendor/` (adapters for pdfjs/pdf-lib/fflate/fontkit), `policies.js` (persistence bridge). Plain ESM, no build step.
- `public/modules/graphStudio.js` - Studio knowledge-graph viewer using Cytoscape.
- `public/modules/lawWorkbench.js` - Law Workbench UI, dedicated review documents, LLM review state, report draft, impact mapping.
- `public/modules/ragEval.js` - Admin RAG Evaluation UI.
- `public/modules/adminStats.js` - Admin usage statistics UI.
- `public/modules/evidenceSummary.js` - citation classification and formatting.
- `public/answerRenderer.js` - markdown-lite rendering and inline citation popups.
- `src/components/GrcWorkbench.svelte` - Svelte GRC Workbench built by Vite into `public/dist/`.

## Core Flows

Chat:

```text
public/modules/chat.js -> POST /api/chat
-> server/promptRouter.js chooses one route
-> server/ollama.js builds prompt/context
-> optional Naver Search, Korean Law Engine, department RAG, or Map-Reduce
-> Ollama streams
-> browser renders and saves encrypted state
```

Answer-as-source:

```text
assistant message action
-> public/modules/sourceWorkflow.js
-> POST /api/source-workflow/from-answer
-> server/sourceWorkflow/* + server/exportFiles.js
-> generatedSource added to room.documents
-> later /api/chat includes it as secondary context
```

Notebook RAG:

```text
selected notebook
-> access token check when access control is active
-> query expansion + embedding
-> Qdrant + SQLite FTS5 + optional graph expansion
-> RRF + optional external rerank
-> greedy context fit + citations in X-Notebook-Meta
```

Precision Analysis:

```text
composer material panel toggle
-> POST /api/chat { mode: "map_reduce" }
-> notebook chunks or active room document chunks
-> map calls + final reduce stream
-> inline citation popup metadata
```

## Key Caveats

- Check `git status --short` before editing.
- Do not revert user changes unless explicitly asked.
- Preserve chat abort behavior through `AbortController` and request `AbortSignal`.
- Preserve browser-owned encrypted persistence and backwards compatibility of `state.settings`, room documents, and generated-source metadata.
- Law Workbench review must not auto-include active chat-room attachments; it has its own dedicated upload scope.
- Naver Search is skipped when uploaded files or a department notebook are active.
- Studio mind maps use active room uploads only.
- Department notebook knowledge graphs are optional and distinct from uploaded-document mind maps.
- `ADMIN_TOKEN` protects management routes only; it is not a notebook-read identity for chat.
- Calendar data is local-only; no Google/Outlook/ICS sync exists beyond file import/export.
- Destructive UI actions should use `showConfirmDialog`.
- 문서보안 (`public/modules/safeDoc/`) must stay client-only: never add `fetch`/`XMLHttpRequest`/`localStorage` there. `npm run test:safedoc` fails the build if you do. The `WorkSession` holding document text and the mapping table must never be assigned to `state` — that is what keeps it out of encrypted persistence. See `docs/SECURITY.md`.
- Visualization must remain plan-first: LLM proposes intent/columns, server validates/computes, browser renders.
- RAG changes must preserve fallback: Qdrant -> SQLite -> JSON/BM25.

## Documentation Index

- `README.md` - operator overview.
- `docs/ARCHITECTURE.md` - system flows and module responsibilities.
- `docs/API.md` - endpoint summary.
- `docs/RAG.md` - dual-profile RAG and Map-Reduce.
- `docs/IMAGE_GENERATION.md` - image generation architecture and operations.
- `docs/DEPARTMENT_RAG_ARCHITECTURE.md` - Qdrant + SQLite + graph topology.
- `docs/KOREAN_LAW_ENGINE.md` - law engine and legal workflow behavior.
- `docs/CALENDAR.md` - local calendar and intent agent behavior.
- `docs/CONTAINER_DEPLOYMENT.md` - Docker Compose deployment.
- `docs/SECURITY.md` - trusted-network boundary and reverse proxy guidance.
- `docs/USAGE_TELEMETRY.md` - usage telemetry and Admin Statistics behavior.
- `docs/DESIGN.md` - UI styling and component rules.
