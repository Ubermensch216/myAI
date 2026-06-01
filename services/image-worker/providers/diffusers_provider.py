"""Diffusers-backed text-to-image provider.

Loads a single pipeline per tier model and runs text-to-image. Handles:
- lazy load + warmup
- CPU offload on constrained GPUs / CPU-only fallback
- automatic resolution downgrade and retry on CUDA OOM

The provider is single-instance and not thread-safe by itself; the worker serves
generation under a single-slot lock so the image queue concurrency (default 1)
is respected end to end.
"""
from __future__ import annotations

import base64
import io
import os
import threading

from model_registry import TierConfig
from presets import apply_preset
from safety import clamp_batch, clamp_dimension, clamp_steps, env_max_height, env_max_width


class DiffusersProvider:
    def __init__(self, config: TierConfig):
        self.config = config
        self._pipe = None
        self._device = "cpu"
        self._dtype = None
        self._lock = threading.Lock()

    # ---- lifecycle -------------------------------------------------------

    @property
    def device(self) -> str:
        return self._device

    @property
    def loaded(self) -> bool:
        return self._pipe is not None

    def load(self) -> None:
        """Load the pipeline. Safe to call repeatedly (no-op once loaded)."""
        if self._pipe is not None:
            return
        with self._lock:
            if self._pipe is not None:
                return
            self._pipe = self._build_pipeline()

    def _build_pipeline(self):
        import torch
        from diffusers import AutoPipelineForText2Image

        use_cuda = torch.cuda.is_available() and self.config.tier != "cpu"
        self._device = "cuda" if use_cuda else "cpu"
        self._dtype = torch.float16 if use_cuda else torch.float32

        pipe = AutoPipelineForText2Image.from_pretrained(
            self.config.model,
            torch_dtype=self._dtype,
            use_safetensors=True,
            local_files_only=_offline_mode_enabled(),
        )

        if use_cuda:
            # Offload keeps peak VRAM low on constrained GPUs. For larger cards
            # this is still safe and only marginally slower.
            try:
                pipe.enable_model_cpu_offload()
            except Exception:
                pipe = pipe.to("cuda")
            try:
                pipe.enable_vae_tiling()
            except Exception:
                pass
        else:
            pipe = pipe.to("cpu")

        pipe.set_progress_bar_config(disable=True)
        return pipe

    def warmup(self) -> None:
        """Best-effort warmup so the first real request is fast."""
        try:
            self.load()
        except Exception:
            # Warmup failures must not crash the worker; /health reports loaded=False.
            self._pipe = None

    # ---- generation ------------------------------------------------------

    def generate(self, req) -> dict:
        import torch

        self.load()

        effective_prompt, baseline_negative = apply_preset(req.prompt, req.style_preset)
        negative = ", ".join(
            p for p in [baseline_negative, (req.negative_prompt or "").strip()] if p
        )

        width = clamp_dimension(req.width, self.config.size, env_max_width())
        height = clamp_dimension(req.height, self.config.size, env_max_height())
        steps = clamp_steps(req.steps, self.config.steps)
        batch = clamp_batch(req.batch, self.config.max_batch)
        guidance = req.guidance if req.guidance is not None else self.config.guidance
        seed = req.seed if isinstance(req.seed, int) and req.seed >= 0 else _random_seed()

        with self._lock:
            images = self._run_with_oom_retry(
                prompt=effective_prompt,
                negative=negative,
                width=width,
                height=height,
                steps=steps,
                guidance=guidance,
                seed=seed,
                batch=batch,
            )

        return {
            "images": [_png_b64(img) for img in images["images"]],
            "meta": {
                "model": self.config.model,
                "tier": self.config.tier,
                "device": self._device,
                "width": images["width"],
                "height": images["height"],
                "steps": steps,
                "guidance": float(guidance),
                "seed": seed,
                "batch": batch,
            },
        }

    def _run_with_oom_retry(self, *, prompt, negative, width, height, steps, guidance, seed, batch):
        import torch

        attempt_dims = [(width, height)]
        # Progressive downgrade ladder on OOM.
        if width > 768 or height > 768:
            attempt_dims.append((min(width, 768), min(height, 768)))
        if width > 512 or height > 512:
            attempt_dims.append((512, 512))

        last_error: Exception | None = None
        for w, h in attempt_dims:
            try:
                generator = torch.Generator(device="cpu").manual_seed(seed)
                kwargs = dict(
                    prompt=prompt,
                    width=w,
                    height=h,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    num_images_per_prompt=batch,
                    generator=generator,
                )
                # FLUX pipelines reject negative_prompt; SD/SDXL accept it.
                if negative and "flux" not in self.config.model.lower():
                    kwargs["negative_prompt"] = negative
                result = self._pipe(**kwargs)
                return {"images": result.images, "width": w, "height": h}
            except torch.cuda.OutOfMemoryError as err:  # type: ignore[attr-defined]
                last_error = err
                torch.cuda.empty_cache()
                continue
            except RuntimeError as err:
                if "out of memory" in str(err).lower():
                    last_error = err
                    torch.cuda.empty_cache()
                    continue
                raise
        raise RuntimeError(f"image generation failed (OOM after downgrades): {last_error}")


def _random_seed() -> int:
    import secrets

    return secrets.randbelow(2 ** 31)


def _offline_mode_enabled() -> bool:
    return os.getenv("HF_HUB_OFFLINE", "").strip().lower() in ("1", "true", "yes", "on")


def _png_b64(image) -> str:
    buffer = io.BytesIO()
    # AI-generated provenance marker in PNG metadata.
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("generator", "myAI image-worker")
    info.add_text("ai_generated", "true")
    image.save(buffer, format="PNG", pnginfo=info)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
