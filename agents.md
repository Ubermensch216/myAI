# Agent Handoff

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX visualizations, a local AI calendar agent, department-notebook RAG, whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

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
- `public/app.js` - state, IndexedDB encryption, chat/calendar/notebook UI.
- `public/answerRenderer.js` - markdown-lite answer rendering.
- `public/visualizationRenderer.js` - SVG/table/KPI/infographic rendering.
- `public/styles.css` - layout and theme styles.

Docs:

- `README.md` - user/operator overview.
- `docs/ARCHITECTURE.md` - system flows and module responsibilities.
- `docs/API.md` - endpoint summary.
- `docs/RAG.md` - document context, notebook retrieval, embeddings, Map-Reduce.
- `docs/CALENDAR.md` - local calendar and intent agent behavior.
- `docs/KNOWN_ISSUES.md` - constraints and next improvements.

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

- Notebook ingest stores `chunks[].embedding`, and `bge-m3` now works locally, but `queryNotebook()` still needs to pass stored embeddings into query-time chunk objects for semantic vector ranking to be active. Verify this before claiming notebook vector search quality.
- Uploaded room files are durable in encrypted browser IndexedDB, not in server memory. `server/documentStore.js` is runtime-only.
- `/api/chat` currently receives active documents in the JSON body. Large documents/images can hit browser storage or `MAX_JSON_BYTES` limits.
- `ADMIN_TOKEN` protects notebook management routes only. The app is otherwise designed as a local/trusted-network tool unless deployed behind additional auth.
- Calendar data is local-only. There is no Google/Outlook/ICS sync.
- Destructive calendar/notebook/file actions still mostly use `window.confirm()`. Rich in-app review dialogs are a good next step.
- `public/app.js` is large and mixes chat, calendar, notebook, persistence, and settings logic. Prefer focused modules when touching substantial areas.

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
