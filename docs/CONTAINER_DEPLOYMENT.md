# Container Deployment

The root Docker Compose stack runs:

| Service | Image | Purpose |
|---|---|---|
| `app` | built from `Dockerfile` | Node.js 24 Express app and static frontend |
| `qdrant` | `qdrant/qdrant:${QDRANT_IMAGE_TAG:-v1.13.6}` | department vector index |
| `ollama` | `ollama/ollama:${OLLAMA_IMAGE_TAG:-latest}` | local model server |

Inside Compose, the app reaches Qdrant at `http://qdrant:6333` and Ollama at `http://ollama:11434`. The app is exposed on port `3000`; Qdrant and Ollama are bound for local diagnostics.

## First Run

```bash
cp deploy/container.env.example .env
```

Windows PowerShell:

```powershell
copy deploy\container.env.example .env
```

Edit `.env`:

```env
ADMIN_TOKEN=<long-random-token>
QDRANT_API_KEY=<long-random-token>
```

Start:

```bash
docker compose up -d --build
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Open:

```text
http://localhost:3000
```

Check:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

## GPU Mode

Linux hosts with NVIDIA drivers and NVIDIA Container Toolkit:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

Without NVIDIA GPU:

```bash
docker compose up -d --build
```

## Host Ollama

If Ollama already runs on the host, point the app at it:

```env
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434
```

Then run only app and Qdrant:

```bash
docker compose up -d --build app qdrant
```

On Linux, `host.docker.internal` is provided by the Compose `host-gateway` setting. If unavailable, use the Docker bridge gateway address.

## Department RAG Defaults

The Compose stack is designed for indexed department RAG:

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
DEPARTMENT_LEXICAL_BACKEND=sqlite
QDRANT_URL=http://qdrant:6333
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

After importing/restoring notebooks:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
docker compose exec app npm run rag:quality-test:quick
```

## Persistence

| Volume | Contents |
|---|---|
| `myai-data` | department notebooks, SQLite FTS index, ingest jobs, retrieval/usage logs |
| `qdrant-storage` | Qdrant vector index |
| `qdrant-snapshots` | Qdrant snapshots |
| `ollama-data` | downloaded Ollama models |

Personal rooms, uploads, generated room sources, calendar events, Studio drafts, chat history, and settings remain in each user's browser IndexedDB.

## Backup And Restore

Back up department notebooks and indexes:

```bash
docker compose exec app npm run rag:backup
```

Restore, then rebuild/check:

```bash
docker compose exec app npm run rag:restore -- <backup-file>
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

If Qdrant storage is lost but `myai-data` remains intact, run `rag:rebuild`.

## Updates

```bash
git pull
docker compose pull qdrant ollama
docker compose build --pull app
docker compose up -d
docker compose exec app npm run rag:check
```

Equivalent npm helper:

```bash
npm run docker:update
docker compose exec app npm run rag:check
```

Pull models again only when model names change:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Upgrade Qdrant one minor version at a time when reusing an existing volume. If the Qdrant volume is recreated, rebuild indexes from `myai-data`.

## Moving To A Linux Server

Recommended path:

1. Commit/push the project or copy the source tree.
2. On the server, install Docker Engine and the Compose plugin.
3. Clone or copy the project to `/opt/myai`.
4. Create `.env` from `deploy/container.env.example`.
5. Set `ADMIN_TOKEN`, `QDRANT_API_KEY`, and bind settings.
6. Run `docker compose up -d --build`.
7. Pull Ollama models inside the container.
8. Restore notebook data if needed and run `rag:rebuild` / `rag:check`.

If the server cannot build images, build `myai-app:latest` on a compatible Linux platform, transfer it with `docker save` / `docker load`, then run Compose.

## Operational Checks

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 ollama
docker compose logs --tail=100 qdrant
curl -s http://127.0.0.1:3000/api/status
docker compose exec ollama ollama list
docker compose exec app npm run rag:check
```

Browser smoke checks:

- Open the app.
- Send a normal chat prompt.
- Upload a file and ask about it.
- Select a department notebook and verify citations.
- Open Admin Console.
- Run Studio mind map or Studio document export when relevant.

## Security Notes

- Keep `ADMIN_TOKEN`, `QDRANT_API_KEY`, Naver API credentials, and law API keys server-side.
- Use HTTPS for remote browsers; WebCrypto may fail on plain LAN HTTP.
- Do not expose Ollama port `11434` publicly.
- Reverse proxies must not buffer `/api/chat`.
- Align proxy body limits with `MAX_JSON_BYTES` and `MAX_UPLOAD_BYTES`.
- See [SECURITY.md](SECURITY.md) before exposing beyond localhost or a trusted LAN.
