# Image Generation

myAI adds AI image generation as a **separate runtime** behind a provider abstraction. Image
generation is never bolted onto Ollama: the local LLM keeps serving text, while a dedicated Python
image worker (Hugging Face Diffusers) serves images. The Node server talks only to the worker through
`server/imageGeneration/imageProvider.js`, so the backend can be swapped (Diffusers → ComfyUI → other)
by changing `IMAGE_PROVIDER` without touching feature code.

This document is the design baseline (Phase 0). It defines the hardware tiers, model candidates,
configuration schema, and operational policy. Later phases build the worker, the Node gateway, the
chat UI, and the infographic v2 renderer.

## Why a separate runtime

- **Fault isolation.** A GPU OOM or a stuck diffusion job must not take down the Node server or
  Ollama text chat. The worker is a separate process (separate host is fine).
- **No PyTorch in Node.** The main server stays lightweight; only the worker carries the heavy
  ML dependency tree.
- **Provider swappable.** Diffusers MVP first; ComfyUI later for advanced workflows
  (inpainting, ControlNet, upscale). Both implement the same provider interface.
- **vLLM is out of scope.** Text-LLM migration to vLLM is deliberately deferred. Image generation
  stays on a dedicated diffusion backend regardless of future text serving.

## Deployment topology

The image worker lives on the department GPU workstation next to Ollama. Personal PCs only run the
browser and never touch the worker directly.

```text
[Personal PC - browser]          [Department workstation]
  image gen toggle / cards         Node.js/Express :3000
  asset metadata only              |- Ollama :11434  (text)
       |                           |- image-worker :7861  (diffusers)
       ` fetch() -> /api/image      `- data/generated-assets/  (server temp, retention)
```

## Hardware tiers

The default is **minimum spec** (`low`, SD-Turbo). The tier is chosen by `IMAGE_MODEL_TIER`. With
`auto`, the worker detects available VRAM (`torch.cuda.mem_get_info`) and picks the highest tier that
fits. Setting `IMAGE_MODEL` directly overrides the tier's model entirely (full manual control).

| tier | VRAM    | default model                                      | size | steps | batch |
|------|---------|----------------------------------------------------|------|-------|-------|
| cpu  | none/CPU| `stabilityai/sd-turbo`                             | 512  | 1-2   | 1     |
| low  | 4-6 GB  | `stabilityai/sd-turbo`                             | 512  | 2-4   | 1     |
| mid  | 8-12 GB | `stabilityai/sdxl-turbo`                           | 768  | 2-6   | 2     |
| high | 16 GB   | `stabilityai/stable-diffusion-xl-base-1.0`         | 1024 | 20-30 | 2     |
| max  | 24 GB+  | `black-forest-labs/FLUX.1-schnell`                 | 1024 | 4     | 2     |

Notes:
- **Default tier is `low`** so myAI runs on modest hardware out of the box. Upgrade by editing
  `IMAGE_MODEL_TIER` (or `IMAGE_MODEL`) — no code change.
- The worker clamps requested `width`/`height`/`batch` to the tier ceiling and to
  `IMAGE_MAX_WIDTH/HEIGHT/BATCH`. On VRAM pressure it auto-downgrades resolution.
- `enable_model_cpu_offload` is used on constrained GPUs; `cpu` tier runs (slowly) without CUDA.

## Model licensing

- **SD-Turbo / SDXL-Turbo**: Stability AI Community / non-commercial vs. commercial terms vary —
  review before any commercial use. Suitable for internal/evaluation use.
- **SDXL base 1.0**: CreativeML OpenRAIL++-M.
- **FLUX.1-schnell**: Apache-2.0 (personal, scientific, commercial use permitted) but requires
  accepting the model access terms on Hugging Face, and the model card states it is **not** a source
  of factual information and may diverge from the prompt.

Model files are downloaded by an administrator only; the Hugging Face token lives server-side in
`.env` (`HUGGINGFACE_TOKEN`). Air-gapped installs should pre-stage the model cache.

## Configuration (.env)

See `.env.example` for the canonical list. Summary:

```env
IMAGE_PROVIDER=diffusers          # swap point: diffusers | comfyui (future)
IMAGE_WORKER_URL=http://127.0.0.1:7861
IMAGE_MODEL_TIER=low              # auto | cpu | low | mid | high | max
IMAGE_MODEL=                      # empty = tier default; set to override model id
IMAGE_MAX_WIDTH=1024
IMAGE_MAX_HEIGHT=1024
IMAGE_MAX_BATCH=4
IMAGE_RETENTION_HOURS=24
IMAGE_QUEUE_CONCURRENCY=1         # separate from text queues; 1 to protect VRAM
IMAGE_QUEUE_MAX_QUEUED=16
IMAGE_GEN_TIMEOUT_MS=180000
IMAGE_DAILY_LIMIT_PER_USER=50
HUGGINGFACE_TOKEN=                # server-side only, admin model downloads
```

When the worker is unreachable, image features degrade gracefully: the chat image toggle hides and
infographic "fast" mode (SVG, no images) keeps working. No existing feature depends on the worker.

## Asset storage & retention

- Generated PNGs are stored as **server temp files** under `data/generated-assets/`, served via
  `/api/image/assets/:assetId`, and deleted after `IMAGE_RETENTION_HOURS`.
- The browser persists **only asset metadata** (assetId, prompt, model, seed, size) in chat messages
  — large PNGs are unsuitable for IndexedDB. This mirrors how personal uploads keep server temp +
  client metadata (see `docs/ARCHITECTURE.md`).

## Image use in infographics

Infographics must **not** be rendered as a single generated image (broken text, wrong numbers,
missing citations). Instead:

```text
document/knowledge-pack -> evidence -> LLM infographic v2 JSON/SVG spec
-> myAI SVG renderer draws title/figures/charts/citations
-> image model fills background / icons / illustrations only
-> export PNG/SVG/PDF
```

Numbers, charts, citations, and body text are owned by the SVG renderer. The image model only
produces decorative/visual assets (`generated_background`, `generated_icon`).

## Operational & safety policy

- External image APIs are off by default; generation is local-only.
- Model downloads are admin-only; HF token never leaves the server.
- Usage logs store **metadata only** (model, seed, tier, success). Raw prompt logging is opt-in.
- Generated PNGs carry an "AI generated" metadata tag.
- Blocked content: NSFW, personal data, forged official documents, disinformation.
- Per-user daily generation cap (`IMAGE_DAILY_LIMIT_PER_USER`); image queue concurrency = 1.
- GPU OOM recovers without a server restart (worker handles/clears the failed job).

## Phase roadmap

| Phase | Scope |
|-------|-------|
| 0 | Tiers, config schema, this doc (current) |
| 1 | `services/image-worker/` FastAPI + Diffusers MVP (`/health`, `/capabilities`, `/generate`) |
| 2 | `server/imageGeneration/` provider, `imageQueue`, `/api/image/*`, asset store |
| 3 | 정보탐색 chat image generation UI (explicit toggle) |
| 4 | Infographic v2 SVG renderer + generated background/icon assets (fast vs advanced) |
| 5 | Operations, security, audit + ComfyUI provider swap readiness |
