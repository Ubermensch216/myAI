# myAI

myAI is a local Ollama-based AI secretary web app. It provides streaming chat, document and image analysis, CSV/XLSX visualization, a right-side Studio workspace, local calendar commands, department notebook RAG, Korean law and compliance workflows, answer-as-source workflows, whole-document Map-Reduce analysis, encrypted browser persistence, usage telemetry, and personalized UI settings.

## Current Local Setup

- App URL: <http://localhost:3000>
- Ollama URL: <http://127.0.0.1:11434>
- Current local chat/review model: `gemma4:e2b`
- Recommended embedding model: `bge-m3`
- `server/ollama.js` and other model callers default to `gemma4:e2b`; `.env.example` may still be used as a portability template.

Recommended local `.env`:

```env
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

On 2026-05-05, local checks confirmed that `bge-m3:latest` and `gemma4:e2b` are installed and that `POST /api/embed` with `bge-m3` returns 1024-dimensional vectors. Use `gemma4:e4b` only on hosts with enough memory for heavier review output.

## Quick Start

Windows PowerShell:

```powershell
cd D:\Dev\myAI
npm.cmd install
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

## Main Features

- Multi-room streaming chat with stop generation, edit, regenerate, copy, export, delete, bulk delete, and room pinning.
- Input source badges for department notebook, uploaded files, AI-generated room sources, web search, and law engine evidence.
- Upload parsing for PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, and GIF.
- Upload-time document summary/topic extraction through Ollama.
- Department notebooks with optional group/level or Super read access, Qdrant vector search, SQLite FTS5 lexical search, JSON fallback, citations, and Admin RAG Quality checks.
- Optional notebook knowledge graphs stored as `data/notebooks/<id>/graph.sqlite`, with Studio graph viewing and Admin graph moderation/rebuild APIs.
- Explicit Naver Search context for normal chat search prompts, skipped when uploaded files or a notebook are active.
- Korean Law Engine for statutes, articles, citations, precedents, interpretations, admin rules, ordinances, annexes, linked laws/ordinances, Constitutional Court decisions, administrative appeals, impact maps, and time-travel/history/diff.
- Law Workbench review that uses only its own prompt, selected review conditions, official workbench evidence, and documents explicitly attached in the Law Workbench UI.
- GRC internal-policy review for target documents against uploaded policy text or selected department notebooks.
- Answer export as MD, XLSX, PDF, HWPX, or DOCX.
- Answer-as-room-source workflow with generated-source trust metadata and optional department-notebook promotion review.
- Studio Document Editor for answer-to-document drafting, AI edit, templates, output library, and HWPX/DOCX/PDF/MD export.
- Studio File Tools for client-side PDF/XLSX/TXT merge and split.
- Studio mind maps from active room uploads.
- Plan-first CSV/XLSX visualization rendered as SVG, table, KPI, or infographic.
- Local calendar with month/week/day views, natural-language intent extraction, recurrence, reminders, Korean holidays, and ICS import/export.
- Encrypted browser IndexedDB persistence using WebCrypto AES-GCM.
- Admin Console for notebooks, access control, RAG status, RAG quality, graph moderation, source promotions, and usage statistics.

## Verification

Full fast suite:

```powershell
npm.cmd test
```

Targeted checks:

```powershell
npm.cmd run test:prompt-router
npm.cmd run test:source-workflow
npm.cmd run test:studio-document
npm.cmd run test:xlsx
npm.cmd run test:studio-graph
npm.cmd run test:live
```

RAG operations:

```powershell
npm.cmd run rag:check
npm.cmd run rag:rebuild
npm.cmd run rag:quality-test:quick
npm.cmd run rag:quality-test -- --k 10
```

`npm.cmd run test:live` requires Ollama and exercises slower parser, notebook CRUD, embedding, document-analysis, and retrieval-metadata flows.

## Docker Quick Start

The root Compose stack runs the app, Qdrant, and Ollama:

```bash
cp deploy/container.env.example .env
# edit .env and set ADMIN_TOKEN and QDRANT_API_KEY
docker compose up -d --build
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Open <http://localhost:3000>. Check:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

For NVIDIA GPU acceleration on Linux:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

Persistent container volumes:

- `myai-data`: department notebooks, SQLite FTS index, ingest jobs, retrieval logs.
- `qdrant-storage` and `qdrant-snapshots`: Qdrant state.
- `ollama-data`: downloaded models.

## Configuration Highlights

`server/env.js` loads `.env` from the project root. Existing process environment variables take precedence.

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | unset | bind host; unset listens on all interfaces |
| `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` / `HTTPS_CA_PATH` | unset | optional direct HTTPS server |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `gemma4:e2b` | default chat/analysis model |
| `EMBED_MODEL` | `bge-m3` | Ollama embedding model |
| `EMBED_DIM` | unset | expected embedding dimension; use `1024` for `bge-m3` |
| `IMAGE_PROVIDER` | `diffusers` | image provider (`diffusers` | `comfyui`) |
| `IMAGE_WORKER_URL` | `http://127.0.0.1:7861` | external image worker or ComfyUI system URL |
| `IMAGE_MODEL_TIER` | `low` | hardware/model configuration tier |
| `IMAGE_DAILY_LIMIT_PER_USER` | `50` | daily image quota per user |
| `ADMIN_TOKEN` | unset | Admin Console management bearer token |
| `ACCESS_TOKEN_SECRET` | generated under `data/access/` | notebook-read access token signing secret |
| `ACCESS_TOKEN_TTL_SECONDS` | `43200` | group/level or Super notebook-read token lifetime |
| `MAX_JSON_BYTES` | `80mb` | JSON body limit |
| `MAX_UPLOAD_BYTES` | `41943040` | multipart upload limit |
| `MAX_CONTEXT_CHARS` | `24000` | uploaded-document context budget |
| `DOCUMENT_CACHE_TTL_MS` | `21600000` | runtime personal-document cache TTL |
| `DOCUMENT_CACHE_MAX_ENTRIES` | `256` | runtime personal-document cache size |
| `DEPARTMENT_VECTOR_BACKEND` | `json` | `json` or `qdrant` |
| `DEPARTMENT_LEXICAL_BACKEND` | `memory` | `memory` or `sqlite` |
| `QDRANT_URL` | unset | Qdrant REST URL |
| `SQLITE_FTS_PATH` | `data/indexes/department-rag.sqlite` | SQLite FTS5 path |
| `QUERY_EXPANSION_ENABLED` | `true` | LLM query expansion |
| `KG_EXPANSION_ENABLED` | unset | set `1` for graph-assisted RAG expansion |
| `NAVER_SEARCH_ENABLED` | `true` | explicit web-search prompts |
| `LAW_API_ENABLED` | `true` | Korean Law Engine routes and chat grounding |
| `LAW_OC` / `KOREAN_LAW_API_KEY` | unset | law.go.kr API key |
| `LAW_WORKBENCH_REVIEW_TIMEOUT_MS` | `300000` | Law Workbench LLM review timeout |
| `MAP_REDUCE_MAX_CHUNKS` | `80` | Precision Analysis chunk cap |
| `CHAT_QUEUE_ENABLED` | `false` | optional chat queue |
| `RAG_RERANK_ENABLED` | `false` | external reranker gate; Ollama does not provide `/api/rerank` |
| `USAGE_LOG_ENABLED` | `true` | usage telemetry logs |
| `RETRIEVAL_LOG_ENABLED` | `true` | retrieval/law telemetry logs |

See [docs/API.md](docs/API.md), [docs/RAG.md](docs/RAG.md), and [docs/SECURITY.md](docs/SECURITY.md) for route and deployment details.

## Project Structure

```text
server/
  index.js                  Express setup, static files, primary API routes
  env.js                    project-root .env loader
  ollama.js                 chat streaming, prompt assembly, RAG and Map-Reduce dispatch
  promptRouter.js           chat route classifier
  parsers.js                PDF/DOCX/XLSX/CSV/PPTX/HWPX/image parsing
  notebooks.js              department notebook storage, ingest, cache, indexes
  exportFiles.js            MD/XLSX/PDF/HWPX/DOCX answer export
  sourceWorkflow/           answer-as-source, source guides, promotion review
  studioDocument/           answer-to-document, AI edit, export
  law/                      Korean Law Engine and Law Workbench APIs
  compliance/               department legal review and GRC review
  rag/                      department RAG, evaluation, retrieval logs, graph
  indexes/                  Qdrant and SQLite FTS adapters
  ingest/                   async notebook ingest jobs
  stats/                    usage telemetry and Admin Stats API

public/
  index.html                app shell
  app.js                    frontend orchestrator
  modules/                  state, chat, calendar, Studio, notebook, law, admin modules
  answerRenderer.js         markdown-lite rendering and inline citations
  visualizationRenderer.js  SVG/table/KPI/infographic rendering
  styles.css                layout and theme styles

src/
  main.ts
  components/GrcWorkbench.svelte
```

## More Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [RAG and Map-Reduce](docs/RAG.md)
- [Image Generation](docs/IMAGE_GENERATION.md)
- [Department RAG Architecture](docs/DEPARTMENT_RAG_ARCHITECTURE.md)
- [Korean Law Engine](docs/KOREAN_LAW_ENGINE.md)
- [Calendar](docs/CALENDAR.md)
- [Container Deployment](docs/CONTAINER_DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Usage Telemetry](docs/USAGE_TELEMETRY.md)
- [Design Guide](docs/DESIGN.md)

## Deployment Model

myAI uses a two-tier design:

- Department workstation: Node.js/Express, Ollama, optional Qdrant, department notebooks, SQLite indexes, logs, and ingest jobs.
- Personal PC browser: encrypted rooms, messages, uploads, calendar events, settings, Studio drafts, and generated room sources.

Personal uploads are parsed server-side as temporary files, returned to the browser, and persisted only in encrypted IndexedDB. Department notebooks are server-side shared state. There is no per-user server account model; browser privacy comes from the local AES-GCM key.

## Known Constraints

- Remote HTTP LAN access may fail before app state loads because browsers can block `crypto.subtle`; use HTTPS for non-localhost clients.
- `ADMIN_TOKEN` protects management APIs only. Notebook reads use optional group/level or Super access tokens.
- Calendar is local-only. There is no Google Calendar, Outlook, or account sync.
- Naver Search runs only for explicit normal-chat search prompts and is skipped when files or notebooks are active.
- Studio mind maps use active uploaded room documents only, not notebooks or Naver Search.
- Legacy binary `.hwp` and `.xls` are not parsed directly; use HWPX/XLSX.
- AI-generated room sources are visibly marked generated/needs verification and treated as secondary context.

## License

Private project. Not released under an open-source license.
