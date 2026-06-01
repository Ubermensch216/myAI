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
$env:IMAGE_MODEL_TIER = "mid"
$env:IMAGE_MAX_WIDTH = "768"
$env:IMAGE_MAX_HEIGHT = "768"
$env:IMAGE_MAX_BATCH = "1"
$env:IMAGE_RETENTION_HOURS = "24"
$env:IMAGE_QUEUE_CONCURRENCY = "1"
$env:IMAGE_QUEUE_MAX_QUEUED = "8"
$env:IMAGE_GEN_TIMEOUT_MS = "240000"
$env:IMAGE_DAILY_LIMIT_PER_USER = "50"
$env:HF_HOME = "C:\AI\hf-cache"

if ($ModelPath) {
  $env:IMAGE_MODEL = $ModelPath
}

if ($Offline) {
  $env:HF_HUB_OFFLINE = "1"
  $env:TRANSFORMERS_OFFLINE = "1"
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
