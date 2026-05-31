"""Style presets shared with the Node gateway via /capabilities.

Each preset augments the user prompt with a style suffix and a baseline negative
prompt. Presets are intentionally generic so they work across SD-Turbo, SDXL, and
FLUX. Keep ids stable — the frontend references them directly.
"""
from __future__ import annotations

STYLE_PRESETS: dict[str, dict[str, str]] = {
    "report": {
        "label": "공공 보고서",
        "prompt_suffix": "clean professional public-sector report illustration, flat, muted palette, high clarity",
        "negative": "text, watermark, logo, cluttered, low quality, distorted",
    },
    "cardnews": {
        "label": "카드뉴스",
        "prompt_suffix": "card news style, bold simple shapes, friendly, social media graphic, vivid",
        "negative": "text, watermark, photorealistic clutter, low quality",
    },
    "icon": {
        "label": "아이콘",
        "prompt_suffix": "flat vector icon, simple, centered, single subject, solid background, minimal",
        "negative": "text, watermark, photo, gradient noise, complex background, low quality",
    },
    "photo": {
        "label": "사진풍",
        "prompt_suffix": "photorealistic, natural lighting, detailed, high resolution photograph",
        "negative": "text, watermark, cartoon, illustration, deformed, low quality",
    },
    "illustration": {
        "label": "일러스트",
        "prompt_suffix": "digital illustration, soft shading, editorial style, cohesive color theme",
        "negative": "text, watermark, photo, deformed, low quality",
    },
}

DEFAULT_NEGATIVE = "text, watermark, logo, low quality, blurry, deformed"


def apply_preset(prompt: str, preset: str | None) -> tuple[str, str]:
    """Return (effective_prompt, baseline_negative) for the given preset id."""
    cfg = STYLE_PRESETS.get((preset or "").strip().lower())
    if not cfg:
        return prompt, DEFAULT_NEGATIVE
    suffix = cfg["prompt_suffix"]
    effective = f"{prompt.strip()}, {suffix}" if prompt.strip() else suffix
    return effective, cfg["negative"]


def preset_catalog() -> list[dict[str, str]]:
    return [{"id": pid, "label": cfg["label"]} for pid, cfg in STYLE_PRESETS.items()]
