# Known Issues And Next Improvements

## High Priority

- Browser-level E2E smoke tests (Playwright) still absent for Settings tab switching, Admin Console workflows, notebook selection, composer material-panel interactions, citations, Precision Analysis / Map-Reduce, Studio interactions, and calendar flows. API-level smoke tests now cover upload, chat, answer export, Studio mind-map validation, visualization, access status, and notebook list.
- Monitor autonomous follow-up suggestion quality and concept depth under varied conversation lengths.

## Data And Retrieval

- Uploaded room files are durable in browser IndexedDB, not server memory.
- `/api/chat` sends active document payloads in JSON; large documents/images can hit browser or `MAX_JSON_BYTES` limits.
- Department notebook retrieval uses Qdrant (vector) + SQLite FTS5 (lexical) when configured; falls back to JSON/in-memory BM25 only when indexed retrieval is unavailable or returns no usable candidates. In fallback mode, large notebooks still degrade in retrieval quality and LRU cache pressure increases under concurrent load.
- Document summaries/topics orient the model but are not a replacement for chunk-level grounding.
- Query expansion adds an extra local LLM call per RAG turn and may increase latency.
- Naver Search only runs for explicit search prompts in normal chat. It is intentionally disabled when uploaded files or a department notebook are active. When uploaded documents are detected and the prompt matches a search intent pattern, `chat.js` blocks the request client-side and shows a descriptive message before any server call is made.
- Naver Search quality depends on Naver Open API availability, credentials, and selected search categories (`NAVER_SEARCH_TYPES`).
- Answer export supports MD, XLSX, PDF, HWPX, and DOCX. PDF export embeds a Korean-capable server font when available; HWPX generation is text-first and intentionally simpler than a full Hancom-authored document package.
- Studio mind maps use a two-pass LLM pipeline: Pass 1 extracts concepts from evenly sampled chunks spanning the full document; Pass 2 builds node/edge relationships from the concept list. Chunk-boundary relationship loss is therefore reduced compared to a single-pass approach.
- Image-only uploads and files without extracted text are skipped by the Studio mind map pipeline until a multimodal Pass 1 is added.
- Department notebook knowledge graphs are optional per-notebook indexes. Graph expansion is disabled unless `KG_EXPANSION_ENABLED=1`, and graph quality depends on the extraction model plus admin review of low-confidence nodes/edges.
- Graph files live beside notebook data as `data/notebooks/<notebookId>/graph.sqlite`; rebuild or back them up together with the notebook source records when graph-backed retrieval matters.

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
- The composer material panel is the detailed source-of-truth UI for active room materials. The room list should remain compact and show only attachment/notebook presence icons.
- The right Studio panel is intentionally a first extension point. Keep new Studio tools modular instead of folding their logic into `public/app.js`.
- The Studio mind map and Studio knowledge graph are different tools: mind maps use current-room uploaded documents, while the knowledge graph uses the selected department notebook's server-side graph index.

## Operations

- `ADMIN_TOKEN` protects Admin Console management routes only. Notebook reads are public until Department Notebook Access Control is configured; then group/level or Super access tokens are required.
- The security boundary and deployment checklist now live in `docs/SECURITY.md`.
- For production-like deployment, bind the app to `127.0.0.1` behind a reverse proxy and add TLS, external auth, body-size limits, and rate limits.
- Reverse proxies must not buffer streaming chat responses.
- CPU-only Ollama can be slow for document analysis and Map-Reduce.

## Multi-User / Department Deployment

- There is no per-user server account. All users connecting to the department workstation share the same Ollama model settings and notebook chunk cache.
- Personal data isolation relies entirely on each browser's AES-GCM encryption key. A user who clears their browser storage loses all personal data.
- The notebook chunk cache (`NOTEBOOK_CHUNK_CACHE_MAX`) is a single in-process LRU used by JSON fallback and whole-notebook Map-Reduce. Indexed Qdrant/SQLite hits normally bypass full chunk loading, but fallback-heavy or Map-Reduce-heavy use can still evict more frequently under concurrent load. Tune `NOTEBOOK_CHUNK_CACHE_MAX` upward on a high-core-count department workstation.
- Upload temp files in `uploads/` are personal documents transiently on the department server. Ensure the directory is not accessible outside the process and is cleaned promptly on parse error paths.
