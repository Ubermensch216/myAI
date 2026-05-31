"""FastAPI entrypoint for the myAI image worker.

Run:
    uvicorn app:app --host 127.0.0.1 --port 7861

Environment (see docs/IMAGE_GENERATION_PLAN.md):
    IMAGE_MODEL_TIER   auto|cpu|low|mid|high|max   (default low)
    IMAGE_MODEL        override tier model id      (optional)
    IMAGE_MAX_WIDTH / IMAGE_MAX_HEIGHT / IMAGE_MAX_BATCH
    IMAGE_WORKER_WARMUP=1  to load the model on startup
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from model_registry import config_from_env
from presets import preset_catalog
from providers.diffusers_provider import DiffusersProvider
from safety import SafetyError, check_prompt, env_max_height, env_max_width, clamp_batch
from schemas import (
    CapabilitiesResponse,
    GenerateRequest,
    GenerateResponse,
    HealthResponse,
)

_config = config_from_env()
_provider = DiffusersProvider(_config)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("IMAGE_WORKER_WARMUP", "0") in ("1", "true", "True"):
        _provider.warmup()
    yield


app = FastAPI(title="myAI image-worker", version="1.0", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        loaded=_provider.loaded,
        tier=_config.tier,
        model=_config.model,
        device=_provider.device,
    )


@app.get("/capabilities", response_model=CapabilitiesResponse)
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse(
        tier=_config.tier,
        model=_config.model,
        device=_provider.device,
        max_width=min(env_max_width(), 1024 if _config.tier in ("cpu", "low") else 2048),
        max_height=min(env_max_height(), 1024 if _config.tier in ("cpu", "low") else 2048),
        max_batch=clamp_batch(99, _config.max_batch),
        default_steps=_config.steps,
        style_presets=preset_catalog(),
    )


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    try:
        check_prompt(req.prompt)
    except SafetyError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        result = _provider.generate(req)
    except SafetyError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:  # noqa: BLE001 - surface generation failure to caller
        raise HTTPException(status_code=500, detail=f"generation failed: {err}") from err

    return GenerateResponse(**result)
