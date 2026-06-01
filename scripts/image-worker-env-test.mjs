import assert from "node:assert/strict";
import fs from "node:fs";

const provider = fs.readFileSync(new URL("../services/image-worker/providers/diffusers_provider.py", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../services/image-worker/README.md", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/IMAGE_GENERATION.md", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

assert.match(provider, /local_files_only\s*=/, "diffusers provider must honor offline local-only loading");
assert.match(provider, /HF_HUB_OFFLINE/, "diffusers provider must derive local-only mode from HF_HUB_OFFLINE");

for (const scriptName of ["start-image-worker.rtx5060.ps1", "start-image-worker.rtx5000pro.ps1"]) {
  const script = fs.readFileSync(new URL(`./${scriptName}`, import.meta.url), "utf8");
  assert.match(script, /IMAGE_PROVIDER/, `${scriptName} sets image provider`);
  assert.match(script, /IMAGE_WORKER_URL/, `${scriptName} sets worker URL`);
  assert.match(script, /HF_HOME/, `${scriptName} sets Hugging Face cache root`);
  assert.match(script, /uvicorn/, `${scriptName} starts uvicorn`);
}

const devScript = fs.readFileSync(new URL("./start-image-worker.rtx5060.ps1", import.meta.url), "utf8");
assert.match(devScript, /\$env:IMAGE_MODEL_TIER\s*=\s*"mid"/, "RTX 5060 script must use mid tier");
assert.match(devScript, /\$env:IMAGE_MAX_BATCH\s*=\s*"1"/, "RTX 5060 script must cap batch at 1");
assert.match(devScript, /\$env:IMAGE_MAX_WIDTH\s*=\s*"768"/, "RTX 5060 script must cap width at 768");

const prodScript = fs.readFileSync(new URL("./start-image-worker.rtx5000pro.ps1", import.meta.url), "utf8");
assert.match(prodScript, /\$env:IMAGE_MODEL_TIER\s*=\s*"max"/, "RTX PRO 5000 script must use max tier");
assert.match(prodScript, /\$env:IMAGE_MAX_BATCH\s*=\s*"2"/, "RTX PRO 5000 script must cap batch at 2");
assert.match(prodScript, /\$env:IMAGE_MAX_WIDTH\s*=\s*"1024"/, "RTX PRO 5000 script must cap width at 1024");

for (const source of [readme, docs]) {
  assert.match(source, /cu128/, "image generation docs must recommend CUDA 12.8 PyTorch wheels for RTX 50/Blackwell");
  assert.match(source, /huggingface-cli download stabilityai\/sdxl-turbo/, "docs must include SDXL Turbo predownload command");
  assert.match(source, /huggingface-cli download black-forest-labs\/FLUX\.1-schnell/, "docs must include FLUX predownload command");
  assert.match(source, /HF_HUB_OFFLINE=1/, "docs must describe offline mode");
}

assert.match(envExample, /IMAGE_MODEL_TIER=mid/, ".env.example should default dev image tier to mid");
assert.match(envExample, /HF_HOME=C:\\AI\\hf-cache/, ".env.example should document HF cache root");

console.log("Image worker environment tests passed");
