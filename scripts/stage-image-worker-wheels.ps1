<#
.SYNOPSIS
  Build an offline install bundle for the image-worker on an INTERNET-CONNECTED
  staging PC, for transfer to a closed-network on-premise host.

.DESCRIPTION
  Downloads (a) the CUDA-matched torch wheels, (b) the requirements.txt wheels,
  and optionally (c) Hugging Face model folders, into a single bundle directory.
  Generates a SHA256 manifest so the closed-network host can verify integrity
  after transfer.

  On the closed-network host:
    pip install --no-index --find-links <bundle>\wheels torch torchvision torchaudio
    pip install --no-index --find-links <bundle>\wheels -r services\image-worker\requirements.txt
  then run the worker with the matching launcher in -Offline mode pointing at the
  copied model folder (see docs/IMAGE_GENERATION.md).

.EXAMPLE
  # RTX 50 / Blackwell ops bundle with the FLUX model (gated — accept license + set token first)
  .\scripts\stage-image-worker-wheels.ps1 -CudaIndex cu128 `
    -Models @("stabilityai/sdxl-turbo","black-forest-labs/FLUX.1-schnell") `
    -HfToken $env:HUGGINGFACE_TOKEN

.EXAMPLE
  # dev (RTX 5060) bundle, SDXL-Turbo only
  .\scripts\stage-image-worker-wheels.ps1 -CudaIndex cu128 -Models @("stabilityai/sdxl-turbo")
#>
param(
  [ValidateSet("cu128", "cu121", "cpu")]
  [string]$CudaIndex = "cu128",
  [string]$OutDir = "offline-bundle",
  [string[]]$Models = @(),
  [string]$HfToken = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$requirements = Join-Path $root "services\image-worker\requirements.txt"
if (-not (Test-Path -LiteralPath $requirements)) {
  throw "requirements.txt not found at $requirements"
}

$bundle = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }
$wheelDir = Join-Path $bundle "wheels"
$modelDir = Join-Path $bundle "models"
New-Item -ItemType Directory -Force -Path $wheelDir | Out-Null

$torchIndex = "https://download.pytorch.org/whl/$CudaIndex"
Write-Host "==> Downloading torch wheels ($CudaIndex) -> $wheelDir"
pip download torch torchvision torchaudio --index-url $torchIndex -d $wheelDir
if ($LASTEXITCODE -ne 0) { throw "pip download (torch) failed" }

Write-Host "==> Downloading requirements wheels -> $wheelDir"
pip download -r $requirements -d $wheelDir
if ($LASTEXITCODE -ne 0) { throw "pip download (requirements) failed" }

if ($Models.Count -gt 0) {
  New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
  if ($HfToken) { $env:HUGGINGFACE_TOKEN = $HfToken }
  foreach ($m in $Models) {
    $leaf = ($m -split "/")[-1]
    $dest = Join-Path $modelDir $leaf
    Write-Host "==> Downloading model $m -> $dest"
    huggingface-cli download $m --local-dir $dest
    if ($LASTEXITCODE -ne 0) { throw "huggingface-cli download failed for $m (gated models need an accepted license + HUGGINGFACE_TOKEN)" }
  }
}

Write-Host "==> Writing SHA256 manifest"
$manifest = Join-Path $bundle "SHA256SUMS.txt"
Push-Location $bundle
try {
  Get-ChildItem -Recurse -File |
    Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
    ForEach-Object {
      $rel = [System.IO.Path]::GetRelativePath($bundle, $_.FullName)
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      "$hash  $rel"
    } | Set-Content -LiteralPath $manifest -Encoding utf8
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Bundle ready: $bundle"
Write-Host "Transfer the whole folder to the closed-network host, then verify with:"
Write-Host "  Get-Content $bundle\SHA256SUMS.txt | ForEach-Object { ... }  (see docs/IMAGE_GENERATION.md)"
