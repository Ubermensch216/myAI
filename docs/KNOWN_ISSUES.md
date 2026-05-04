# Known Issues And Next Improvements

## High Priority

- Ensure notebook semantic retrieval passes stored `chunk.embedding` into query-time chunk objects before `multiQueryHybridSelect()`.
- Split tests into fast deterministic smoke tests and slower live Ollama integration tests.
- Add browser-level smoke tests for upload, chat, visualization, notebook selection, citations, Map-Reduce, and calendar flows.
- Replace destructive `window.confirm()` flows with in-app review dialogs that show the target objects and consequences.
- Add storage usage and large-file warnings for encrypted IndexedDB state.

## Data And Retrieval

- Uploaded room files are durable in browser IndexedDB, not server memory.
- `/api/chat` sends active document payloads in JSON; large documents/images can hit browser or `MAX_JSON_BYTES` limits.
- Department notebooks are JSON-file based. Large collections should move toward a persistent retrieval index/vector store.
- Document summaries/topics orient the model but are not a replacement for chunk-level grounding.
- Query expansion adds an extra local LLM call per RAG turn and may increase latency.

## Calendar

- Calendar is local-only.
- No recurrence model.
- No external calendar sync.
- Reminder checks depend on an open browser tab.
- No timezone UI.

## UI And Code Organization

- `public/app.js` is large and mixes chat, upload, persistence, calendar, notebook, and settings logic.
- The answer renderer is markdown-lite, not a full Markdown renderer. Replacing it can regress table/list styling.
- The composer `+` menu is intended to remain extensible.

## Operations

- `ADMIN_TOKEN` protects notebook management routes only.
- For production-like deployment, bind the app to `127.0.0.1` behind a reverse proxy and add external auth.
- Reverse proxies must not buffer streaming chat responses.
- CPU-only Ollama can be slow for document analysis and Map-Reduce.

