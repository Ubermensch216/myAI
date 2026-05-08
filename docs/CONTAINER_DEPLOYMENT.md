# Container Deployment

This guide runs myAI as a portable Docker Compose stack. It is intended for
Windows Docker Desktop, macOS Docker Desktop, and Linux Docker Engine hosts.

## Services

| Service | Image | Purpose |
|---|---|---|
| `app` | Built from `Dockerfile` | Node.js 24 Express app and static frontend |
| `qdrant` | `qdrant/qdrant:v1.13.6` | Department notebook dense vector index |
| `ollama` | `ollama/ollama:latest` | Local model server and model storage |

The app talks to Qdrant at `http://qdrant:6333` and Ollama at
`http://ollama:11434` inside the Compose network.

By default, only the app is published on all host interfaces. Qdrant and Ollama
are published on `127.0.0.1` for host-side diagnostics without exposing those
backends to the LAN.

## First Run

```bash
cp deploy/container.env.example .env
```

Edit `.env` and set at least:

```env
ADMIN_TOKEN=<long-random-token>
QDRANT_API_KEY=<long-random-token>
```

Then start the stack:

```bash
docker compose up -d --build
```

Pull the required models into the persistent `ollama-data` volume:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Check health:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

## Linux GPU Mode

Install the NVIDIA driver and NVIDIA Container Toolkit on the Linux host, then
start with the GPU overlay:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

If the host has no NVIDIA runtime, use plain `docker compose up -d --build`.

## Rebuild Department Indexes

After importing or restoring notebooks, rebuild the enabled Qdrant and SQLite
indexes from the app container:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

## Updates

```bash
git pull
docker compose build app
docker compose up -d
```

The named volumes preserve notebooks, Qdrant data, SQLite indexes, logs, and
Ollama models across image rebuilds.

## Backup Targets

Back up these Docker volumes together:

- `myai-data`
- `qdrant-storage`
- `qdrant-snapshots`
- `ollama-data`, if the target machine should avoid re-downloading models

`myai-data` contains `data/notebooks/`, which is the rebuildable source of truth
for department notebooks. Qdrant is an index over that source data.

## External Ollama

If you prefer to run Ollama directly on the host, override the app environment:

```bash
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434 docker compose up -d --build app qdrant
```

On Linux hosts that do not define `host.docker.internal`, add a host-gateway
mapping or use the host's bridge IP. The fully contained Compose stack avoids
that portability issue.
