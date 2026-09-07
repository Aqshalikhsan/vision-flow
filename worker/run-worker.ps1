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
    [string] $WorkerId,
    [string] $WorkerHome,
    [switch] $Install,
    [switch] $InstallTaskOnly,
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

# Keep the lab worker token next to its runtime instead of in the repository or
# LOCALAPPDATA. A task started at boot may run before an interactive profile is
# fully loaded, but the runtime directory is already available on this PC.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$KnownRuntimeRoot = Join-Path $env:USERPROFILE "SalnovaWorker"
$ConfigRoot = if ($WorkerHome) {
    $WorkerHome
} elseif ($env:SALNOVA_WORKER_HOME) {
    $env:SALNOVA_WORKER_HOME
} elseif (Test-Path -LiteralPath $KnownRuntimeRoot) {
    $KnownRuntimeRoot
} else {
    $RepoRoot
}
$ConfigDir = Join-Path $ConfigRoot ".salnova"
$ConfigFile = Join-Path $ConfigDir "worker.json"
$LegacyConfigFile = Join-Path $RepoRoot ".salnova/worker.json"
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
    $roots += $ConfigRoot
    if ($env:SALNOVA_WORKER_HOME) { $roots += $env:SALNOVA_WORKER_HOME }
    $roots += (Get-RepoRoot)
    $roots += (Join-Path $env:USERPROFILE "SalnovaWorker")
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
    $roots += $ConfigRoot
    if ($env:SALNOVA_WORKER_HOME) { $roots += $env:SALNOVA_WORKER_HOME }
    $roots += (Join-Path $env:USERPROFILE "SalnovaWorker")
    $roots += (Join-Path (Get-RepoRoot) ".runtime/VisionFlowWorker")
    $roots += (Get-RepoRoot)

    foreach ($root in $roots) {
        $candidate = Join-Path $root "worker/visionflow_worker.py"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Read-Config {
    $candidate = if (Test-Path -LiteralPath $ConfigFile) {
        $ConfigFile
    } elseif (Test-Path -LiteralPath $LegacyConfigFile) {
        $LegacyConfigFile
    } else {
        return $null
    }
    try { return (Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json) }
    catch { Write-Warn "Konfigurasi rusak, akan ditulis ulang: $ConfigFile"; return $null }
}

function Write-Config {
    param([string] $TokenValue, [string] $ServerValue, [string] $WorkerIdValue)
    if (-not (Test-Path -LiteralPath $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }
    $payload = [ordered]@{
        token = $TokenValue
        server = $ServerValue
        workerId = $WorkerIdValue
    }
    $payload | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding utf8

    # Token adalah kredensial: batasi ke pemilik profil saja.
    try {
        $acl = Get-Acl -LiteralPath $ConfigFile
        $acl.SetAccessRuleProtection($true, $false)
        $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentIdentity, "FullControl", "Allow")
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

function New-WorkerShortcut {
    param([string] $ShortcutPath, [string] $Description)
    $scriptPath = $PSCommandPath
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -WorkerHome `"$ConfigRoot`""
    $shortcut.WorkingDirectory = Split-Path -Parent $scriptPath
    $shortcut.Description = $Description
    $shortcut.Save()
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-SystemAutoStart {
    if (-not (Test-Administrator)) {
        throw "Administrator diperlukan untuk memasang worker saat boot."
    }
    $scriptPath = $PSCommandPath
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -WorkerHome `"$ConfigRoot`"" `
        -WorkingDirectory (Split-Path -Parent $scriptPath)
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
        -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description "Menjalankan Salnova training worker sejak Windows boot dan mengulanginya bila berhenti." `
        -Force | Out-Null
    Write-Step "Auto-start sistem terpasang sebagai Scheduled Task '$TaskName'."
}

function Install-AutoStart {
    $startupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Salnova Training Worker.lnk"
    $manualShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Start Salnova Worker.lnk"
    New-WorkerShortcut $startupShortcut "Menjalankan Salnova worker otomatis saat user login."
    New-WorkerShortcut $manualShortcut "Menyalakan atau memperbaiki koneksi Salnova worker secara manual."
    Write-Step "Shortcut login otomatis dan shortcut manual di Desktop sudah dibuat."

    if (Test-Administrator) {
        Install-SystemAutoStart
        return
    }
    try {
        Write-Step "Meminta izin Administrator satu kali untuk auto-start saat boot..."
        $arguments = @(
            "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
            "-File", "`"$PSCommandPath`"", "-InstallTaskOnly",
            "-WorkerHome", "`"$ConfigRoot`""
        )
        $elevated = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments `
            -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if ($elevated.ExitCode -ne 0) {
            throw "Installer Administrator berhenti dengan exit code $($elevated.ExitCode)."
        }
        Write-Step "Auto-start saat boot berhasil dipasang."
    } catch {
        Write-Warn "Izin Administrator tidak diberikan. Worker tetap otomatis aktif setelah login Windows."
    }
}

function Uninstall-AutoStart {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Step "Auto-start '$TaskName' dihapus."
    } else {
        Write-Step "Auto-start '$TaskName' memang belum terpasang."
    }
    Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath("Startup")) "Salnova Training Worker.lnk") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath("Desktop")) "Start Salnova Worker.lnk") -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- alur utama

if ($InstallTaskOnly) {
    $installLog = Join-Path $ConfigRoot "task-install.log"
    try {
        Install-SystemAutoStart
        "$(Get-Date -Format o) Scheduled Task installed successfully." | Set-Content -LiteralPath $installLog
        exit 0
    } catch {
        "$(Get-Date -Format o) $($_ | Out-String)" | Set-Content -LiteralPath $installLog
        exit 1
    }
}
if ($Uninstall) { Uninstall-AutoStart; return }

$config = Read-Config
if (-not $Token -and $config) { $Token = $config.token }
if (-not $Server -and $config) { $Server = $config.server }
if (-not $WorkerId -and $config) { $WorkerId = $config.workerId }
if (-not $WorkerId) {
    $deviceDirectories = @(Get-ChildItem -LiteralPath (Join-Path $ConfigRoot "devices") -Directory -ErrorAction SilentlyContinue)
    if ($deviceDirectories.Count -eq 1) { $WorkerId = $deviceDirectories[0].Name }
}

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
    if ($DryRun) {
        throw "Tidak ada server yang menjawab. Dicoba: $($DefaultServers -join ', '). Periksa koneksi atau status NAS."
    }
    Write-Warn "Server belum tersedia. Worker akan menunggu dan mencoba lagi setiap 30 detik."
    while (-not $resolved) {
        Start-Sleep -Seconds 30
        $resolved = Resolve-Server $Server
    }
}

if ($DryRun) {
    Write-Step "Dry run - semua prasyarat terpenuhi, worker tidak dijalankan."
    Write-Host "    python : $python"
    Write-Host "    script : $script"
    Write-Host "    server : $resolved"
    Write-Host "    token  : tersedia ($($Token.Length) karakter)"
    return
}

Write-Config -TokenValue $Token -ServerValue $resolved -WorkerIdValue $WorkerId
if ($Install) { Install-AutoStart }

$existingWorker = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -and
        $_.CommandLine -like "*visionflow_worker.py*"
    } |
    Select-Object -First 1
if ($existingWorker) {
    Write-Step "Worker sudah aktif (PID $($existingWorker.ProcessId)); tidak membuat proses duplikat."
    return
}

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

    $workerArguments = @(
        $script, "--server", $resolved, "--token", $Token,
        "--provider", "local", "--keep-jobs"
    )
    if ($WorkerId) {
        $deviceRoot = Join-Path $ConfigRoot "devices/$WorkerId"
        New-Item -ItemType Directory -Force -Path $deviceRoot | Out-Null
        $workerArguments += @("--work-dir", $deviceRoot)
    }
    & $python @workerArguments
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
