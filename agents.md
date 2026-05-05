# Agent Handoff

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX visualizations, a local AI calendar agent, department-notebook RAG, whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

This file is intentionally short. Keep long explanations in `docs/`.

## Quick Start

```powershell
cd C:\Dev\myAI
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
- `server/ollama.js` - Ollama chat streaming, prompt construction, context building, RAG and Map-Reduce dispatch.
- `server/notebooks.js` - department-notebook storage, ingest, retrieval, admin document operations.
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
- `public/app.js` - orchestrator: init, event binding, room/settings/brand UI; ~848 lines after modularization.
- `public/modules/state.js` - global `state` object, `elements` DOM refs, shared utilities. No imports.
- `public/modules/persistence.js` - IndexedDB, WebCrypto AES-GCM, app state save/load.
- `public/modules/calendar.js` - calendar rendering, event CRUD, reminders, intent command bar.
- `public/modules/chat.js` - streaming chat, message rendering, file upload, calendar message handlers.
- `public/modules/notebook.js` - notebook selector UI, admin panel, CRUD.
- `public/answerRenderer.js` - markdown-lite answer rendering.
- `public/visualizationRenderer.js` - SVG/table/KPI/infographic rendering.
- `public/styles.css` - layout and theme styles.

Docs:

- `README.md` - user/operator overview.
- `docs/ARCHITECTURE.md` - system flows and module responsibilities.
- `docs/API.md` - endpoint summary.
- `docs/RAG.md` - document context, notebook retrieval, embeddings, Map-Reduce.
- `docs/CALENDAR.md` - local calendar and intent agent behavior.
- `docs/SECURITY.md` - trusted-network boundary, reverse proxy/TLS/auth/rate-limit guidance.
- `docs/KNOWN_ISSUES.md` - constraints and next improvements.

## Deployment Topology

```
[Personal PC — each user]                [Department Workstation — shared]
  Browser                                   Node.js/Express :3000
  ├─ AES-GCM IndexedDB                      ├─ Ollama :11434 (GPU: DGX Spark / RTX 5090-class)
  │   ├─ rooms + messages                   ├─ data/notebooks/
  │   ├─ personal room uploads              └─ uploads/ (temp only, cleaned after parse)
  │   ├─ calendar events
  │   └─ app settings
  └─ fetch() → http://<dept-host>:3000/api/
```

- Personal data (uploads, calendar, settings, history) lives only in the user's browser IndexedDB.
- Department notebooks live on the server filesystem; GPU-class hardware embeds and queries them.
- Upload temp files are deleted after the parse response — no personal data is retained server-side.
- There is no per-user server account; isolation is by browser AES-GCM key.

## Core Architecture

Chat:

```text
public/app.js -> POST /api/chat
-> server/ollama.js builds prompt/context
-> Ollama streams
-> browser renders and saves encrypted state in IndexedDB
```

Notebook RAG:

```text
room.selectedNotebookId
-> server/notebooks.js#queryNotebook()
-> expandQuery()
-> multiQueryHybridSelect()
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
-> /api/agent/intent
-> server returns intent/payload only
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

## High-Priority Caveats

- `npm.cmd test` runs the fast app-server smoke checks. `npm.cmd run test:live` covers slower Ollama-backed parser/notebook CRUD, embedding, document analysis, and retrieval metadata flows.
- Notebook ingest stores `chunks[].embedding`, and `queryNotebook()` now passes those stored embeddings into query-time chunk objects. `multiQueryHybridSelect()` can use BM25 + CJK bigram + vector ranking with RRF when query embeddings are available.
- Notebook RAG is still JSON-file + in-memory LRU cache based. For larger department notebooks, plan for a persistent vector index, ingest retry/progress reporting, embedding dimension validation, and retrieval quality logs.
- `/api/chat` now propagates client disconnects into Ollama chat streaming and Map-Reduce map/reduce fetches via `AbortSignal`. Keep any new long-running chat path wired to the request signal.
- Uploaded room files are durable in encrypted browser IndexedDB, not in server memory. `server/documentStore.js` is runtime-only.
- `/api/chat` receives active documents in the JSON body. The browser now warns on large uploads, shows room/attachment storage estimates, offers active-room attachment cleanup, and preflights chat payload size before sending.
- Security boundary is documented in `docs/SECURITY.md`: `ADMIN_TOKEN` protects notebook management only; shared deployments should add reverse-proxy TLS, external auth, request size limits, and rate limits.
- Calendar data is local-only. There is no Google/Outlook/ICS sync.
- Destructive calendar/notebook/file actions still mostly use `window.confirm()`. Rich in-app review dialogs are a good next step.
- Visualization is plan-first and server-validated. XLSX QA now covers date serial conversion, cached formula values, merged cells, blanks, mixed-type columns, and chart spec regression, but XLSX parsing is still not a complete spreadsheet engine.
- `public/app.js` is the orchestrator (~848 lines). Heavy logic lives in `public/modules/`. Cross-module signals use `window.dispatchEvent(new CustomEvent("myai:..."))` to avoid circular imports.

## Editing Rules For Future Agents

- Check `git status --short` before editing.
- Do not revert user changes unless explicitly asked.
- Use `apply_patch` for manual edits.
- Keep changes scoped and preserve existing plain HTML/CSS/JS patterns.
- Preserve chat abort behavior through `AbortController`.
- Preserve markdown-lite answer rendering unless intentionally replacing it.
- Keep `state.settings` backward compatible with old IndexedDB records.
- Use `--accent` / `--accent-dark` theme tokens for new UI styling.
- If changing visualization, preserve the plan-first contract: LLM chooses intent/columns, server validates/computes, browser renders.
- If changing calendar, preserve the split: LLM extracts intent/fields, browser deterministic code mutates calendar state.
