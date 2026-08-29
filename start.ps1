$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$localEnvFile = Join-Path $root '.env.local'
if (Test-Path -LiteralPath $localEnvFile) {
    foreach ($line in Get-Content -LiteralPath $localEnvFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
        $parts = $trimmed.Split('=', 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key -match '^[A-Za-z_][A-Za-z0-9_]*$') {
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}
$localTemp = Join-Path $root '.tmp'
$localCache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force -Path $localTemp,$localCache,(Join-Path $root '.npm-cache') | Out-Null
$env:TEMP = $localTemp
$env:TMP = $localTemp
$env:XDG_CACHE_HOME = $localCache
$env:YOLO_CONFIG_DIR = Join-Path $localCache 'ultralytics'
$env:npm_config_cache = Join-Path $root '.npm-cache'
if (-not (Test-Path Env:GOOGLE_APPLICATION_CREDENTIALS)) {
    $firebaseKey = 'C:\Users\User\Downloads\project-firebase-58761-firebase-adminsdk-fbsvc-047f491071.json'
    if (Test-Path -LiteralPath $firebaseKey) {
        $env:GOOGLE_APPLICATION_CREDENTIALS = $firebaseKey
        Write-Host 'Firebase Admin credentials loaded.'
    } else {
        Write-Warning 'Firebase Admin service-account JSON belum ditemukan; Firebase bridge belum aktif.'
    }
}
if (-not (Test-Path Env:VISIONFLOW_REQUIRE_AUTH)) {
    $env:VISIONFLOW_REQUIRE_AUTH = '1'
}
if (-not (Test-Path Env:GEMINI_API_KEY)) {
    Write-Warning 'Chatbot Gemini belum aktif. Set GEMINI_API_KEY sebelum menjalankan Salnova.'
}

# Avoid silently attaching to an older API process that may still have
# authentication disabled and prevent the fresh server from binding port 8000.
$staleApiPids = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($staleApiPid in $staleApiPids) {
    if ($staleApiPid -and $staleApiPid -ne $PID) {
        Stop-Process -Id $staleApiPid -Force -ErrorAction SilentlyContinue
    }
}

$api = Start-Process -FilePath "$root\.venv313\Scripts\python.exe" -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $root -WindowStyle Hidden -PassThru
Write-Host "Salnova API started (PID $($api.Id)) at http://127.0.0.1:8000"
Write-Host "API documentation: http://127.0.0.1:8000/docs"
Write-Host "Starting frontend on all network interfaces (port 5173)"
Write-Host "On this PC: http://127.0.0.1:5173"
Write-Host "From another device: http://<THIS-PC-IP>:5173"

try {
    npm run dev -- --host 0.0.0.0
} finally {
    Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
