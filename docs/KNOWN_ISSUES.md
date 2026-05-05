# Known Issues And Next Improvements

## High Priority

- Split tests into fast deterministic smoke tests and slower live Ollama integration tests.
- Add browser-level smoke tests for upload, chat, visualization, notebook selection, citations, Map-Reduce, and calendar flows.
- Extend rich in-app review dialogs to remaining non-calendar destructive flows.
- Add storage usage and large-file warnings for encrypted IndexedDB state.
- Keep expanding XLSX/visualization regression fixtures beyond the current date serial, cached formula, merged cell, blank cell, mixed type, and chart spec cases.

## Data And Retrieval

- Uploaded room files are durable in browser IndexedDB, not server memory.
- `/api/chat` sends active document payloads in JSON; large documents/images can hit browser or `MAX_JSON_BYTES` limits.
- Department notebooks are still JSON-file based with an in-memory chunk cache. Large collections should move toward a persistent retrieval index/vector store.
- Document summaries/topics orient the model but are not a replacement for chunk-level grounding.
- Query expansion adds an extra local LLM call per RAG turn and may increase latency.

## Calendar

- Calendar is local-only.
- Calendar recurrence supports simple full-series rules; single-occurrence exceptions and advanced RRULE patterns are still limited.
- No external calendar account sync.
- Reminder checks depend on an open browser tab.
- Calendar is fixed to Asia/Seoul. There is no timezone selection UI.

## UI And Code Organization

- `public/app.js` is large and mixes chat, upload, persistence, calendar, notebook, and settings logic.
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
- The notebook chunk cache (`NOTEBOOK_CHUNK_CACHE_MAX`) is a single in-process LRU; under concurrent load from multiple personal PCs it will evict more frequently than in single-user setups. Tune `NOTEBOOK_CHUNK_CACHE_MAX` upward on a high-core-count department workstation.
- Upload temp files in `uploads/` are personal documents transiently on the department server. Ensure the directory is not accessible outside the process and is cleaned promptly on parse error paths.
