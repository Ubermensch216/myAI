# myAI

myAI is a local Ollama-based AI secretary web app. It provides chat, document and image analysis, CSV/XLSX visualizations, a local calendar agent, department-notebook RAG, whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

## Current Setup

- App URL: <http://localhost:3000>
- Ollama URL: <http://127.0.0.1:11434>
- Recommended chat model: `gemma4:e2b`
- Recommended embedding model: `bge-m3`
- Current local `.env` should use:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
```

On 2026-05-05, direct Ollama checks confirmed `bge-m3:latest` is installed and `/api/embed` returns 1024-dimensional vectors. If `/api/status` fails, start the app server first.

## Features

- Multi-room streaming chat with stop/regenerate/edit/copy flows.
- Upload support for PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, and GIF.
- Upload-time document summary/topic extraction through local Ollama.
- Long-document retrieval with query expansion, BM25/CJK bigram ranking, and optional vector ranking.
- Department notebooks stored on the server filesystem with citation panels in chat.
- Whole-document or whole-notebook analysis through the `전체 분석` Map-Reduce mode.
- Plan-first CSV/XLSX visualizations rendered as SVG/table/KPI/infographic views.
- Local AI calendar intent classification for create/list/delete/update flows.
- Browser IndexedDB persistence encrypted with WebCrypto AES-GCM.
- Personalized app name, avatars, banner, theme, accent color, and custom prompt.

## Requirements

- Node.js 20 or newer
- Ollama
- Required local models:

```bash
ollama pull gemma4:e2b
ollama pull bge-m3
```

The code fallback chat model is `gemma3n:e2b`, and `.env.example` uses that fallback for portability. Pull it too if you plan to use the example defaults unchanged:

```bash
ollama pull gemma3n:e2b
```

## Quick Start

Windows PowerShell:

```powershell
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
copy .env.example .env
npm start
```

Linux/macOS:

```bash
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
cp .env.example .env
npm start
```

Then open <http://localhost:3000>.

## Verification

Check Ollama:

```powershell
curl.exe -s http://127.0.0.1:11434/api/tags
```

Check the app server:

```powershell
curl.exe -s http://127.0.0.1:3000/api/status
```

Run fast smoke tests while the app server is running:

```powershell
npm.cmd test
```

The smoke test covers app shell IDs, `/api/status`, and calendar intent classification. Run deterministic XLSX/visualization regression tests without Ollama:

```powershell
npm.cmd run test:xlsx
```

Run the slower live tests when Ollama is running and you want to exercise parser behavior, notebook CRUD, embeddings, document analysis, and notebook query metadata:

```powershell
npm.cmd run test:live
```

Uploaded room files are stored in the browser's encrypted IndexedDB and are sent back in `/api/chat` requests as JSON. The UI shows approximate room/attachment storage, warns before large uploads, provides an active-room attachment cleanup action, and blocks chat requests that are too close to the server JSON body limit.

The XLSX regression test covers Excel date serial conversion, cached formula values, merged cells, blanks, mixed-type columns, and server-computed chart specs.

## Configuration

`server/env.js` loads `.env` from the project root. Existing process environment variables take precedence.

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | unset | HTTP bind host; unset listens on all interfaces |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `gemma3n:e2b` | default chat/analysis model |
| `EMBED_MODEL` | `bge-m3` | Ollama `/api/embed` model |
| `KOREA_HOLIDAY_SERVICE_KEY` | unset | optional Korean public-holiday API key |
| `ADMIN_TOKEN` | unset | bearer token for notebook management APIs |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body limit |
| `MAX_UPLOAD_BYTES` | `41943040` | single upload limit |
| `MAX_CONTEXT_CHARS` | `24000` | uploaded-document context budget |
| `CHUNK_WINDOW_CHARS` | `1024` | sliding chunk size |
| `CHUNK_OVERLAP_CHARS` | `256` | sliding chunk overlap |
| `NOTEBOOK_QUERY_BUDGET` | `12000` | notebook RAG context budget |
| `NOTEBOOK_CHUNK_CACHE_MAX` | `4` | hot notebook chunk caches kept in server memory |
| `QUERY_EXPANSION_ENABLED` | `true` | enable LLM query expansion |
| `QUERY_EXPANSION_VARIANTS` | `3` | generated query variants |
| `QUERY_EXPANSION_TIMEOUT_MS` | `6000` | query expansion timeout |
| `DOC_ANALYSIS_ENABLED` | `true` | upload/notebook summary and topic extraction |
| `DOC_ANALYSIS_MAX_INPUT_CHARS` | `12000` | document analysis sample budget |
| `DOC_ANALYSIS_TIMEOUT_MS` | `30000` | document analysis timeout |
| `MAP_REDUCE_BATCH_CHUNKS` | `4` | chunks per map call |
| `MAP_REDUCE_MAX_CHUNKS` | `80` | maximum chunks per whole-analysis run |
| `MAP_REDUCE_PARALLELISM` | `2` | concurrent map calls |
| `MAP_REDUCE_MAP_TIMEOUT_MS` | `45000` | map-call timeout |

## Project Structure

```text
server/
  index.js             Express server, static files, API routes
  env.js               project-root .env loader
  ollama.js            chat/followups/visualization calls, RAG and Map-Reduce dispatch
  embeddings.js        Ollama /api/embed helpers
  queryExpansion.js    LLM query expansion
  documentAnalysis.js  document summary/topic extraction
  mapReduce.js         whole-document Map-Reduce
  calendarAgent.js     calendar intent classifier
  holidays.js          Korean holiday API/fallback
  chunking.js          shared section chunking policy
  notebooks.js         notebook storage, ingest, retrieval
  auth.js              ADMIN_TOKEN middleware
  parsers.js           file parsers and text splitting primitives
  retrieval.js         BM25/CJK bigram, cosine, RRF retrieval
  visualization.js     visualization validation and chart data
  documents.js         serializers and pageSections()
  documentStore.js     runtime-only document cache

public/
  index.html
  app.js               orchestrator (~776 lines)
  modules/
    state.js           global state, DOM refs, shared utilities
    persistence.js     IndexedDB + WebCrypto AES-GCM
    calendar.js        calendar rendering, CRUD, reminders
    chat.js            streaming chat, message rendering, file upload
    notebook.js        notebook selector UI and admin panel
  answerRenderer.js
  visualizationRenderer.js
  fileDisplay.js
  textRepair.js
  styles.css

docs/
  ARCHITECTURE.md
  API.md
  RAG.md
  CALENDAR.md
  SECURITY.md
  KNOWN_ISSUES.md
```

## More Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [RAG and Map-Reduce](docs/RAG.md)
- [Calendar](docs/CALENDAR.md)
- [Security and Deployment Boundary](docs/SECURITY.md)
- [Known Issues](docs/KNOWN_ISSUES.md)
- [Deployment](deploy/DEPLOY.md)

## Deployment Model

myAI uses a two-tier design:

- **Department workstation** (DGX Spark / RTX 5090-class GPU): runs the Node.js server + Ollama. Stores department notebooks under `data/notebooks/`. Multiple personal PCs connect to this shared server.
- **Personal PC (browser-only)**: each user's browser holds private data (rooms, uploads, calendar, settings) in encrypted IndexedDB. Personal documents are parsed server-side, returned in the API response, and persisted in the browser. The server stores no personal copy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.
See [docs/SECURITY.md](docs/SECURITY.md) before exposing the app beyond localhost or a trusted LAN.

## Known Constraints

- Uploaded room files and calendar data are durable in browser IndexedDB, not server memory.
- Department notebooks are stored as JSON files under `data/notebooks/`; large collections will eventually need a persistent vector index.
- There is no per-user server account; personal data isolation is by browser AES-GCM encryption key.
- `ADMIN_TOKEN` protects notebook management only. Use reverse-proxy auth/TLS/rate limits for production-like shared deployments.
- Calendar is local-only; there is no Google Calendar, Outlook, or ICS sync.
- Map-Reduce is slower than normal chat and truncates beyond `MAP_REDUCE_MAX_CHUNKS`.
- Legacy binary `.hwp` and `.xls` are not parsed directly. Use HWPX/XLSX.

## License

Private project. Not yet released under an open-source license.
