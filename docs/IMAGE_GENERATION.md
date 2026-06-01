# Image Generation

myAI provides AI image generation as a separate runtime behind a provider abstraction. Image generation is separate from Ollama: the local LLM serves text, while a dedicated Python image worker (Hugging Face Diffusers) or a ComfyUI server serves images. The Node server communicates with the worker through `server/imageGeneration/imageProvider.js`. The backend can be swapped (`diffusers` or `comfyui`) by changing `IMAGE_PROVIDER` in `.env`.

This document describes the design, configuration, deployment, and API of the image generation service.

## Architecture

- **Fault Isolation:** GPU Out-of-Memory (OOM) errors or stuck diffusion jobs do not disrupt the Node.js server or Ollama text chat. The worker operates as a separate process.
- **Provider Abstraction:** Supports both a Python Diffusers worker and ComfyUI. Both implement the same provider interface (`server/imageGeneration/imageProvider.js`).
- **Asset Storage & Retention:** Generated PNGs are stored as server temporary files under `data/generated-assets/` and deleted after `IMAGE_RETENTION_HOURS`. The browser persists only asset metadata in chat messages to keep IndexedDB sizes lightweight.

## Deployment Topology

The image worker/ComfyUI runs on the department GPU workstation next to Ollama. Personal PCs run only the browser and access the worker through the Node.js server.

```text
[Personal PC - browser]          [Department workstation]
  image gen toggle / cards         Node.js/Express :3000
  asset metadata only              |- Ollama :11434  (text)
       |                           |- image-worker :7861  (diffusers) or ComfyUI :8188
       ` fetch() -> /api/image      `- data/generated-assets/  (server temp, retention)
```

## Hardware Tiers (Diffusers Worker)

The tier is selected automatically based on available VRAM or configured explicitly via `IMAGE_MODEL_TIER`.

| Tier | VRAM | Default Model | Size (px) | Default Steps | Max Batch |
|---|---|---|---|---:|---:|
| `cpu` | None | `stabilityai/sd-turbo` | 512 | 2 | 1 |
| `low` | 4-6 GB | `stabilityai/sd-turbo` | 512 | 3 | 1 |
| `mid` | 8-12 GB | `stabilityai/sdxl-turbo` | 768 | 4 | 2 |
| `high` | 16 GB | `stabilityai/stable-diffusion-xl-base-1.0` | 1024 | 25 | 2 |
| `max` | 24 GB+ | `black-forest-labs/FLUX.1-schnell` | 1024 | 4 | 2 |

- The default tier is `low`.
- Setting `IMAGE_MODEL` directly overrides the default model for the tier.
- The worker automatically clamps requested dimensions and batch sizes to the tier ceiling.

## ComfyUI Provider

To use ComfyUI:
1. Set `IMAGE_PROVIDER=comfyui` and `COMFYUI_URL` in `.env`.
2. Configure `COMFYUI_WORKFLOW_TEXT2IMG` with the path to a saved workflow JSON.
3. The server substitutes placeholders in the JSON (`%PROMPT%`, `%NEGATIVE%`, `%WIDTH%`, `%HEIGHT%`, `%STEPS%`, `%SEED%`, `%BATCH%`) per request and sends the prompt graph to ComfyUI.

## Configuration (.env)

Canonical environment variables for image generation:

```env
IMAGE_PROVIDER=diffusers          # diffusers | comfyui
IMAGE_WORKER_URL=http://127.0.0.1:7861
IMAGE_MODEL_TIER=low              # auto | cpu | low | mid | high | max
IMAGE_MODEL=                      # empty = tier default; set to override model id
IMAGE_MAX_WIDTH=1024
IMAGE_MAX_HEIGHT=1024
IMAGE_MAX_BATCH=4
IMAGE_RETENTION_HOURS=24
IMAGE_QUEUE_CONCURRENCY=1         # concurrency of 1 protects VRAM
IMAGE_QUEUE_MAX_QUEUED=16
IMAGE_GEN_TIMEOUT_MS=180000
IMAGE_DAILY_LIMIT_PER_USER=50
HUGGINGFACE_TOKEN=                # server-side only, for admin model downloads
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_TEXT2IMG=        # path to pinned comfyui workflow JSON
```

## Telemetry & Safety

- **Daily Limits:** Users are subject to a daily generation quota (`IMAGE_DAILY_LIMIT_PER_USER`).
- **Prompt Validation:** Prompt inputs are filtered to block unsafe contents (NSFW, personal data, etc.) before queuing.
- **AI Tagging:** Generated PNG files are stamped with an metadata tag indicating they are AI-generated.
- **Log Events:** Tracks `image_generate` events in metadata-only logs (no prompt text is recorded).
