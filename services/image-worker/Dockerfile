# myAI image-worker — FastAPI + Diffusers text-to-image service.
#
# CPU wheels by default so the image builds on any host. For GPU, pass a
# CUDA-matched torch index at build time and add the GPU overlay at run time:
#   docker build \
#     --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128 \
#     -t myai-image-worker services/image-worker
# (cu128 = RTX 50/Blackwell, cu121 = RTX 30/40, see requirements.txt)
ARG PYTHON_IMAGE=python:3.11-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    IMAGE_MODEL_TIER=cpu

WORKDIR /app

# Install torch first from the index matched to the target hardware. The default
# is CPU; requirements.txt then sees torch already satisfied and skips it.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url ${TORCH_INDEX_URL}

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

RUN mkdir -p /models \
  && useradd -m worker \
  && chown -R worker:worker /app /models
USER worker

EXPOSE 7861

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7861/health').status==200 else 1)"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7861"]
