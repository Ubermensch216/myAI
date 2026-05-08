# Known Issues And Next Improvements

## High Priority

- Browser-level E2E smoke tests (Playwright) still absent for notebook selection, citations, Map-Reduce, and calendar flows. API-level smoke tests now cover upload, chat, visualization, and notebook list.
- Monitor autonomous follow-up suggestion quality and concept depth under varied conversation lengths.

## Data And Retrieval

- Uploaded room files are durable in browser IndexedDB, not server memory.
- `/api/chat` sends active document payloads in JSON; large documents/images can hit browser or `MAX_JSON_BYTES` limits.
- Department notebook retrieval uses Qdrant (vector) + SQLite FTS5 (lexical) when configured; falls back to JSON/in-memory BM25 only when indexed retrieval is unavailable or returns no usable candidates. In fallback mode, large notebooks still degrade in retrieval quality and LRU cache pressure increases under concurrent load.
- Document summaries/topics orient the model but are not a replacement for chunk-level grounding.
- Query expansion adds an extra local LLM call per RAG turn and may increase latency.
- Naver Search only runs for explicit search prompts in normal chat. It is intentionally disabled when uploaded files or a department notebook are active.
- Naver Search quality depends on Naver Open API availability, credentials, and selected search categories (`NAVER_SEARCH_TYPES`).

## Calendar

- Calendar is local-only.
- Calendar recurrence supports simple full-series rules; single-occurrence exceptions and advanced RRULE patterns are still limited.
- No external calendar account sync.
- Reminder checks depend on an open browser tab.
- Calendar is fixed to Asia/Seoul. There is no timezone selection UI.

## UI And Code Organization

- `public/app.js` is now a focused orchestrator (~480 lines) handling init, routing, rooms, and drag-drop. Settings/brand live in `modules/settings.js`; admin event binding in `modules/notebook.js`. Rendering functions (renderRooms, renderMessages) remain in app.js and could be further extracted if needed.
- The answer renderer is markdown-lite, not a full Markdown renderer. Replacing it can regress table/list styling.
- The composer `+` menu is intended to remain extensible.

## Operations

- `ADMIN_TOKEN` protects notebook management routes only.
- The security boundary and deployment checklist now live in `docs/SECURITY.md`.
- For production-like deployment, bind the app to `127.0.0.1` behind a reverse proxy and add TLS, external auth, body-size limits, and rate limits.
- Reverse proxies must not buffer streaming chat responses.
- CPU-only Ollama can be slow for document analysis and Map-Reduce.

## Multi-User / Department Deployment

- There is no per-user server account. All users connecting to the department workstation share the same Ollama model settings and notebook chunk cache.
- Personal data isolation relies entirely on each browser's AES-GCM encryption key. A user who clears their browser storage loses all personal data.
- The notebook chunk cache (`NOTEBOOK_CHUNK_CACHE_MAX`) is a single in-process LRU used by JSON fallback and whole-notebook Map-Reduce. Indexed Qdrant/SQLite hits normally bypass full chunk loading, but fallback-heavy or Map-Reduce-heavy use can still evict more frequently under concurrent load. Tune `NOTEBOOK_CHUNK_CACHE_MAX` upward on a high-core-count department workstation.
- Upload temp files in `uploads/` are personal documents transiently on the department server. Ensure the directory is not accessible outside the process and is cleaned promptly on parse error paths.
