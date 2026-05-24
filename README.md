# myAI

myAI is a local Ollama-based AI secretary web app. It provides chat, document and image analysis, CSV/XLSX visualizations, a right-side Studio workspace with document mind maps, a local calendar agent, department-notebook RAG, Korean law/compliance workflows, answer-as-source workflows, whole-document Map-Reduce analysis, encrypted browser persistence, and personalized UI settings.

## Current Setup

- App URL: <http://localhost:3000>
- Ollama URL: <http://127.0.0.1:11434>
- Current local chat/review model: `gemma4:e2b`
- Recommended embedding model: `bge-m3`
- Current local `.env` should use:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
```

On 2026-05-05, direct Ollama checks confirmed `bge-m3:latest` is installed and `/api/embed` returns 1024-dimensional vectors. The portable fallback remains `gemma3n:e2b` in `.env.example`; the current local `.env` uses `gemma4:e2b`. Use `gemma4:e4b` only on hosts with enough memory for stronger law-review output. If `/api/status` fails, start the app server first.

## Features

- Multi-room streaming chat with a composer stop button, regenerate/edit/copy/download/delete flows, bulk message deletion, and a room pin toggle to keep important conversations at the top of the sidebar.
- Input source badges on assistant messages show which sources were active (department notebook, uploaded files, generated room sources, web search, law engine); clicking the notebook badge reopens the selector.
- Autonomous, context-aware follow-up suggestions grounded in conversation logic.
- Upload support for PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, and GIF.
- Upload-time document summary/topic extraction through local Ollama.
- Long-document retrieval with query expansion, BM25/CJK bigram ranking, and optional vector ranking.
- Department notebooks stored on the server filesystem with citation panels in chat and optional group/level access control.
- Department notebook knowledge graphs for graph-assisted retrieval and a Studio graph viewer.
- Explicit web-search prompts can use Naver Search API context in normal chat.
- Explicit law-search mode isolates legal prompts from room documents/notebooks and grounds answers in the Korea Law Engine: law.go.kr statutes, precedents, interpretations, admin rules, ordinances, annexes, law-structure links, Constitutional Court decisions, and administrative-appeal decisions.
- Legal research workbench aggregates official statutes, precedents, interpretations, admin rules, ordinances, law-structure links, revision history, and impact-map metadata, then runs a separate LLM review draft step.
- Law Workbench review requests use only the user prompt, selected review conditions, official evidence gathered by `/api/law/workbench`, and documents attached through the Law Workbench upload UI. Only documents explicitly attached to the active Law Workbench review are sent; active chat-room attachments are not automatically included.
- Law Workbench review diagnostics are logged as `[law-workbench-review]` without prompt/body text and include prompt size, estimated tokens, document count, evidence counts, elapsed time, and Ollama `prompt_eval_count` / `eval_count`.
- Official law term KB (Knowledge Base) maps natural language terms to canonical legal definitions and law/article hints for query expansion.
- Department legal-review prompts combine uploaded/notebook material with statute, precedent, interpretation, admin-rule, or ordinance evidence when configured.
- Assistant answers can be exported from the message action menu as MD, XLSX, PDF, HWPX, or DOCX.
- Assistant answers can be saved back into the current room as AI-generated source material (`md`, `pdf`, `docx`, or `hwpx`). The generated source is stored with the room in encrypted IndexedDB, marked as AI-generated / needs verification, and treated as secondary context in later chat turns.
- Studio Source Guide can summarize uploaded files and/or the selected department notebook into key issues, related laws, recommended questions, and possible outputs.
- Studio output library stores generated documents and source guides under `room.studio.outputs`; outputs can be reopened, added back as room sources, or submitted for department-notebook promotion review.
- Admin-reviewed promotion requests let an operator approve selected Studio outputs into department notebooks with provenance metadata.
- Studio document editor converts AI answers into structured public-sector document drafts using built-in or personal templates, allowing users to edit the visual draft and export as HWPX, DOCX, PDF, or MD. If AI structuring fails, the original answer is shown in the editor as plain text rather than parsed Markdown.
- Three-pane workspace with a resizable left panel, resizable/collapsible Studio panel, and tools for uploaded-document mind maps, notebook knowledge graphs, law exploration, structured document editor, and file tools (merging/splitting PDF, XLSX, TXT).
- File Tools for merging multiple files into one or splitting a large file into smaller parts (PDF, XLSX, TXT supported; entirely client-side for privacy).
- Whole-document or whole-notebook **Precision Analysis** ("정밀 분석") through the Map-Reduce mode. The control is available only when the active room has uploaded documents or a selected department notebook.
- Plan-first CSV/XLSX visualizations rendered as SVG/table/KPI/infographic views.
- Refined AI calendar intent classification with hardened client-side orchestration.
- Browser IndexedDB persistence encrypted with WebCrypto AES-GCM.
- Unified Settings dialog with Personal Settings and an Admin Console tab.
- Personalized app name, avatars, banner, theme, built-in or custom 3-color accent palette, and reusable custom prompt presets.
- Admin Console for department notebooks, access groups/levels, RAG status, RAG quality (golden-set evaluation), and a usage statistics dashboard.

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

For same-machine use, `http://localhost:3000` or `http://127.0.0.1:3000`
works. For remote PCs connecting by LAN IP, use HTTPS or a TLS-terminating
reverse proxy; browsers can block `crypto.subtle` on plain
`http://<lan-ip>`, which prevents the encrypted IndexedDB UI from loading.

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

`deploy/container.env.example` keeps the lighter `gemma4:e2b` default for
portable Docker deployments. Edit `OLLAMA_MODEL=gemma4:e4b` and pull that model
instead if the container host has enough GPU memory. Open
<http://localhost:3000>. Check the stack:

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

Run the full fast test suite (readability, evidence, composer layout, law-review view, law unit tests, prompt router, mind-map validation, and smoke tests) while the app server is running:

```powershell
npm.cmd test
```

The suite covers answer readability policy, evidence-summary classification, composer/stop-button layout, law-review view rendering, law parsing/intent/KG unit tests, chat-route classification (`promptRouter`), mind-map generation validation, app shell IDs, `/api/status`, notebook list, file upload, answer export, visualization error handling, chat, and calendar intent classification. Run mind-map tests alone:

```powershell
npm.cmd run test:mindmap
```

Run deterministic XLSX/visualization regression tests without Ollama:

```powershell
npm.cmd run test:xlsx
```

Run source-workflow regression tests after changing answer-as-source behavior:

```powershell
npm.cmd run test:source-workflow
```

Run the slower live tests when Ollama is running and you want to exercise parser behavior, notebook CRUD, embeddings, document analysis, and notebook query metadata:

```powershell
npm.cmd run test:live
```

Run the Studio knowledge-graph end-to-end check against a running app server when validating graph viewer or admin rebuild changes:

```powershell
npm.cmd run test:studio-graph
```

Run the Studio document workflow check after changing answer-to-document,
template, or export behavior:

```powershell
npm.cmd run test:studio-document
```

`npm.cmd run test:ci` runs the deterministic XLSX regression and the smoke
suite together for CI-style validation without Ollama-backed parsers.

For department RAG changes, run the fast golden-set check first and the full
quality evaluation before release or deployment:

```powershell
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

Uploaded room files are stored in the browser's encrypted IndexedDB and are sent back in `/api/chat` requests as JSON. The UI shows compact material status in the room list, exposes detailed uploaded-file cleanup from the composer material panel, warns before large uploads, and blocks chat requests that are too close to the server JSON body limit.

Room-generated sources created from assistant answers follow the same browser-owned persistence model. The server converts the answer through `/api/source-workflow/from-answer` and returns a document-like payload; the browser adds it to the current room material set. Generated source text is always kept for later analysis, while generated binary data is inlined only when it is below the configured size cap.

The XLSX regression test covers Excel date serial conversion, cached formula values, merged cells, blanks, mixed-type columns, shared string tables, multi-sheet workbooks, invalid plan validation, and server-computed chart specs.

## Configuration

`server/env.js` loads `.env` from the project root. Existing process environment variables take precedence.

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | unset | HTTP bind host; unset listens on all interfaces |
| `HTTPS_KEY_PATH` | unset | optional TLS private key path for serving HTTPS directly |
| `HTTPS_CERT_PATH` | unset | optional TLS certificate path for serving HTTPS directly |
| `HTTPS_CA_PATH` | unset | optional CA bundle path for HTTPS server chains |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `gemma3n:e2b` | default chat/analysis model |
| `EMBED_MODEL` | `bge-m3` | Ollama `/api/embed` model |
| `EMBED_DIM` | unset | expected embedding dimension; set `1024` for `bge-m3` to validate ingest/query vectors |
| `KOREA_HOLIDAY_SERVICE_KEY` | unset | optional Korean public-holiday API key |
| `ADMIN_TOKEN` | unset | bearer token for notebook management APIs |
| `ACCESS_TOKEN_SECRET` | generated under `data/access/` | optional HMAC secret for notebook-read access tokens; set explicitly for multi-instance deployments |
| `ACCESS_TOKEN_TTL_SECONDS` | `43200` | lifetime of group/level or Super notebook-read access tokens |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body limit |
| `MAX_UPLOAD_BYTES` | `41943040` | single upload limit |
| `MAX_CONTEXT_CHARS` | `24000` | uploaded-document context budget |
| `GENERATED_SOURCE_MAX_CHARS` | `180000` | maximum assistant-answer text accepted by `/api/source-workflow/from-answer` |
| `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES` | `750000` | maximum generated file size returned as `dataBase64`; larger files remain text-only room sources |
| `SOURCE_GUIDE_INPUT_MAX_CHARS` | `36000` | source text budget for `/api/source-workflow/source-guide` |
| `SOURCE_GUIDE_TIMEOUT_MS` | `75000` | source guide model-call timeout |
| `SOURCE_PROMOTION_MAX_CHARS` | `180000` | maximum markdown body accepted for Studio-output promotion requests |
| `MINDMAP_MODEL` | unset | dedicated Ollama model for mind-map generation; falls back to `OLLAMA_MODEL` |
| `MINDMAP_P1_MAX_CONTEXT` | `12000` | outline context budget for mind-map generation |
| `MINDMAP_P1_MAX_CHUNKS` | `10` | max evenly-sampled chunks per document (spans full document) |
| `MINDMAP_OUTLINE_MAX_ITEMS` | `28` | max outline items extracted during mind-map generation (`MINDMAP_P1_MAX_CONCEPTS` accepted as fallback) |
| `MINDMAP_MAX_NODES` | `24` | max generated Studio mind-map nodes |
| `MINDMAP_MAX_EDGES` | `36` | max generated Studio mind-map edges |
| `DOCUMENT_CACHE_TTL_MS` | `21600000` | same-browser runtime cache lifetime for recently uploaded personal documents |
| `DOCUMENT_CACHE_MAX_ENTRIES` | `256` | max personal upload cache entries kept in server memory |
| `CHUNK_WINDOW_CHARS` | `1024` | sliding chunk size |
| `CHUNK_OVERLAP_CHARS` | `256` | sliding chunk overlap |
| `NOTEBOOK_QUERY_BUDGET` | `12000` | notebook RAG context budget |
| `NOTEBOOK_CHUNK_CACHE_MAX` | `4` | hot notebook chunk caches kept in server memory |
| `DEPARTMENT_VECTOR_BACKEND` | `json` | department vector backend: `json` or `qdrant` |
| `DEPARTMENT_LEXICAL_BACKEND` | `memory` | department lexical backend: `memory` or `sqlite` |
| `QDRANT_URL` | unset | Qdrant REST URL when vector backend is `qdrant` |
| `QDRANT_API_KEY` | unset | optional Qdrant API key; server-side only |
| `QDRANT_COLLECTION` | `myai_notebook_chunks` | Qdrant collection name |
| `QDRANT_VECTOR_NAME` | `dense_bge_m3` | named vector slot used in Qdrant |
| `QDRANT_TIMEOUT_MS` | `2500` | Qdrant request timeout |
| `QDRANT_SEARCH_LIMIT` | `48` | dense candidate count before fusion |
| `QDRANT_UPSERT_BATCH_SIZE` | `128` | notebook ingest batch size for Qdrant upserts |
| `SQLITE_FTS_PATH` | `data/indexes/department-rag.sqlite` | SQLite FTS5 lexical index path |
| `SQLITE_FTS_SEARCH_LIMIT` | `80` | lexical candidate count before fusion |
| `QUERY_EXPANSION_ENABLED` | `true` | enable LLM query expansion |
| `QUERY_EXPANSION_VARIANTS` | `3` | generated query variants |
| `QUERY_EXPANSION_TIMEOUT_MS` | `6000` | query expansion timeout |
| `KG_EXPANSION_ENABLED` | unset | set `1` to use per-notebook knowledge graphs as supplemental RAG ranking input |
| `KG_EXPAND_TERMS` | `8` | max graph seed terms/nodes considered during query expansion |
| `KG_EXPAND_NEIGHBORS` | `8` | max one-hop neighbors loaded per graph seed |
| `KG_EXPAND_REFS` | `4` | max source references collected per graph node |
| `KG_EXPAND_MAX` | `12` | max graph-derived chunk supplements added before RRF fusion |
| `KG_FUSION_WEIGHT` | `0.3` | RRF weight applied to graph-derived ranking list when fused with vector/lexical lists |
| `KG_EXTRACT_MODEL` | `gemma4:e4b` | Ollama model used for notebook graph extraction during rebuild |
| `KG_EXTRACT_TIMEOUT_MS` | `180000` | per-chunk extraction timeout for graph rebuild |
| `KG_EXTRACT_MAX_CHARS` | `4000` | max chunk text length passed to the extractor |
| `KG_CONFIDENCE_THRESHOLD` | `0.6` | confidence cutoff used when auto-enabling new graph nodes/edges |
| `NAVER_SEARCH_ENABLED` | `true` | enable Naver Search context for explicit web-search prompts |
| `NAVER_SEARCH_CLIENT_ID` | unset | Naver Search API client ID; server-side only |
| `NAVER_SEARCH_CLIENT_SECRET` | unset | Naver Search API client secret; server-side only |
| `NAVER_SEARCH_TYPES` | `news,webkr` | comma-separated Naver search types to query |
| `NAVER_SEARCH_DISPLAY` | `5` | result count requested per Naver search type |
| `NAVER_SEARCH_MAX_RESULTS` | `8` | max normalized search results passed to the LLM |
| `NAVER_SEARCH_TIMEOUT_MS` | `4500` | timeout per Naver Search API request |
| `LAW_API_ENABLED` | `true` | enable native Korean Law Engine routes and chat grounding |
| `LAW_OC` | unset | canonical law.go.kr Open API key; server-side only |
| `LAW_USER_AGENT` | `Mozilla/5.0 (compatible; myAI Korean Law Engine)` | User-Agent for law.go.kr API requests |
| `LAW_TIMEOUT_MS` | `8000` | timeout per law.go.kr API request |
| `LAW_MAX_RESULTS` | `8` | max normalized law search results |
| `LAW_CONTEXT_BUDGET` | `10000` | law context budget passed to chat |
| `LAW_CACHE_ENABLED` | `true` | enable law API response cache |
| `LAW_CACHE_TTL_MS` | `86400000` | default law cache TTL |
| `LAW_CACHE_MAX_ENTRIES` | `1000` | max law cache rows in `data/cache/law-cache.sqlite` |
| `LAW_AUTO_DETECT` | `false` | keep legal auto-detection off except explicit legal prompts/article patterns |
| `LAW_VERIFY_CITATIONS` | `true` | enable citation verification behavior |
| `LAW_IMPACT_MAP_ENABLED` | `true` | enable the Korean Law Engine impact-map endpoint and Studio Law Explorer |
| `LAW_HISTORY_TARGET` | `eflaw` | upstream target for `/api/law/history` (revision-history query); override if law.go.kr renames it |
| `LAW_DECISIONS_ENABLED` | `true` | enable Constitutional Court and administrative-appeal decision search/detail routes |
| `LAW_WORKBENCH_REVIEW_TIMEOUT_MS` | `600000` | timeout for the Law Workbench LLM review-draft step |
| `LAW_WORKBENCH_REVIEW_NUM_CTX` | `8192` | Ollama `num_ctx` used for the Law Workbench review-draft prompt |
| `LAW_WORKBENCH_REVIEW_MAX_PROMPT_CHARS` | `90000` | max complete review prompt length after official evidence formatting |
| `LAW_WORKBENCH_REVIEW_DOCUMENT_CHARS` | `16000` | max text budget for explicitly supplied Law Workbench review documents |
| `DECISIONS_API_KEY` | unset | shared decision API key fallback; server-side only |
| `HUNZAE_API_KEY` | unset | Constitutional Court OpenAPI key; falls back to `DECISIONS_API_KEY` when unset |
| `HUNZAE_API_URL` | unset | optional Constitutional Court OpenAPI base URL override |
| `HAENGJIM_API_PROVIDER` | `lawgo` unless `HAENGJIM_API_URL` is set | administrative-appeal provider: `lawgo` or documented hub API |
| `HAENGJIM_API_URL` | unset | administrative-appeal hub API URL override; when set, hub is tried before law.go.kr fallback |
| `RATE_LIMIT_LAW_SEARCH_PER_MINUTE` | `15` | rate limit for `/api/law/search` |
| `RATE_LIMIT_LAW_ARTICLE_PER_MINUTE` | `20` | rate limit for `/api/law/article` |
| `RATE_LIMIT_LAW_VERIFY_PER_MINUTE` | `20` | rate limit for `/api/law/verify-citations` |
| `RATE_LIMIT_LAW_RESEARCH_PER_MINUTE` | `8` | rate limit for precedent / interpretation / admin-rule / ordinance research |
| `RATE_LIMIT_LAW_IMPACT_PER_MINUTE` | `4` | rate limit for `/api/law/impact-map` |
| `RATE_LIMIT_LAW_TIME_TRAVEL_PER_MINUTE` | `4` | rate limit shared by `/api/law/article/at`, `/article/diff`, `/history` |

Naver Search only runs for explicit web-search prompts in normal chat. It is
skipped when uploaded files are present or a department notebook is selected, so
file-grounded and RAG-grounded answers stay within their provided evidence.
Korean Law Engine is separate from Naver Search: explicit legal prompts may use
official law.go.kr and decision-source context alongside uploaded documents or
department notebooks. Law citations render as `[L1]` and decision citations as
`[D1]`, separately from notebook `[N]` and web `[W]` citations. The engine
covers article retrieval, citation verification, precedent / interpretation /
admin-rule / ordinance research, annexes, delegated-law and ordinance links,
Constitutional Court decisions, administrative-appeal decisions, impact maps,
time-travel diff (`/article/at`, `/article/diff`, `/history`), `action_plan`
mode with a mandatory non-legal-advice disclaimer, and notebook KG enrichment
that auto-fetches articles surfaced by `graph.sqlite`.
When no relevant evidence is found, the UI suppresses source panels and
follow-up suggestions for that no-evidence answer.

| `DOC_ANALYSIS_ENABLED` | `true` | upload/notebook summary and topic extraction |
| `DOC_ANALYSIS_MAX_INPUT_CHARS` | `12000` | document analysis sample budget |
| `DOC_ANALYSIS_TIMEOUT_MS` | `30000` | document analysis timeout |
| `MAP_REDUCE_BATCH_CHUNKS` | `4` | chunks per map call |
| `MAP_REDUCE_MAX_CHUNKS` | `80` | maximum chunks per Precision Analysis / Map-Reduce run |
| `MAP_REDUCE_PARALLELISM` | `2` | concurrent map calls |
| `MAP_REDUCE_MAP_TIMEOUT_MS` | `120000` | base map-call timeout (adaptive: see below) |
| `MAP_REDUCE_MAP_TIMEOUT_PER_CHUNK_MS` | `20000` | extra timeout per chunk in the batch |
| `MAP_REDUCE_COLD_START_MARGIN_MS` | `30000` | additional margin for the first batch (Ollama model load) |
| `MAP_REDUCE_MAP_RETRY` | `1` | retries per map batch on timeout / 5xx / connection error |
| `OLLAMA_KEEP_ALIVE` | `30m` | model residency hint sent to Ollama on every Map-Reduce call |
| `EMBED_QUEUE_CONCURRENCY` | `2` | concurrent embedding calls |
| `EMBED_QUEUE_MAX_QUEUED` | `64` | queued embedding-call limit |
| `MAP_REDUCE_QUEUE_CONCURRENCY` | `2` | concurrent Map-Reduce jobs |
| `MAP_REDUCE_QUEUE_MAX_QUEUED` | `32` | queued Map-Reduce job limit |
| `ANALYSIS_QUEUE_CONCURRENCY` | `2` | concurrent document-analysis calls |
| `ANALYSIS_QUEUE_MAX_QUEUED` | `32` | queued document-analysis limit |
| `STUDIO_DOCUMENT_FALLBACK_MODEL` | `gemma3n:e2b` | fallback model for Studio answer-to-document conversion when the selected/default model fails due to memory pressure |
| `STUDIO_DOCUMENT_OLLAMA_TIMEOUT_MS` | `90000` | timeout for Studio answer-to-document conversion |
| `STUDIO_DOCUMENT_ANSWER_MAX_CHARS` | `120000` | maximum assistant-answer text accepted by Studio document conversion |
| `TRUST_PROXY` | `false` | enables Express proxy IP handling when behind a trusted reverse proxy |
| `RATE_LIMIT_KEY_HEADER` | unset | optional trusted proxy-auth user header used for rate-limit keys |
| `RATE_LIMIT_CHAT_PER_MINUTE` | `20` | rate limit for `/api/chat` |
| `RATE_LIMIT_VISUALIZE_PER_MINUTE` | `10` | rate limit for `/api/visualize` |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `8` | rate limit for `/api/upload` |
| `RATE_LIMIT_LIGHTWEIGHT_PER_MINUTE` | `30` | shared rate limit for lightweight model/API routes |
| `RATE_LIMIT_ADMIN_WRITE_PER_MINUTE` | `10` | admin write-route rate limit |
| `CHAT_QUEUE_ENABLED` | `false` | enables queueing for chat model calls |
| `CHAT_QUEUE_CONCURRENCY` | `4` | concurrent queued chat calls when enabled |
| `CHAT_QUEUE_MAX_QUEUED` | `32` | queued chat-call limit |
| `RAG_RERANK_ENABLED` | `false` | enables external reranker calls after RRF fusion |
| `RERANK_MODEL` | `bge-reranker-v2-m3` | reranker model name sent to the external `/api/rerank` service |
| `RERANK_TOP_K` | `40` | max fused candidates sent to reranker |
| `RERANK_TIMEOUT_MS` | `8000` | reranker timeout |
| `RETRIEVAL_LOG_ENABLED` | `true` | enables privacy-safe retrieval/usage telemetry logs |

## Project Structure

```text
server/
  index.js             Express server, static files, API routes
  env.js               project-root .env loader
  exportFiles.js       answer export generators for MD/XLSX/PDF/HWPX/DOCX
  sourceWorkflow/      answer-as-source, source guide, and promotion-review helpers
  mindmap.js           Studio mind-map graph generation from uploaded documents
  promptRouter.js      classifies each chat request into a route (strict_law_search / map_reduce / compliance_review / law / notebook_rag / web_search / normal_chat)
  ollama.js            chat/followups/visualization calls, RAG and Map-Reduce dispatch
  naverSearch.js       Naver Search API integration for explicit search prompts
  law/                 Korean Law Engine config, law.go.kr/decision clients, citation verification, annexes, law links, time-travel/diff/history, impact map, Law Workbench review/report APIs
  compliance/          department legal-review intent classifier, review-type catalog, compliance prompt builder (drives `department_legal_review` mode)
  studioDocument/      Studio Document Editor: templates, answer-to-document conversion, document model validation, HWPX/DOCX/PDF/MD export
  stats/               usage telemetry logger, log reader/aggregator, and Admin Console statistics API
  embeddings.js        Ollama /api/embed helpers
  queryExpansion.js    LLM query expansion
  documentAnalysis.js  document summary/topic extraction
  mapReduce.js         whole-document Map-Reduce
  calendarAgent.js     calendar intent classifier
  holidays.js          Korean holiday API/fallback
  chunking.js          shared section chunking policy
  notebooks.js         notebook storage, dual-write to Qdrant/SQLite, ingest, chunk cache
  reranker.js          cross-encoder reranking via /api/rerank; off by default (Ollama lacks this endpoint — needs an external reranker server such as TEI to enable)
  modelQueue.js        in-process concurrency queues (embedding, analysis, rerank, map-reduce)
  rateLimit.js         fixed-window rate limiting for model-calling routes
  ragEvalApi.js        Admin RAG evaluation API, run history, and retrieval-log summaries
  graphStudioApi.js    read-only Studio knowledge-graph API for accessible notebooks
  graphAdminApi.js     Admin knowledge-graph inspection, overrides, and rebuild API
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
    retrievalLogReader.js retrieval telemetry summary reader for RAG Evaluation
    evalRunner.js        golden-set Recall/MRR evaluation runner
    evalStore.js         golden-set and persisted run storage
    graph/               notebook knowledge-graph store, ontology, extraction, expansion, rebuild jobs
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
    messageDelete.js   single/bulk chat message deletion
    customPrompts.js   reusable prompt presets and picker/settings UI
    sourceWorkflow.js  assistant answer -> room source dialog and client orchestration
    layout.js          three-pane panel resize/collapse behavior
    notebook.js        notebook selector UI, access login, Admin Console, notebook CRUD, promotion review
    graphStudio.js     Studio knowledge-graph viewer for selected department notebooks
    ragEval.js         Admin RAG Evaluation panel
    adminStats.js      Admin Console usage statistics panel (KPI / groups / notebooks / sessions)
    adminApi.js        small Admin Console fetch helpers
    evidenceSummary.js classification and formatting of citations
    lawWorkbench.js    Law Workbench UI for Korean legal research, dedicated review documents, LLM review results, and impact mapping
    studio.js          Studio panel UI and mind-map SVG renderer
    documentStudio.js  Studio Document Editor tab: template selection, visual draft editing, plain-text fallback, source guides, output library, export
    documentStudioMarkdown.js  markdown <-> visual block conversion for generated Studio documents
    documentTemplates.js built-in/personal Studio document templates
    docTool.js         Studio File Tools: client-side PDF/XLSX/TXT merge and split
    html.js            DOM escaping/sanitizing helpers
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
  KOREAN_LAW_ENGINE.md
  USAGE_TELEMETRY.md
  DESIGN.md
  SECURITY.md
```

## More Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Department RAG Architecture](docs/DEPARTMENT_RAG_ARCHITECTURE.md)
- [Container Deployment](docs/CONTAINER_DEPLOYMENT.md)
- [API](docs/API.md)
- [RAG and Map-Reduce](docs/RAG.md)
- [Calendar](docs/CALENDAR.md)
- [Korean Law Engine](docs/KOREAN_LAW_ENGINE.md)
- [Usage Telemetry and Admin Statistics](docs/USAGE_TELEMETRY.md)
- [Design Guide](docs/DESIGN.md)
- [Security and Deployment Boundary](docs/SECURITY.md)

## Deployment Model

myAI uses a two-tier design:

- **Department workstation** (DGX Spark / RTX 5090-class GPU): runs the Node.js server + Ollama. Stores department notebooks under `data/notebooks/`. Multiple personal PCs connect to this shared server.
- **Personal PC (browser-only)**: each user's browser holds private data (rooms, uploads, calendar, settings) in encrypted IndexedDB. Personal documents are parsed server-side, returned in the API response, and persisted in the browser. The server stores no personal copy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.
See [docs/SECURITY.md](docs/SECURITY.md) before exposing the app beyond localhost or a trusted LAN.

## Settings And Admin Console

The gear button in the main header opens one Settings dialog with two tabs:

- **Personal Settings**: AI name, banner, avatars, theme, built-in/custom color palette, document templates, and reusable custom prompts. These settings remain local to the browser's encrypted IndexedDB.
- **Admin Console**: requires `ADMIN_TOKEN` when configured. After authentication, the top console menu groups operational items (**Department Notebook Management**, **Access Management**) separately from visibility/quality items (**RAG Status**, **RAG Quality**, **Usage Statistics**). **RAG Quality** is split into a left-to-right workflow (golden set -> run -> results) plus an operations-health tab. **Usage Statistics** is backed by `/api/admin/stats/*` (KPI summary, per-group activity, per-notebook activity, and recent sessions).
- **Promotion Review**: admins review Studio-output promotion requests before any AI-generated output is ingested into a department notebook.
- **Studio graph**: when the selected department notebook has a built graph, the Studio panel can show searchable nodes, relationships, source references, and notebook graph statistics. Normal notebook read-access rules still apply.

The chat composer keeps the main input row focused on four controls: add (`+`),
material context, prompt input, and send. When the active room has uploaded
documents or a selected department notebook, the material button shows a count
and can expand a tree-style panel:

```text
자료(3개)
|- 프로젝트(1)
|  |- 공공AI 서비스 지원사업 제안요청서
|- 첨부(2)
|  |- 검토 보고.hwpx
|  |- 참고 자료.pdf
```

The room list shows only compact state icons for uploaded attachments and
department notebooks. Detailed material names and attachment deletion controls
live in the composer material panel to avoid duplicate lists.

Generated answer sources appear in the same material panel under an `AI 생성 자료` group and show `AI 생성` / `검증 필요` badges. They remain personal room
artifacts unless an admin approves a Studio-output promotion request into a
department notebook.

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
- AI-generated room sources are personal working artifacts. They are not automatically added to department notebooks, are visibly marked as generated / needs verification, and are prompted as secondary references rather than independent legal or factual proof. Studio outputs can enter department notebooks only through the admin-reviewed promotion workflow.
- Department notebook retrieval uses Qdrant (vector) + SQLite FTS5 (lexical) when configured. Normal indexed hits avoid loading every notebook chunk JSON; JSON/in-memory BM25 is loaded lazily only for fallback or empty-query first-chunk fitting.
- Naver Search runs only for explicit search prompts in normal chat and is skipped whenever uploaded files or a selected department notebook are present.
- Studio mind maps use current-room uploaded documents only and skip Naver Search and department notebook RAG. Generation uses a single-pass hierarchical LLM pipeline that evenly samples chunks across the full document and directly produces a parent-based node/edge hierarchy.
- Department notebook knowledge graphs are separate from uploaded-document mind maps. Graph data lives under the notebook index area, can be inspected from Studio, and can be moderated from admin graph endpoints.
- When uploaded documents are present in a room, explicit web-search prompts are blocked client-side before reaching the LLM; a descriptive message is shown instead.
- There is no per-user server account; personal data isolation is by browser AES-GCM encryption key.
- `ADMIN_TOKEN` protects Admin Console management actions only. Use group/level or Super access passwords for notebook reads, and reverse-proxy auth/TLS/rate limits for production-like shared deployments.
- Calendar is local-only; there is no Google Calendar, Outlook, or ICS sync.
- Precision Analysis / Map-Reduce is slower than normal chat and truncates beyond `MAP_REDUCE_MAX_CHUNKS`.
- Legacy binary `.hwp` and `.xls` are not parsed directly. Use HWPX/XLSX.

## License

Private project. Not yet released under an open-source license.
