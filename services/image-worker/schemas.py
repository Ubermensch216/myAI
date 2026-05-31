"""Pydantic request/response models for the image worker."""
from __future__ import annotations

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    prompt: str = Field(..., description="User prompt")
    negative_prompt: str | None = Field(None, description="Extra negative prompt")
    style_preset: str | None = Field(None, description="Style preset id (see /capabilities)")
    width: int | None = None
    height: int | None = None
    steps: int | None = None
    guidance: float | None = None
    seed: int | None = None
    batch: int | None = Field(1, ge=1, le=8)


class GenerateMeta(BaseModel):
    model: str
    tier: str
    device: str
    width: int
    height: int
    steps: int
    guidance: float
    seed: int
    batch: int


class GenerateResponse(BaseModel):
    images: list[str] = Field(..., description="PNG images as base64 (no data URI prefix)")
    meta: GenerateMeta


class HealthResponse(BaseModel):
    status: str
    loaded: bool
    tier: str
    model: str
    device: str


class CapabilitiesResponse(BaseModel):
    tier: str
    model: str
    device: str
    max_width: int
    max_height: int
    max_batch: int
    default_steps: int
    style_presets: list[dict]
