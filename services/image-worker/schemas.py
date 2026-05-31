from pydantic import BaseModel, Field
from typing import List, Optional

class GenerateRequest(BaseModel):
    prompt: str = Field(..., description="The textual description of the image to generate.")
    negative_prompt: Optional[str] = Field(None, description="Prompt describing what to exclude from the image.")
    width: int = Field(1024, ge=128, le=2048, description="Width of the generated image.")
    height: int = Field(1024, ge=128, le=2048, description="Height of the generated image.")
    num_images: int = Field(1, ge=1, le=4, description="Number of images to generate (1-4).")
    seed: Optional[int] = Field(None, description="Random seed. If null, a random one will be chosen.")
    num_inference_steps: int = Field(4, ge=1, le=100, description="Number of denoising steps.")
    guidance_scale: float = Field(0.0, ge=0.0, le=20.0, description="Guidance scale (CFG scale).")

class GeneratedImage(BaseModel):
    data: str = Field(..., description="Base64 encoded PNG image data.")
    seed: int = Field(..., description="Seed used for this image.")
    width: int = Field(..., description="Width of the image.")
    height: int = Field(..., description="Height of the image.")

class GenerateResponse(BaseModel):
    images: List[GeneratedImage]
    model: str
    elapsed_ms: int

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_name: Optional[str]
    gpu_available: bool
    vram_used_bytes: Optional[int]
    vram_total_bytes: Optional[int]
