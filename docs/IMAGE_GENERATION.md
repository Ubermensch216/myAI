# Image Generation

myAI provides AI image generation as a separate runtime behind a provider abstraction. Image generation is separate from Ollama: the local LLM serves text, while a dedicated Python image worker (Hugging Face Diffusers) or a ComfyUI server serves images. The Node server communicates with the worker through `server/imageGeneration/imageProvider.js`. The backend can be swapped (`diffusers` or `comfyui`) by changing `IMAGE_PROVIDER` in `.env`.

This document is the authoritative reference for design, **closed-network on-premise** install, configuration, operation, and the API. The intended deployment is an air-gapped (no internet) department GPU workstation.

> 쉬운 말로 정리한 **설치·운영·사용 가이드**는 [IMAGE_GENERATION_GUIDE.md](IMAGE_GENERATION_GUIDE.md)를 참고하세요 (관리자/직원 대상).

## Architecture

- **Fault Isolation:** GPU Out-of-Memory (OOM) errors or stuck diffusion jobs do not disrupt the Node.js server or Ollama text chat. The worker runs as a separate process.
- **Provider Abstraction:** A Python Diffusers worker and ComfyUI both implement the same provider interface (`server/imageGeneration/imageProvider.js`).
- **Async Jobs:** `POST /api/image/generate` returns `202 {jobId}` immediately; the browser polls `GET /api/image/jobs/:id`. Work runs on a separate image queue (concurrency 1) so it never blocks text.
- **Asset Storage & Retention:** Generated PNGs are stored under `data/generated-assets/` and deleted after `IMAGE_RETENTION_HOURS` by an hourly sweep. The browser persists only asset metadata in chat messages.
- **State Persistence:** Daily-quota counters (`data/image-quota.json`) and job snapshots (`data/image-jobs.json`) are persisted so a Node restart does not reset quotas or lose finished jobs. See [Operations & Resilience](#operations--resilience).

## Deployment Topology

The image worker/ComfyUI runs on the department GPU workstation next to Ollama. Personal PCs run only the browser and access the worker through the Node.js server.

```text
[Personal PC - browser]          [Department workstation — air-gapped]
  image gen toggle / cards         Node.js/Express :3000
  asset metadata only              |- Ollama :11434  (text)
       |                           |- image-worker :7861  (diffusers) or ComfyUI :8188
       ` fetch() -> /api/image      `- data/generated-assets/  (server temp, retention)
                                    `- data/image-quota.json, data/image-jobs.json  (state)
```

## Hardware Tiers (Diffusers Worker)

The tier is selected automatically based on available VRAM, or set explicitly via `IMAGE_MODEL_TIER`.

| Tier | VRAM | Default Model | Size (px) | Default Steps | Max Batch |
|---|---|---|---|---:|---:|
| `cpu` | None | `stabilityai/sd-turbo` | 512 | 2 | 1 |
| `low` | 4–6 GB | `stabilityai/sd-turbo` | 512 | 3 | 1 |
| `mid` | 7–12 GB | `stabilityai/sdxl-turbo` | 768 | 4 | 2 |
| `high` | 16 GB | `stabilityai/stable-diffusion-xl-base-1.0` | 1024 | 25 | 2 |
| `max` | 24 GB+ | `black-forest-labs/FLUX.1-schnell` | 1024 | 4 | 2 |

- Default tier is `low`. `IMAGE_MODEL` overrides the tier's model entirely.
- The worker clamps requested dimensions/batch to the tier ceiling and to `IMAGE_MAX_*`.
- **VRAM auto-detection caveat:** an "8 GB" laptop GPU reports ~7.96 GiB (e.g. RTX 5060 Laptop = 8151 MiB). The `mid` threshold is therefore **7 GiB**, not 8, so `auto` lands on `mid` rather than dropping to `low`. When in doubt, set `IMAGE_MODEL_TIER` explicitly via the launcher (below).

## Hardware Profiles (dev / ops)

Use the checked-in PowerShell launchers so the worker has an explicit hardware profile instead of relying on the root `.env` alone.

```powershell
# dev — RTX 5060 Laptop (8 GB class): SDXL-Turbo, 768px, batch 1
.\scripts\start-image-worker.rtx5060.ps1

# ops — RTX PRO 5000 Blackwell (48 GB class): FLUX.1-schnell, 1024px, batch 2
.\scripts\start-image-worker.rtx5000pro.ps1
```

Both launchers accept `-Offline`, `-ModelPath <local model folder>`, and `-Warmup`.

### GPU memory mode (`IMAGE_CUDA_OFFLOAD`)

CPU offload keeps peak VRAM low but adds per-step CPU↔GPU transfers. On a big ops card a full GPU load is markedly faster, so offload is gated:

| Value | Behaviour |
|---|---|
| `auto` (default) | Offload on `cpu`/`low`/`mid`; full-GPU load on `high`/`max`. |
| `force` | Always `enable_model_cpu_offload()` (use if a high/max card is also running other GPU work). |
| `off` | Always full-GPU load (only if VRAM clearly fits the model). |

`max`/FLUX uses **bfloat16**; SD/SDXL use float16. Blackwell has native bf16, so the ops card pays nothing for this.

## Closed-Network Operation

Two-stage workflow: build a bundle on an internet-connected **staging PC**, transfer it to the air-gapped **on-premise host**.

### 1. Offline Install (Python deps)

RTX 50/Blackwell **requires CUDA 12.8** torch wheels (`cu128`). Older NVIDIA cards may use `cu121`; CPU-only uses `cpu`.

On the staging PC, mirror wheels + (optionally) models into one bundle:

```powershell
# downloads torch (cu128) + requirements wheels into offline-bundle\wheels,
# models into offline-bundle\models, and writes SHA256SUMS.txt
.\scripts\stage-image-worker-wheels.ps1 -CudaIndex cu128 `
  -Models @("stabilityai/sdxl-turbo","black-forest-labs/FLUX.1-schnell") `
  -HfToken $env:HUGGINGFACE_TOKEN
```

Transfer `offline-bundle\` to the on-premise host. On that host:

```powershell
cd services\image-worker
python -m venv .venv ; .\.venv\Scripts\Activate.ps1
pip install --no-index --find-links <bundle>\wheels torch torchvision torchaudio
pip install --no-index --find-links <bundle>\wheels -r requirements.txt
```

### 2. Model Staging & Integrity

`stage-image-worker-wheels.ps1` already pulls the model folders. To stage manually:

```powershell
huggingface-cli download stabilityai/sdxl-turbo        --local-dir C:\AI\models\sdxl-turbo
huggingface-cli download black-forest-labs/FLUX.1-schnell --local-dir C:\AI\models\flux-schnell
```

- **FLUX is gated:** accept its license on huggingface.co and set `HUGGINGFACE_TOKEN` on the staging PC *before* downloading. It also pulls a large T5 text encoder.
- **Path consistency:** the launcher's `-ModelPath` must point at the **copied model folder** (e.g. `C:\AI\models\sdxl-turbo`). Do not rely on the `HF_HOME` cache being populated unless you copied the cache too — the launcher fails fast if neither `-ModelPath` nor a populated `HF_HOME` exists.
- **Integrity:** verify `SHA256SUMS.txt` after transfer (supply-chain hygiene for removable media):

```powershell
Push-Location <bundle>
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h,$f = $_ -split '\s+',2
  if ((Get-FileHash $f -Algorithm SHA256).Hash -ne $h) { Write-Error "MISMATCH: $f" }
}
Pop-Location
```

### 3. Run offline

```powershell
.\scripts\start-image-worker.rtx5060.ps1 -Offline -ModelPath C:\AI\models\sdxl-turbo -Warmup
```

`-Offline` sets `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`; the provider then passes `local_files_only=True` to Diffusers. `-Warmup` pre-loads the model on startup so the first request does not pay cold-start latency. With neither `-ModelPath` nor a populated cache, the launcher aborts before uvicorn with a clear message.

## ComfyUI Provider

1. Set `IMAGE_PROVIDER=comfyui` and `COMFYUI_URL` in `.env`.
2. Set `COMFYUI_WORKFLOW_TEXT2IMG` to a pinned workflow JSON path.
3. The server substitutes placeholders (`%PROMPT%`, `%NEGATIVE%`, `%WIDTH%`, `%HEIGHT%`, `%STEPS%`, `%SEED%`, `%BATCH%`) per request and sends the graph to ComfyUI.

## Configuration (.env)

```env
IMAGE_PROVIDER=diffusers          # diffusers | comfyui
IMAGE_WORKER_URL=http://127.0.0.1:7861
IMAGE_MODEL_TIER=mid              # auto | cpu | low | mid | high | max
IMAGE_MODEL=                      # empty = tier default; set to override model id / local path
IMAGE_MAX_WIDTH=768
IMAGE_MAX_HEIGHT=768
IMAGE_MAX_BATCH=1
IMAGE_RETENTION_HOURS=24          # hourly sweep deletes PNGs older than this
IMAGE_QUEUE_CONCURRENCY=1         # concurrency of 1 protects VRAM
IMAGE_QUEUE_MAX_QUEUED=8
IMAGE_GEN_TIMEOUT_MS=240000       # server-side cap; client poll waits longer
IMAGE_WORKER_WARMUP=0             # 1 = pre-load model on worker startup
IMAGE_CUDA_OFFLOAD=auto           # auto | force | off  (see Hardware Profiles)
IMAGE_DAILY_LIMIT_PER_USER=50     # per group:level bucket (see Operations)
HUGGINGFACE_TOKEN=                # staging-only, for gated model downloads
HF_HOME=C:\AI\hf-cache
HF_HUB_OFFLINE=                   # 1 for closed-network (or use launcher -Offline)
TRANSFORMERS_OFFLINE=             # 1 for closed-network
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_TEXT2IMG=        # path to pinned comfyui workflow JSON
```

> `IMAGE_WORKER_WARMUP` and `IMAGE_CUDA_OFFLOAD` are read by the Python worker (the launchers set them). The rest are read by the Node gateway and/or the worker.

## Operations & Resilience

- **State persistence:** Daily-quota counters persist to `data/image-quota.json` and job snapshots to `data/image-jobs.json` (debounced, atomic temp+rename writes). On Node restart:
  - Quotas survive — restarting cannot be used to reset the daily cap.
  - Finished (`done`) jobs remain pollable; their PNGs are on disk.
  - Jobs that were `queued`/`running` cannot be resumed (the worker request died with the old process) and load back as `error` ("서버 재시작으로 중단되었습니다.").
- **Daily limit bucket:** `IMAGE_DAILY_LIMIT_PER_USER` is keyed by `group:level` from the access token, **not** an individual user id. With few groups this is effectively a shared bucket; size it accordingly.
- **Retention / disk:** the hourly sweep deletes PNGs older than `IMAGE_RETENTION_HOURS` (mtime-based, 1–720 h). Size `data/generated-assets/` for `daily_volume × avg_png × retention_hours/24`.
- **Throughput:** a single worker with concurrency 1 serializes generation department-wide; `IMAGE_QUEUE_MAX_QUEUED` bounds the backlog. This suits low-volume use; there is no horizontal scaling.
- **Cold start:** prefer `-Warmup` (or `IMAGE_WORKER_WARMUP=1`) on the workstation so the first `/generate` after a restart isn't slow. `IMAGE_GEN_TIMEOUT_MS` is the safety net, not the primary fix.

## Security

- **Worker binding / no auth:** the worker has **no authentication** and is meant to bind `127.0.0.1:7861` on the same host as Node. If you ever move it to a separate GPU host, it must be protected by network isolation or an authenticating reverse proxy — never expose `:7861` directly.
- **Prompt validation (defence in depth):** both the Node gateway (`server/imageGeneration/imageSafety.js`) and the worker (`services/image-worker/safety.py`) run a coarse blocklist (explicit content, official-document forgery). This is intentionally simple — **tune it per deployment policy**. Extend the `BLOCKED_RE` / `_BLOCKED_PATTERNS` for public-sector / closed-network content rules.
- **Provenance:** generated PNGs carry `ai_generated=true` metadata.
- **Logging:** `image_generate` events are logged metadata-only — prompt text is never recorded.

## API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/image/generate` | enqueue; returns `202 {jobId}` |
| GET | `/api/image/jobs/:id` | poll job status / assets / error |
| POST | `/api/image/jobs/:id/cancel` | cancel a queued/running job |
| GET | `/api/image/assets/:id` | fetch a generated PNG |

Worker endpoints (behind the gateway): `GET /health`, `GET /capabilities`, `POST /generate`. See `services/image-worker/README.md` for request/response shapes and a smoke test.
