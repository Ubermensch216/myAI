# myAI image-worker

A standalone FastAPI + Hugging Face Diffusers service that generates images for myAI.
It runs separately from the Node server and Ollama so a GPU OOM or a stuck diffusion
job cannot take down chat or the main API. The Node server reaches it only through
`server/imageGeneration/imageProvider.js`.

See `docs/IMAGE_GENERATION.md` for the overall design and hardware tiers.

## Install

Install a CUDA-matched torch build first, then the rest:

```bash
cd services/image-worker
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

The first generation downloads the model from Hugging Face. Set `HUGGINGFACE_TOKEN`
for gated models (e.g. FLUX.1-schnell requires accepting its license on HF first).

## Run

```bash
# default tier = low (SD-Turbo, 512px, runs on modest GPUs / CPU)
uvicorn app:app --host 127.0.0.1 --port 7861

# repository launcher for RTX 5060 Laptop dev (SDXL-Turbo, 768px, batch 1)
..\..\scripts\start-image-worker.rtx5060.ps1

# repository launcher for RTX PRO 5000 Blackwell ops (FLUX tier, 1024px, batch 2)
..\..\scripts\start-image-worker.rtx5000pro.ps1

# pick a tier or override the model
IMAGE_MODEL_TIER=auto uvicorn app:app --port 7861
IMAGE_MODEL=black-forest-labs/FLUX.1-schnell uvicorn app:app --port 7861

# warm the model on startup (otherwise it loads on first /generate)
IMAGE_WORKER_WARMUP=1 uvicorn app:app --port 7861
```

## Closed-network preparation

Download models on an internet-connected staging PC, then copy the folders to
the on-premise host:

```powershell
huggingface-cli download stabilityai/sdxl-turbo --local-dir C:\AI\models\sdxl-turbo
huggingface-cli download black-forest-labs/FLUX.1-schnell --local-dir C:\AI\models\flux-schnell
```

Run offline with a local model path:

```powershell
..\..\scripts\start-image-worker.rtx5060.ps1 -Offline -ModelPath C:\AI\models\sdxl-turbo -Warmup
```

`-Offline` sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`. The provider
then passes `local_files_only=True` to Diffusers.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | load state, tier, model, device |
| GET | `/capabilities` | size/batch ceilings, default steps, style presets |
| POST | `/generate` | text-to-image; returns base64 PNGs + meta |

### `/generate` request

```json
{
  "prompt": "상수도 누수 점검 절차 카드뉴스 일러스트",
  "negative_prompt": "",
  "style_preset": "cardnews",
  "width": 768,
  "height": 768,
  "steps": 4,
  "seed": 12345,
  "batch": 2
}
```

`style_preset` is one of the ids from `/capabilities` (`report`, `cardnews`, `icon`,
`photo`, `illustration`). Width/height/batch/steps are clamped to the tier ceiling
and to `IMAGE_MAX_*`. On CUDA OOM the worker downgrades resolution and retries.

### Smoke test

```bash
curl localhost:7861/health
curl localhost:7861/capabilities
curl -X POST localhost:7861/generate -H 'Content-Type: application/json' \
  -d '{"prompt":"a flat vector icon of a water pipe","style_preset":"icon","batch":1}'
```

## Tiers

| tier | VRAM | model | size | steps |
|------|------|-------|------|-------|
| cpu  | none | sd-turbo | 512 | 2 |
| low  | 4-6 GB | sd-turbo | 512 | 3 |
| mid  | 8-12 GB | sdxl-turbo | 768 | 4 |
| high | 16 GB | sdxl-base-1.0 | 1024 | 25 |
| max  | 24 GB+ | FLUX.1-schnell | 1024 | 4 |

Change the tier with `IMAGE_MODEL_TIER`; no code change needed.
