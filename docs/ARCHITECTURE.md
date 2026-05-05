# Architecture

myAI is a plain HTML/CSS/JavaScript frontend backed by a Node.js/Express server and local Ollama. The browser owns private per-user state, while the server owns shared notebook storage and model orchestration. In a department deployment, the server and `data/notebooks/` should live on the department workstation/GPU box, while personal room uploads stay in each user's encrypted browser IndexedDB.

## Main Flows

### Chat

```text
user prompt
-> public/app.js sends POST /api/chat
-> server/ollama.js builds system prompt and document/image context
-> Ollama streams chunks
-> browser renders answer incrementally
-> browser saves encrypted state in IndexedDB
-> /api/followups generates suggestions
```

### Upload

```text
POST /api/upload
-> multer writes a temp file under uploads/
-> server/parsers.js parses the file
-> server/documentAnalysis.js optionally generates summary/topics
-> server/documentStore.js stores a runtime copy
-> full payload returns to the browser for encrypted persistence
```

The server memory document store is a convenience cache only. The durable source for room attachments is the browser IndexedDB state.

### Notebook RAG

```text
chat prompt + room.selectedNotebookId
-> POST /api/chat { notebookId }
-> server/notebooks.js#queryNotebook()
-> query expansion + hybrid retrieval
-> cited chunks become [N] citations
-> server/ollama.js injects notebook context and grounding rules
-> X-Notebook-Meta returns citation metadata
-> browser renders citation markers and panel
```

### Whole Analysis

```text
composer "전체 분석" toggle
-> POST /api/chat { mode: "map_reduce" }
-> server/ollama.js loads all notebook chunks or active room document chunks
-> server/mapReduce.js runs map calls with bounded parallelism
-> reduce answer streams to the browser
```

### Visualization

```text
chart/graph prompt + CSV/XLSX table data
-> public/app.js routes to POST /api/visualize
-> LLM proposes analysis + visualizationPlan JSON
-> server validates exact columns and chart requirements
-> server computes final chart data from real rows
-> browser renders SVG/table/KPI/infographic
```

### Calendar

```text
calendar-like prompt
-> public/app.js keyword prefilter
-> POST /api/agent/intent
-> server/calendarAgent.js returns intent/payload
-> browser mutates local state.calendar.events
```

The LLM does not directly mutate calendar data.

## Responsibilities

- `server/index.js` - Express setup, static serving, upload route, chat/visualize/followup/calendar/notebook endpoints.
- `server/ollama.js` - model calls, streaming chat, prompt assembly, document context, notebook context, Map-Reduce dispatch, visualization LLM calls.
- `server/parsers.js` - upload parsing for PDF, DOCX, XLSX, CSV, PPTX, HWPX, and images.
- `server/documents.js` - document serializers and `pageSections()`.
- `server/documentAnalysis.js` - summary/topic extraction for uploaded and notebook documents.
- `server/notebooks.js` - notebook manifests, document ingest, chunk storage, retrieval, all-chunk loading.
- `server/retrieval.js` - tokenization, BM25, CJK bigrams, cosine similarity, RRF fusion, greedy fitting.
- `server/embeddings.js` - Ollama `/api/embed`.
- `server/queryExpansion.js` - retrieval-friendly query variants.
- `server/mapReduce.js` - map/reduce orchestration.
- `server/calendarAgent.js` - JSON calendar intent classification and deterministic payload cleanup.
- `server/holidays.js` - Korean public-holiday API and fallback.
- `server/visualization.js` - plan normalization, validation, execution, fallback chart specs.
- `server/auth.js` - admin token middleware.
- `public/app.js` - frontend state, persistence, upload/chat/calendar/notebook/settings behavior.
- `public/answerRenderer.js` - markdown-lite answer rendering.
- `public/visualizationRenderer.js` - chart/spec rendering.

## Persistence

Browser:

```text
DB name: ollama-chatter-secure
Object store: records, record id: app-state
Object store: keys, record id: local-aes-gcm-key
```

Stored browser state includes rooms, messages, settings, active room files, selected notebook IDs, active view, and calendar events. It is encrypted with WebCrypto AES-GCM.

Server:

```text
data/notebooks/<notebookId>/manifest.json
data/notebooks/<notebookId>/docs/<documentId>.json
```

Notebook data is shared server-side state and is protected for writes by `ADMIN_TOKEN`.
