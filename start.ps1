$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$localTemp = Join-Path $root '.tmp'
$localCache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force -Path $localTemp,$localCache,(Join-Path $root '.npm-cache') | Out-Null
$env:TEMP = $localTemp
$env:TMP = $localTemp
$env:XDG_CACHE_HOME = $localCache
$env:YOLO_CONFIG_DIR = Join-Path $localCache 'ultralytics'
$env:npm_config_cache = Join-Path $root '.npm-cache'

$api = Start-Process -FilePath "$root\.venv313\Scripts\python.exe" -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $root -WindowStyle Hidden -PassThru
Write-Host "VisionFlow API started (PID $($api.Id)) at http://127.0.0.1:8000"
Write-Host "API documentation: http://127.0.0.1:8000/docs"
Write-Host "Starting frontend at http://127.0.0.1:5173"

try {
    npm run dev -- --host 127.0.0.1
} finally {
    Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
