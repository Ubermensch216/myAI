"""Hardware tier -> model/parameter mapping for the image worker.

The tier decides the default model, resolution, step count, and guidance scale.
`auto` detects available VRAM and picks the highest tier that fits. `IMAGE_MODEL`
overrides the tier model entirely. Keep this table in sync with
docs/IMAGE_GENERATION_PLAN.md.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class TierConfig:
    tier: str
    model: str
    size: int           # default square edge (px)
    steps: int          # default inference steps
    guidance: float     # default guidance scale (turbo models use 0.0)
    max_batch: int

    def to_dict(self) -> dict:
        return asdict(self)


# Ordered low -> high so VRAM auto-detection can scan upward.
TIERS: dict[str, TierConfig] = {
    "cpu": TierConfig("cpu", "stabilityai/sd-turbo", 512, 2, 0.0, 1),
    "low": TierConfig("low", "stabilityai/sd-turbo", 512, 3, 0.0, 1),
    "mid": TierConfig("mid", "stabilityai/sdxl-turbo", 768, 4, 0.0, 2),
    "high": TierConfig("high", "stabilityai/stable-diffusion-xl-base-1.0", 1024, 25, 7.0, 2),
    "max": TierConfig("max", "black-forest-labs/FLUX.1-schnell", 1024, 4, 0.0, 2),
}

# VRAM (GiB) thresholds, checked high -> low.
_VRAM_THRESHOLDS = [(24, "max"), (16, "high"), (8, "mid"), (4, "low")]


def _detect_vram_tier() -> str:
    """Pick a tier from detected CUDA VRAM. Falls back to cpu."""
    try:
        import torch

        if not torch.cuda.is_available():
            return "cpu"
        free, total = torch.cuda.mem_get_info()
        total_gib = total / (1024 ** 3)
        for threshold, tier in _VRAM_THRESHOLDS:
            if total_gib >= threshold:
                return tier
        return "low"
    except Exception:
        return "cpu"


def resolve_tier(requested: str | None) -> str:
    """Resolve a tier name. 'auto' triggers VRAM detection; unknown -> 'low'."""
    name = (requested or "low").strip().lower()
    if name == "auto":
        return _detect_vram_tier()
    if name in TIERS:
        return name
    return "low"


def get_config(requested_tier: str | None, model_override: str | None) -> TierConfig:
    """Return the effective tier config, applying an optional model override."""
    tier = resolve_tier(requested_tier)
    base = TIERS[tier]
    override = (model_override or "").strip()
    if override:
        return TierConfig(tier, override, base.size, base.steps, base.guidance, base.max_batch)
    return base


def config_from_env() -> TierConfig:
    return get_config(os.getenv("IMAGE_MODEL_TIER"), os.getenv("IMAGE_MODEL"))
