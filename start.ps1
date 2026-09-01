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

# Winget's portable Node package may not appear in PATH until the next login.
# Resolve npm directly so this launcher also works from an already-open shell.
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $npmCommand) {
    $wingetNodeRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe'
    $npmCommand = Get-ChildItem -LiteralPath $wingetNodeRoot -Filter npm.cmd -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -match 'node-v[^\\]+-win-x64$' } |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $npmCommand) {
    throw 'Node.js/npm tidak ditemukan. Install Node.js LTS lalu jalankan ulang start.ps1.'
}
$nodeDirectory = Split-Path -Parent $npmCommand
$env:PATH = "$nodeDirectory;$env:PATH"
if (-not (Test-Path Env:GOOGLE_APPLICATION_CREDENTIALS)) {
    Write-Warning 'Firebase bridge belum aktif. Atur GOOGLE_APPLICATION_CREDENTIALS ke service-account JSON jika diperlukan.'
}
if (-not (Test-Path Env:VISIONFLOW_REQUIRE_AUTH)) {
    $env:VISIONFLOW_REQUIRE_AUTH = '1'
}
if (-not (Test-Path Env:GEMINI_API_KEY)) {
    Write-Warning 'Chatbot Gemini belum aktif. Set GEMINI_API_KEY sebelum menjalankan Salnova.'
}

# Stop only an older Vite instance from this workspace. This commonly remains
# alive when its parent terminal is closed without Ctrl+C.
$staleFrontendPids = @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($staleFrontendPid in $staleFrontendPids) {
    $staleFrontend = Get-CimInstance Win32_Process -Filter "ProcessId=$staleFrontendPid" -ErrorAction SilentlyContinue
    $isThisFrontend = $staleFrontend -and
        $staleFrontend.Name -eq 'node.exe' -and
        $staleFrontend.CommandLine -like "*$root*" -and
        $staleFrontend.CommandLine -match 'vite(?:\.js)?' -and
        $staleFrontend.CommandLine -match '\bpreview\b'
    if ($isThisFrontend) {
        Write-Host "Stopping stale Salnova frontend (PID $staleFrontendPid)."
        Stop-Process -Id $staleFrontendPid -Force -ErrorAction SilentlyContinue
    } else {
        throw "Port 5173 dipakai aplikasi lain (PID $staleFrontendPid). Tutup aplikasi tersebut lalu jalankan ulang."
    }
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

$backendPython = Join-Path $root '.venv-backend\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $backendPython)) {
    throw 'Backend environment belum tersedia. Buat .venv-backend dan install backend/requirements.txt.'
}
$api = Start-Process -FilePath $backendPython -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $root -WindowStyle Hidden -PassThru
$apiReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($api.HasExited) {
        throw "Salnova API berhenti saat startup (exit code $($api.ExitCode))."
    }
    try {
        $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/ready' -TimeoutSec 1
        if ($ready.status -eq 'ready') {
            $apiReady = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
if (-not $apiReady) {
    Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
    throw 'Salnova API belum siap setelah 15 detik.'
}
Write-Host "Salnova API ready (PID $($api.Id)) at http://127.0.0.1:8000"
Write-Host "API documentation: http://127.0.0.1:8000/docs"
Write-Host "Building optimized frontend bundle."

try {
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build gagal (exit code $LASTEXITCODE)."
    }

    Write-Host "Starting frontend on all network interfaces (port 5173)."
    Write-Host "On this PC: http://127.0.0.1:5173"
    Write-Host "From another device: http://<THIS-PC-IP>:5173"
    & $npmCommand run preview -- --host 0.0.0.0 --port 5173 --strictPort
} finally {
    Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
