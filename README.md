# myAI

myAI is a local Ollama-based AI secretary web app. It provides chat, document and image analysis, CSV/XLSX visualizations, a right-side Studio workspace with document mind maps, a local calendar agent, department-notebook RAG, whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

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

- Multi-room streaming chat with stop/regenerate/edit/copy/download flows.
- Autonomous, context-aware follow-up suggestions grounded in conversation logic.
- Upload support for PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, and GIF.
- Upload-time document summary/topic extraction through local Ollama.
- Long-document retrieval with query expansion, BM25/CJK bigram ranking, and optional vector ranking.
- Department notebooks stored on the server filesystem with citation panels in chat and optional group/level access control.
- Explicit web-search prompts can use Naver Search API context in normal chat.
- Assistant answers can be exported from the message action menu as MD, XLSX, PDF, HWPX, or DOCX.
- Three-pane workspace with a resizable left panel, resizable/collapsible Studio panel, and an uploaded-document mind map tool.
- Whole-document or whole-notebook **Precision Analysis** ("정밀 분석") through the Map-Reduce mode. The control is available only when the active room has uploaded documents or a selected department notebook.
- Plan-first CSV/XLSX visualizations rendered as SVG/table/KPI/infographic views.
- Refined AI calendar intent classification with hardened client-side orchestration.
- Browser IndexedDB persistence encrypted with WebCrypto AES-GCM.
- Unified Settings dialog with Personal Settings and an Admin Console tab.
- Personalized app name, avatars, banner, theme, built-in or custom 3-color accent palette, and custom prompt.
- Admin Console for department notebooks, system status, access groups/levels, and notebook access policies.

## Requirements

- Node.js 24 or newer
- Ollama
- Docker Engine or Docker Desktop, if running the containerized stack
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

## Docker Quick Start

The portable container stack runs the web app, Qdrant, and Ollama through
Docker Compose. It is the recommended path when moving the system to another
computer or to Linux.

```bash
cp deploy/container.env.example .env
# Edit .env and set ADMIN_TOKEN and QDRANT_API_KEY to long random values.
docker compose up -d --build
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Open <http://localhost:3000>. Check the stack:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

For NVIDIA GPU acceleration on a Linux host with the NVIDIA Container Toolkit:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

Persistent container data lives in Docker volumes:

- `myai-data` for notebooks, SQLite FTS, ingest jobs, and retrieval logs.
- `qdrant-storage` and `qdrant-snapshots` for Qdrant.
- `ollama-data` for downloaded Ollama models.

The older `deploy/docker-compose.department.yml` starts Qdrant only. Use the
root `compose.yml` when you want the whole app stack in containers.

To refresh service images and rebuild the app image later:

```bash
npm run docker:update
docker compose exec app npm run rag:check
```

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

The smoke test covers app shell IDs, `/api/status`, notebook list, file upload, answer export, Studio mind-map validation, visualization error handling, chat, and calendar intent classification. Run deterministic XLSX/visualization regression tests without Ollama:

```powershell
npm.cmd run test:xlsx
```

Run the slower live tests when Ollama is running and you want to exercise parser behavior, notebook CRUD, embeddings, document analysis, and notebook query metadata:

```powershell
npm.cmd run test:live
```

For department RAG changes, run the fast golden-set check first and the full
quality evaluation before release or deployment:

```powershell
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

Uploaded room files are stored in the browser's encrypted IndexedDB and are sent back in `/api/chat` requests as JSON. The UI shows compact material status in the room list, exposes detailed uploaded-file cleanup from the composer material panel, warns before large uploads, and blocks chat requests that are too close to the server JSON body limit.

The XLSX regression test covers Excel date serial conversion, cached formula values, merged cells, blanks, mixed-type columns, shared string tables, multi-sheet workbooks, invalid plan validation, and server-computed chart specs.

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
| `ACCESS_TOKEN_SECRET` | generated under `data/access/` | optional HMAC secret for notebook-read access tokens; set explicitly for multi-instance deployments |
| `ACCESS_TOKEN_TTL_SECONDS` | `43200` | lifetime of group/level or Super notebook-read access tokens |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body limit |
| `MAX_UPLOAD_BYTES` | `41943040` | single upload limit |
| `MAX_CONTEXT_CHARS` | `24000` | uploaded-document context budget |
| `MINDMAP_P1_MAX_CONTEXT` | `18000` | Pass 1 concept-extraction document context budget |
| `MINDMAP_P1_MAX_CHUNKS` | `8` | max evenly-sampled chunks per document in Pass 1 (spans full document) |
| `MINDMAP_P1_MAX_CONCEPTS` | `20` | max concepts extracted per Pass 1 run |
| `MINDMAP_MAX_NODES` | `16` | max generated Studio mind-map nodes (Pass 2) |
| `MINDMAP_MAX_EDGES` | `24` | max generated Studio mind-map edges (Pass 2) |
| `DOCUMENT_CACHE_TTL_MS` | `21600000` | same-browser runtime cache lifetime for recently uploaded personal documents |
| `DOCUMENT_CACHE_MAX_ENTRIES` | `256` | max personal upload cache entries kept in server memory |
| `CHUNK_WINDOW_CHARS` | `1024` | sliding chunk size |
| `CHUNK_OVERLAP_CHARS` | `256` | sliding chunk overlap |
| `NOTEBOOK_QUERY_BUDGET` | `12000` | notebook RAG context budget |
| `NOTEBOOK_CHUNK_CACHE_MAX` | `4` | hot notebook chunk caches kept in server memory |
| `QUERY_EXPANSION_ENABLED` | `true` | enable LLM query expansion |
| `QUERY_EXPANSION_VARIANTS` | `3` | generated query variants |
| `QUERY_EXPANSION_TIMEOUT_MS` | `6000` | query expansion timeout |
| `NAVER_SEARCH_ENABLED` | `true` | enable Naver Search context for explicit web-search prompts |
| `NAVER_SEARCH_CLIENT_ID` | unset | Naver Search API client ID; server-side only |
| `NAVER_SEARCH_CLIENT_SECRET` | unset | Naver Search API client secret; server-side only |
| `NAVER_SEARCH_TYPES` | `news,webkr` | comma-separated Naver search types to query |
| `NAVER_SEARCH_DISPLAY` | `5` | result count requested per Naver search type |
| `NAVER_SEARCH_MAX_RESULTS` | `8` | max normalized search results passed to the LLM |
| `NAVER_SEARCH_TIMEOUT_MS` | `4500` | timeout per Naver Search API request |

Naver Search only runs for explicit web-search prompts in normal chat. It is
skipped when uploaded files are present or a department notebook is selected, so
file-grounded and RAG-grounded answers stay within their provided evidence.
When no relevant evidence is found, the UI suppresses source panels and
follow-up suggestions for that no-evidence answer.

| `DOC_ANALYSIS_ENABLED` | `true` | upload/notebook summary and topic extraction |
| `DOC_ANALYSIS_MAX_INPUT_CHARS` | `12000` | document analysis sample budget |
| `DOC_ANALYSIS_TIMEOUT_MS` | `30000` | document analysis timeout |
| `MAP_REDUCE_BATCH_CHUNKS` | `4` | chunks per map call |
| `MAP_REDUCE_MAX_CHUNKS` | `80` | maximum chunks per Precision Analysis / Map-Reduce run |
| `MAP_REDUCE_PARALLELISM` | `2` | concurrent map calls |
| `MAP_REDUCE_MAP_TIMEOUT_MS` | `45000` | map-call timeout |
| `TRUST_PROXY` | `false` | enables Express proxy IP handling when behind a trusted reverse proxy |
| `RATE_LIMIT_KEY_HEADER` | unset | optional trusted proxy-auth user header used for rate-limit keys |

## Project Structure

```text
server/
  index.js             Express server, static files, API routes
  env.js               project-root .env loader
  exportFiles.js       answer export generators for MD/XLSX/PDF/HWPX/DOCX
  mindmap.js           Studio mind-map graph generation from uploaded documents
  ollama.js            chat/followups/visualization calls, RAG and Map-Reduce dispatch
  naverSearch.js       Naver Search API integration for explicit search prompts
  embeddings.js        Ollama /api/embed helpers
  queryExpansion.js    LLM query expansion
  documentAnalysis.js  document summary/topic extraction
  mapReduce.js         whole-document Map-Reduce
  calendarAgent.js     calendar intent classifier
  holidays.js          Korean holiday API/fallback
  chunking.js          shared section chunking policy
  notebooks.js         notebook storage, dual-write to Qdrant/SQLite, ingest, chunk cache
  reranker.js          cross-encoder reranking via Ollama /api/rerank
  modelQueue.js        in-process concurrency queues (embedding, analysis, rerank, map-reduce)
  rateLimit.js         fixed-window rate limiting for model-calling routes
  abort.js             AbortSignal helpers for streaming chat and Map-Reduce
  auth.js              ADMIN_TOKEN middleware
  accessControl.js     department notebook read-access groups, passwords, tokens
  parsers.js           file parsers and text splitting primitives
  retrieval.js         BM25/CJK bigram, cosine, RRF retrieval
  visualization.js     visualization validation and chart data
  documents.js         serializers and pageSections()
  documentStore.js     runtime-only document cache
  rag/
    ragConfig.js         RAG profile constants, backend env resolution
    departmentRag.js     department retrieval orchestration
    embeddingValidator.js embedding dimension and integrity validation
    retrievalLogger.js   privacy-safe JSONL retrieval telemetry
  indexes/
    qdrantVectorIndex.js Qdrant collection lifecycle, upsert/delete/search
    sqliteFtsIndex.js    SQLite FTS5 lexical index for BM25 and CJK bigrams
  ingest/
    notebookIngestJobs.js async background ingest queue with retry and startup recovery

public/
  index.html
  app.js               orchestrator: init, routing, room management, drag-drop
  modules/
    state.js           global state, DOM refs, shared utilities (showConfirmDialog)
    persistence.js     IndexedDB + WebCrypto AES-GCM
    calendar.js        calendar rendering, CRUD, reminders
    chat.js            streaming chat, message rendering, file upload, query-trim
    layout.js          three-pane panel resize/collapse behavior
    notebook.js        notebook selector UI, access login, Admin Console, notebook CRUD
    studio.js          Studio panel UI and mind-map SVG renderer
    settings.js        Personal Settings tab, Admin Console mounting, brand/theme/avatar/banner
  answerRenderer.js
  visualizationRenderer.js
  fileDisplay.js
  textRepair.js
  styles.css

docs/
  ARCHITECTURE.md
  DEPARTMENT_RAG_ARCHITECTURE.md
  CONTAINER_DEPLOYMENT.md
  API.md
  RAG.md
  CALENDAR.md
  SECURITY.md
  KNOWN_ISSUES.md
```

## More Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Department RAG Architecture](docs/DEPARTMENT_RAG_ARCHITECTURE.md)
- [Container Deployment](docs/CONTAINER_DEPLOYMENT.md)
- [API](docs/API.md)
- [RAG and Map-Reduce](docs/RAG.md)
- [Calendar](docs/CALENDAR.md)
- [Security and Deployment Boundary](docs/SECURITY.md)
- [Known Issues](docs/KNOWN_ISSUES.md)

## Deployment Model

myAI uses a two-tier design:

- **Department workstation** (DGX Spark / RTX 5090-class GPU): runs the Node.js server + Ollama. Stores department notebooks under `data/notebooks/`. Multiple personal PCs connect to this shared server.
- **Personal PC (browser-only)**: each user's browser holds private data (rooms, uploads, calendar, settings) in encrypted IndexedDB. Personal documents are parsed server-side, returned in the API response, and persisted in the browser. The server stores no personal copy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.
See [docs/SECURITY.md](docs/SECURITY.md) before exposing the app beyond localhost or a trusted LAN.

## Settings And Admin Console

The gear button in the main header opens one Settings dialog with two tabs:

- **Personal Settings**: app name, banner, system/user avatars, theme, built-in/custom color palette, and custom prompt. These settings remain local to the browser's encrypted IndexedDB.
- **Admin Console**: requires `ADMIN_TOKEN` when configured. After authentication, admins use the top console menu for **Department Notebook Management**, **System Status**, **Access Management**, and **RAG Evaluation**.

The chat composer keeps the main input row focused on four controls: add (`+`),
material context, prompt input, and send. When the active room has uploaded
documents or a selected department notebook, the material button shows a count
and can expand a tree-style panel:

```text
자료(3개)
|- 부서노트북(1)
|  |- 공공AI 서비스 지원사업 제안요청서
|- 첨부(2)
|  |- 검토 보고.hwpx
|  |- 참고 자료.pdf
```

The room list shows only compact state icons for uploaded attachments and
department notebooks. Detailed material names and attachment deletion controls
live in the composer material panel to avoid duplicate lists.

Department notebook read access is optional. Until at least one group level or
Super password is configured, notebook reads remain public for compatibility.
Once access control is active, normal users authenticate from the department
notebook selector using a group/level password or Super password. `ADMIN_TOKEN`
continues to protect management APIs only and is not a notebook-read identity.
Access Management is split into **Group Management** and **Super Access** tabs:
admins create/search/select groups, configure Level 1-3 passwords in the
selected group detail pane, and manage Super access separately. Changing an
existing Super password requires the current Super password plus matching new
password confirmation; first-time Super setup does not require a current
password. Level 1 is the highest group level: it can read notebooks assigned
to Level 1, 2, or 3 in the same group.

## Known Constraints

- Uploaded room files and calendar data are durable in browser IndexedDB, not server memory.
- Department notebook retrieval uses Qdrant (vector) + SQLite FTS5 (lexical) when configured. Normal indexed hits avoid loading every notebook chunk JSON; JSON/in-memory BM25 is loaded lazily only for fallback or empty-query first-chunk fitting.
- Naver Search runs only for explicit search prompts in normal chat and is skipped whenever uploaded files or a selected department notebook are present.
- Studio mind maps use current-room uploaded documents only and skip Naver Search and department notebook RAG. Generation uses a two-pass LLM pipeline: Pass 1 extracts concepts spanning the full document (evenly sampled chunks); Pass 2 derives node/edge relationships from the concept list.
- When uploaded documents are present in a room, explicit search prompts (e.g., "네이버 검색해줘") are blocked client-side before reaching the LLM; a descriptive message is shown instead.
- There is no per-user server account; personal data isolation is by browser AES-GCM encryption key.
- `ADMIN_TOKEN` protects Admin Console management actions only. Use group/level or Super access passwords for notebook reads, and reverse-proxy auth/TLS/rate limits for production-like shared deployments.
- Calendar is local-only; there is no Google Calendar, Outlook, or ICS sync.
- Precision Analysis / Map-Reduce is slower than normal chat and truncates beyond `MAP_REDUCE_MAX_CHUNKS`.
- Legacy binary `.hwp` and `.xls` are not parsed directly. Use HWPX/XLSX.

## License

Private project. Not yet released under an open-source license.
