# Container Deployment

This guide covers the portable Docker Compose stack for myAI. The stack runs:

| Service | Image | Purpose |
|---|---|---|
| `app` | built from `Dockerfile` | Node.js 24 Express app and static frontend |
| `qdrant` | `qdrant/qdrant:v1.13.6` | optional department vector index |
| `ollama` | `ollama/ollama:latest` | local model server |

Inside Compose, the app reaches Qdrant at `http://qdrant:6333` and Ollama at `http://ollama:11434`. The web app is exposed on port `3000`. Qdrant and Ollama are bound for local diagnostics only.

## First Run

Copy the container environment template:

```bash
cp deploy/container.env.example .env
```

On Windows PowerShell:

```powershell
copy deploy\container.env.example .env
```

Edit `.env` and set strong server-side secrets:

```env
ADMIN_TOKEN=<long-random-token>
QDRANT_API_KEY=<long-random-token>
```

Optional Naver Search configuration belongs in this same `.env` file:

```env
NAVER_SEARCH_ENABLED=true
NAVER_SEARCH_CLIENT_ID=<naver-client-id>
NAVER_SEARCH_CLIENT_SECRET=<naver-client-secret>
NAVER_SEARCH_TYPES=news,webkr
```

Start the stack:

```bash
docker compose up -d --build
```

Pull the recommended local models into the Ollama container:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Open:

```text
http://localhost:3000
```

Check status:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

## GPU Mode

On Linux hosts with NVIDIA drivers and NVIDIA Container Toolkit installed, use the GPU override:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

Without NVIDIA GPU support, use the plain stack:

```bash
docker compose up -d --build
```

## Host Ollama

If Ollama is already running on the host machine, run only the app and Qdrant and point the app at the host:

```env
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434
```

```bash
docker compose up -d --build app qdrant
```

On Linux, `host.docker.internal` is provided by the Compose configuration through `host-gateway`. If your Docker version does not support it, replace the URL with the bridge gateway address used on your host.

## Department RAG Indexes

The Compose stack is designed for the indexed department RAG path:

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
DEPARTMENT_LEXICAL_BACKEND=sqlite
QDRANT_URL=http://qdrant:6333
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
```

After importing or restoring department notebooks, rebuild and check indexes:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

Run the fast quality fixture when changing retrieval settings:

```bash
docker compose exec app npm run rag:quality-test:quick
```

## Web Search Behavior

Naver Search is server-side only. When enabled and configured, the app uses it for explicit search prompts in normal chat.

It is intentionally disabled for:

- prompts with uploaded room files in the chat payload
- prompts where a department notebook is selected

Those paths must stay grounded in the uploaded file or notebook RAG evidence.

## Persistence

Docker volumes:

| Volume | Contents |
|---|---|
| `myai-data` | department notebooks, SQLite FTS index, ingest jobs, retrieval logs |
| `qdrant-storage` | Qdrant vector index |
| `qdrant-snapshots` | Qdrant snapshots |
| `ollama-data` | downloaded Ollama models |

`data/notebooks/` is the source of truth for department notebooks. Qdrant and SQLite indexes can be rebuilt from it.

Personal rooms, uploads, calendar events, chat history, and settings remain in each user's browser IndexedDB, not in Docker volumes.

## Backup And Restore

Back up department notebooks and indexes:

```bash
docker compose exec app npm run rag:backup
```

Restore through the matching restore script, then rebuild/check indexes:

```bash
docker compose exec app npm run rag:restore -- <backup-file>
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

If Qdrant storage is lost but `myai-data` is intact, run `rag:rebuild`.

## Updates

```bash
git pull
docker compose build app
docker compose up -d
docker compose exec app npm run rag:check
```

Pull models again only when model names change:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

## Operations Notes

- Keep `ADMIN_TOKEN`, `QDRANT_API_KEY`, and Naver API secrets server-side.
- Use the main gear button → Admin Console to manage department notebooks,
  access groups/levels, Super read access, notebook policies, and system status.
- Use `docs/SECURITY.md` before exposing the app beyond localhost or a trusted LAN.
- Reverse proxies must not buffer `/api/chat`; streamed responses should flush as they arrive.
- Docker Desktop may need at least 8 GiB memory for `gemma4:e2b` inside the Ollama container.
- If port `3000` is already occupied, stop the old process or change `PORT` in `.env`.
