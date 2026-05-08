# Agent Handoff

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX visualizations, a local AI calendar agent, department-notebook RAG (Qdrant + SQLite FTS5 with JSON fallback), whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

This file is intentionally short. Keep long explanations in `docs/`.

## Quick Start

```powershell
cd d:\Dev\myAI
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
npm.cmd run test:xlsx
npm.cmd run test:live
```

## Current Local Model Notes

- `.env` should use `OLLAMA_MODEL=gemma4:e2b`.
- `.env` should use `EMBED_MODEL=bge-m3`.
- On 2026-05-05, direct Ollama checks showed:
  - `bge-m3:latest` is installed.
  - `gemma4:e2b` is installed.
  - `POST /api/embed` with `bge-m3` returns 1024-dimensional vectors.
- `/api/status` requires the app server to be running on port 3000.
- Code fallback model in `server/ollama.js`: `gemma3n:e2b`.
- `.env.example` defaults to `OLLAMA_MODEL=gemma3n:e2b` and `EMBED_MODEL=bge-m3`.

## Important Files

Server:

- `server/index.js` - Express routes, uploads, static frontend, API dispatch.
- `server/exportFiles.js` - assistant answer export generators for MD, XLSX, PDF, HWPX, and DOCX.
- `server/ollama.js` - Ollama chat streaming, prompt construction, context building, RAG and Map-Reduce dispatch.
- `server/naverSearch.js` - Naver Search API integration for explicit search prompts.
- `server/notebooks.js` - department-notebook storage, dual-write to Qdrant/SQLite, ingest, chunk cache.
- `server/rag/ragConfig.js` - RAG profile constants; resolves `DEPARTMENT_VECTOR_BACKEND` / `DEPARTMENT_LEXICAL_BACKEND`.
- `server/rag/departmentRag.js` - department retrieval orchestration: expand → embed → Qdrant/SQLite → RRF → rerank → greedyFit → log.
- `server/rag/embeddingValidator.js` - validates embedding dimension and integrity before ingest/query.
- `server/rag/retrievalLogger.js` - privacy-safe JSONL retrieval telemetry.
- `server/indexes/qdrantVectorIndex.js` - Qdrant collection lifecycle, upsert/delete/search, health.
- `server/indexes/sqliteFtsIndex.js` - SQLite FTS5 lexical index for BM25 and CJK bigram search.
- `server/ingest/notebookIngestJobs.js` - async background ingest job queue with retry and startup recovery.
- `server/reranker.js` - cross-encoder reranking via Ollama `/api/rerank`; timeout + graceful fallback.
- `server/modelQueue.js` - in-process concurrency queues for embedding, analysis, rerank, map-reduce.
- `server/retrieval.js` - BM25/CJK bigram, cosine similarity, RRF hybrid retrieval.
- `server/embeddings.js` - Ollama `/api/embed` helpers.
- `server/queryExpansion.js` - LLM query expansion for retrieval.
- `server/documentAnalysis.js` - upload-time summary/topic extraction.
- `server/mapReduce.js` - whole-document Map-Reduce analysis.
- `server/calendarAgent.js` - natural-language calendar intent classifier.
- `server/visualization.js` - visualization plan validation and chart data computation.
- `server/parsers.js` - PDF/DOCX/XLSX/CSV/PPTX/HWPX/image parsing and chunking.
- `server/auth.js` - `ADMIN_TOKEN` middleware.

Frontend:

- `public/index.html` - app shell and dialogs.
- `public/app.js` - orchestrator: init, routing, room management, drag-drop, global key bindings.
- `public/modules/state.js` - global `state` object, `elements` DOM refs, shared utilities (including `showConfirmDialog`). No imports.
- `public/modules/persistence.js` - IndexedDB, WebCrypto AES-GCM, app state save/load.
- `public/modules/calendar.js` - calendar rendering, event CRUD, reminders, intent command bar.
- `public/modules/chat.js` - streaming chat, message rendering, file upload, calendar message handlers, query-aware document trimming.
- `public/modules/notebook.js` - notebook selector UI, admin panel, CRUD, admin event binding.
- `public/modules/settings.js` - brand rendering, settings dialog, theme/color-theme/avatar/banner.
- `public/answerRenderer.js` - markdown-lite answer rendering.
- `public/visualizationRenderer.js` - SVG/table/KPI/infographic rendering.
- `public/styles.css` - layout and theme styles.

Docs:

- `README.md` - user/operator overview.
- `docs/ARCHITECTURE.md` - system flows and module responsibilities.
- `docs/DEPARTMENT_RAG_ARCHITECTURE.md` - Qdrant + SQLite FTS5 topology, ingest strategy, operations.
- `docs/CONTAINER_DEPLOYMENT.md` - Docker Compose deployment, volumes, GPU mode, backup/update.
- `docs/API.md` - endpoint summary.
- `docs/RAG.md` - dual-profile RAG (personal vs. department), ingest flows, reranker, Map-Reduce.
- `docs/CALENDAR.md` - local calendar and intent agent behavior.
- `docs/SECURITY.md` - trusted-network boundary, reverse proxy/TLS/auth/rate-limit guidance.
- `docs/KNOWN_ISSUES.md` - constraints and next improvements.

## Deployment Topology

```
[Personal PC — each user]                [Department Workstation — shared]
  Browser                                   Node.js/Express :3000
  ├─ AES-GCM IndexedDB                      ├─ Ollama :11434 (GPU: DGX Spark / RTX 5090-class)
  │   ├─ rooms + messages                   ├─ Qdrant :6333 (optional)
  │   ├─ personal room uploads              ├─ data/notebooks/
  │   ├─ calendar events                    ├─ data/indexes/ (SQLite FTS5, optional)
  │   └─ app settings                       └─ uploads/ (temp only, cleaned after parse)
  └─ fetch() → http://<dept-host>:3000/api/
```

- Personal data (uploads, calendar, settings, history) lives only in the user's browser IndexedDB.
- Department notebooks live on the server filesystem; GPU-class hardware embeds and queries them.
- Upload temp files are deleted after the parse response — no personal data is retained server-side.
- There is no per-user server account; isolation is by browser AES-GCM key.

## Core Architecture

Chat:

```text
public/modules/chat.js -> POST /api/chat
-> server/ollama.js builds prompt/context
-> optional server/naverSearch.js web context for explicit search prompts only
-> Ollama streams
-> browser renders and saves encrypted state in IndexedDB
-> /api/followups generates autonomous context-aware suggestions
```

Naver Search is skipped when uploaded files are present or a department
notebook is selected. No-evidence answers should not render source panels or
follow-up suggestions.

Notebook RAG:

```text
room.selectedNotebookId
-> server/rag/departmentRag.js#searchNotebook()
-> expandQuery() + embedTexts()
-> Qdrant dense search (DEPARTMENT_VECTOR_BACKEND=qdrant)
-> SQLite FTS5 search (DEPARTMENT_LEXICAL_BACKEND=sqlite)
-> RRF fusion -> cross-encoder rerank (RAG_RERANK_ENABLED=true)
-> greedyFit -> fallback: in-memory BM25 + cosine + RRF
-> [N] citations in X-Notebook-Meta
-> browser renders citation markers/panel
```

Whole analysis:

```text
composer "전체 분석" toggle
-> POST /api/chat { mode: "map_reduce" }
-> notebook chunks or active room document chunks
-> server/mapReduce.js map calls + reduce stream
```

Calendar:

```text
calendar-like prompt
-> refined regex pre-filtering (public/modules/calendar.js)
-> /api/agent/intent (server/calendarAgent.js)
-> client orchestration (isExplicitChat check)
-> browser mutates local state.calendar.events
```

Visualization:

```text
CSV/XLSX prompt
-> /api/visualize
-> LLM proposes plan
-> server validates and computes chart data
-> browser renders final spec
```

## Key Caveats

- `npm.cmd test` runs the fast app-server smoke checks. `npm.cmd run test:live` covers slower Ollama-backed parser/notebook CRUD, embedding, document analysis, and retrieval metadata flows.
- Department RAG uses Qdrant + SQLite FTS5 when configured; falls back to JSON/BM25. Fallback is triggered per-request if either backend is unavailable.
- Notebook chunk cache (`NOTEBOOK_CHUNK_CACHE_MAX`) is a single in-process LRU shared across all sessions. Tune upward on high-core-count servers.
- `/api/chat` propagates client disconnects into Ollama chat streaming and Map-Reduce map/reduce fetches via `AbortSignal`. Keep any new long-running chat path wired to the request signal.
- Uploaded room files are durable in encrypted browser IndexedDB, not in server memory. `server/documentStore.js` is runtime-only cache; empty after server restart.
- `/api/chat` receives active documents in the JSON body. The browser warns on large uploads, shows room/attachment storage estimates, and preflights chat payload size before sending.
- Security boundary is documented in `docs/SECURITY.md`: `ADMIN_TOKEN` protects notebook management only; shared deployments should add reverse-proxy TLS, external auth, request size limits, and rate limits.
- Calendar data is local-only. There is no Google/Outlook/ICS sync.
- Destructive actions (room delete, file delete, notebook/document delete) use `showConfirmDialog` from `public/modules/state.js` (in-app modal, falls back to `window.confirm`).
- Visualization is plan-first and server-validated. XLSX QA covers date serial conversion, cached formula values, merged cells, blanks, mixed-type columns, shared string tables, multi-sheet workbooks, and chart spec regression.

## Editing Rules For Future Agents

- Check `git status --short` before editing.
- Do not revert user changes unless explicitly asked.
- Keep changes scoped and preserve existing plain HTML/CSS/JS patterns.
- Preserve chat abort behavior through `AbortController`.
- Preserve markdown-lite answer rendering unless intentionally replacing it.
- Keep `state.settings` backward compatible with old IndexedDB records.
- Use `--accent` / `--accent-dark` theme tokens for new UI styling.
- If changing visualization, preserve the plan-first contract: LLM chooses intent/columns, server validates/computes, browser renders.
- If changing calendar, preserve the split: LLM extracts intent/fields, browser deterministic code mutates calendar state.
- If changing RAG, preserve the fallback chain: Qdrant → SQLite → JSON/BM25.
