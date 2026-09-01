#requires -Version 5.1
<#
.SYNOPSIS
  Menjalankan Salnova training worker terus-menerus dan otomatis.

.DESCRIPTION
  setup.ps1 bawaan memasang runtime lalu menjalankan worker sekali di foreground,
  sehingga training berhenti saat worker crash, laptop sleep, atau terminal ditutup.
  Script ini menambahkan tiga hal:

    1. Auto-detect server  - mencoba beberapa alamat dan memakai yang pertama hidup,
                             jadi laptop yang berpindah antara LAN dan internet tetap
                             menemukan NAS tanpa diedit.
    2. Supervisor          - menjalankan ulang worker dengan backoff kalau berhenti.
    3. Auto-start          - mendaftarkan Scheduled Task supaya jalan saat login.

  Token disimpan sekali di profil pengguna, jadi tidak perlu ditempel ulang dan
  tidak ikut tersimpan di repo.

.PARAMETER Token
  Worker token dari halaman Train. Wajib pada pemakaian pertama; setelahnya
  dibaca dari file konfigurasi.

.PARAMETER Server
  Paksa satu alamat server. Kalau kosong, dipakai daftar auto-detect.

.PARAMETER Install
  Daftarkan Scheduled Task supaya worker jalan otomatis saat login.

.PARAMETER Uninstall
  Hapus Scheduled Task tersebut.

.EXAMPLE
  .\worker\run-worker.ps1 -Token "wt_xxx" -Install
  Simpan token, daftarkan auto-start, lalu mulai bekerja.

.EXAMPLE
  .\worker\run-worker.ps1
  Jalankan memakai token dan server yang sudah tersimpan.
#>
[CmdletBinding()]
param(
    [string] $Token,
    [string] $Server,
    [switch] $Install,
    [switch] $Uninstall,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

# Alamat yang dicoba berurutan. LAN didahulukan: lebih cepat untuk unduh dataset
# dan tidak kena batas ukuran request 100 MB milik Cloudflare Free saat worker
# mengunggah checkpoint kembali. Sesuaikan bila NAS atau domain berubah.
$DefaultServers = @(
    "http://192.168.11.160:8080",
    "https://salnova-ai.my.id"
)

$ConfigDir = Join-Path $env:LOCALAPPDATA "Salnova"
$ConfigFile = Join-Path $ConfigDir "worker.json"
$TaskName = "Salnova Training Worker"

function Write-Step { param([string] $Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string] $Message) Write-Host "!!  $Message" -ForegroundColor Yellow }

function Get-RepoRoot {
    if ($PSScriptRoot) { return (Split-Path -Parent $PSScriptRoot) }
    return (Get-Location).Path
}

function Find-WorkerPython {
    # setup.ps1 membuat venv di SALNOVA_WORKER_HOME atau .runtime/VisionFlowWorker.
    $roots = @()
    if ($env:SALNOVA_WORKER_HOME) { $roots += $env:SALNOVA_WORKER_HOME }
    $roots += (Join-Path (Get-RepoRoot) ".runtime/VisionFlowWorker")
    $roots += (Join-Path $env:LOCALAPPDATA "VisionFlowWorker")

    foreach ($root in $roots) {
        $candidate = Join-Path $root ".venv/Scripts/python.exe"
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        # Existing is not the same as working. A venv whose base interpreter was
        # uninstalled, or that was copied to another folder, still has its
        # python.exe but dies with "did not find executable at ...". Run it once
        # so the failure surfaces here instead of inside the restart loop.
        # $ErrorActionPreference is Stop for the script, which would turn that
        # probe's stderr into a thrown error and hide the guidance below.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $candidate -c "import sys" *> $null
        $usable = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $previous
        if ($usable) { return $candidate }
        Write-Warn "Venv rusak, dilewati: $candidate"
    }
    return $null
}

function Find-WorkerScript {
    $roots = @()
    if ($env:SALNOVA_WORKER_HOME) { $roots += $env:SALNOVA_WORKER_HOME }
    $roots += (Join-Path (Get-RepoRoot) ".runtime/VisionFlowWorker")
    $roots += (Get-RepoRoot)

    foreach ($root in $roots) {
        $candidate = Join-Path $root "worker/visionflow_worker.py"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Read-Config {
    if (-not (Test-Path -LiteralPath $ConfigFile)) { return $null }
    try { return (Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json) }
    catch { Write-Warn "Konfigurasi rusak, akan ditulis ulang: $ConfigFile"; return $null }
}

function Write-Config {
    param([string] $TokenValue, [string] $ServerValue)
    if (-not (Test-Path -LiteralPath $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }
    $payload = [ordered]@{ token = $TokenValue; server = $ServerValue }
    $payload | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding utf8

    # Token adalah kredensial: batasi ke pemilik profil saja.
    try {
        $acl = Get-Acl -LiteralPath $ConfigFile
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $env:USERNAME, "FullControl", "Allow")
        $acl.SetAccessRule($rule)
        Set-Acl -LiteralPath $ConfigFile -AclObject $acl
    } catch {
        Write-Warn "Gagal mengunci izin $ConfigFile. Token tersimpan tapi bisa dibaca akun lain di PC ini."
    }
}

function Test-ServerAlive {
    param([string] $Url)
    try {
        $response = Invoke-WebRequest -Uri "$Url/api/health" -TimeoutSec 6 -UseBasicParsing
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Resolve-Server {
    param([string] $Preferred)
    $candidates = @()
    if ($Preferred) { $candidates += $Preferred }
    $candidates += $DefaultServers
    $candidates = $candidates | Select-Object -Unique

    foreach ($candidate in $candidates) {
        Write-Host "    cek $candidate ..." -NoNewline
        if (Test-ServerAlive $candidate) { Write-Host " hidup" -ForegroundColor Green; return $candidate }
        Write-Host " tidak menjawab" -ForegroundColor DarkGray
    }
    return $null
}

function Install-AutoStart {
    $scriptPath = $PSCommandPath
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    # Worker berumur panjang: jangan dihentikan otomatis, dan tetap jalan saat baterai.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description "Menjalankan Salnova training worker otomatis saat login." `
        -Force | Out-Null
    Write-Step "Auto-start terpasang sebagai Scheduled Task '$TaskName'."
}

function Uninstall-AutoStart {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Step "Auto-start '$TaskName' dihapus."
    } else {
        Write-Step "Auto-start '$TaskName' memang belum terpasang."
    }
}

# ---------------------------------------------------------------- alur utama

if ($Uninstall) { Uninstall-AutoStart; return }

$config = Read-Config
if (-not $Token -and $config) { $Token = $config.token }
if (-not $Server -and $config) { $Server = $config.server }

if (-not $Token) {
    throw @"
Worker token belum ada.

Buka halaman Train di instance PRODUKSI (bukan localhost), salin token-nya, lalu:

    .\worker\run-worker.ps1 -Token "<token>" -Install

Token dari instance lokal tidak akan diterima NAS.
"@
}

$python = Find-WorkerPython
$script = Find-WorkerScript
if (-not $python) {
    throw @"
Tidak ada venv worker yang bisa dijalankan.

Kalau di atas muncul 'Venv rusak', interpreter dasarnya sudah dihapus atau
foldernya dipindah - venv tidak bisa diperbaiki, harus dibuat ulang.

Unduh setup.ps1 dari halaman Train lalu jalankan; ia akan memasang Python dan
PyTorch yang cocok, baru setelah itu jalankan skrip ini lagi.
"@
}
if (-not $script) { throw "visionflow_worker.py tidak ditemukan. Jalankan setup.ps1 dari halaman Train dulu." }

Write-Step "Mencari server yang aktif"
$resolved = Resolve-Server $Server
if (-not $resolved) {
    throw "Tidak ada server yang menjawab. Dicoba: $($DefaultServers -join ', '). Periksa koneksi atau status NAS."
}

if ($DryRun) {
    Write-Step "Dry run - semua prasyarat terpenuhi, worker tidak dijalankan."
    Write-Host "    python : $python"
    Write-Host "    script : $script"
    Write-Host "    server : $resolved"
    Write-Host "    token  : tersedia ($($Token.Length) karakter)"
    return
}

Write-Config -TokenValue $Token -ServerValue $resolved
if ($Install) { Install-AutoStart }

Write-Step "Worker aktif -> $resolved"
Write-Host "    Ctrl+C untuk berhenti. Worker akan otomatis start ulang bila terputus." -ForegroundColor DarkGray

$delay = 5
while ($true) {
    # Server bisa berpindah saat laptop keluar-masuk LAN, jadi periksa tiap siklus.
    if (-not (Test-ServerAlive $resolved)) {
        Write-Warn "$resolved tidak menjawab, mencari alamat lain..."
        $next = Resolve-Server $null
        if ($next) {
            $resolved = $next
            Write-Config -TokenValue $Token -ServerValue $resolved
            Write-Step "Beralih ke $resolved"
        }
    }

    & $python $script --server $resolved --token $Token
    $code = $LASTEXITCODE

    if ($code -eq 0) {
        Write-Step "Worker berhenti normal."
        break
    }

    Write-Warn "Worker berhenti (exit $code). Mencoba lagi dalam $delay detik."
    Start-Sleep -Seconds $delay
    # Backoff sampai 2 menit supaya NAS tidak dibanjiri saat mati lama.
    $delay = [Math]::Min($delay * 2, 120)
}
