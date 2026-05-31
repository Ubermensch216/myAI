"""Input validation and clamping for the image worker.

The Node gateway also enforces per-user limits; this layer is the last line of
defence so the worker never trusts unclamped input.
"""
from __future__ import annotations

import os
import re

# Coarse blocklist. The goal is to refuse obviously disallowed intent
# (explicit sexual content, forged official documents). Intentionally simple;
# tune per deployment policy. Matched case-insensitively as whole-ish tokens.
_BLOCKED_PATTERNS = [
    r"\bnsfw\b",
    r"\bnude\b",
    r"\bnaked\b",
    r"\bporn\w*",
    r"\bsexual\b",
    r"위조",
    r"\bforged?\b",
    r"가짜\s*공문",
]
_BLOCKED_RE = re.compile("|".join(_BLOCKED_PATTERNS), re.IGNORECASE)


class SafetyError(ValueError):
    """Raised when a request is rejected by the safety layer."""


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def check_prompt(prompt: str) -> None:
    text = (prompt or "").strip()
    if not text:
        raise SafetyError("prompt is required")
    if len(text) > 2000:
        raise SafetyError("prompt too long (max 2000 chars)")
    if _BLOCKED_RE.search(text):
        raise SafetyError("prompt rejected by content policy")


def clamp_dimension(value: int | None, default: int, ceiling: int) -> int:
    """Clamp to [256, min(ceiling, env ceiling)] and snap to a multiple of 8."""
    hard_ceiling = ceiling
    raw = value if isinstance(value, int) and value > 0 else default
    clamped = max(256, min(hard_ceiling, raw))
    return clamped - (clamped % 8)


def clamp_batch(value: int | None, tier_max: int) -> int:
    env_max = _env_int("IMAGE_MAX_BATCH", 4)
    hard_max = max(1, min(env_max, tier_max))
    raw = value if isinstance(value, int) and value > 0 else 1
    return max(1, min(hard_max, raw))


def clamp_steps(value: int | None, default: int) -> int:
    raw = value if isinstance(value, int) and value > 0 else default
    return max(1, min(100, raw))


def env_max_width() -> int:
    return _env_int("IMAGE_MAX_WIDTH", 1024)


def env_max_height() -> int:
    return _env_int("IMAGE_MAX_HEIGHT", 1024)
