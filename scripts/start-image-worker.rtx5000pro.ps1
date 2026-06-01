param(
  [string]$ModelPath = "",
  [switch]$Offline,
  [switch]$Warmup
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$workerDir = Join-Path $root "services\image-worker"
$venvUvicorn = Join-Path $workerDir ".venv\Scripts\uvicorn.exe"

$env:IMAGE_PROVIDER = "diffusers"
$env:IMAGE_WORKER_URL = "http://127.0.0.1:7861"
$env:IMAGE_MODEL_TIER = "max"
$env:IMAGE_MAX_WIDTH = "1024"
$env:IMAGE_MAX_HEIGHT = "1024"
$env:IMAGE_MAX_BATCH = "2"
$env:IMAGE_RETENTION_HOURS = "24"
$env:IMAGE_QUEUE_CONCURRENCY = "1"
$env:IMAGE_QUEUE_MAX_QUEUED = "16"
$env:IMAGE_GEN_TIMEOUT_MS = "300000"
$env:IMAGE_DAILY_LIMIT_PER_USER = "50"
$env:HF_HOME = "C:\AI\hf-cache"

if ($ModelPath) {
  if (-not (Test-Path -LiteralPath $ModelPath)) {
    throw "-ModelPath '$ModelPath' not found. Point it at the copied local model folder (see docs/IMAGE_GENERATION.md)."
  }
  $env:IMAGE_MODEL = $ModelPath
}

if ($Offline) {
  $env:HF_HUB_OFFLINE = "1"
  $env:TRANSFORMERS_OFFLINE = "1"
  # Fail fast before uvicorn: offline load needs either an explicit local model
  # folder or a populated HF cache. Otherwise the tier-default repo id cannot be
  # fetched on a closed network and the worker errors only on first /generate.
  if (-not $ModelPath -and -not (Test-Path -LiteralPath $env:HF_HOME)) {
    throw "-Offline requires -ModelPath <local model folder> OR a populated HF cache at HF_HOME ($env:HF_HOME). Neither found — model staging is incomplete."
  }
}

if ($Warmup) {
  $env:IMAGE_WORKER_WARMUP = "1"
}

Push-Location $workerDir
try {
  if (Test-Path -LiteralPath $venvUvicorn) {
    & $venvUvicorn app:app --host 127.0.0.1 --port 7861
  } else {
    & uvicorn app:app --host 127.0.0.1 --port 7861
  }
} finally {
  Pop-Location
}
