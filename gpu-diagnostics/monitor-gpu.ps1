param(
  [int]$IntervalSeconds = 5
)

$ErrorActionPreference = 'Continue'
$diagnosticRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $diagnosticRoot | Out-Null

$mutex = New-Object System.Threading.Mutex($false, 'Local\SalnovaGpuDiagnosticsMonitor')
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

$pidPath = Join-Path $diagnosticRoot 'monitor.pid'
$statusPath = Join-Path $diagnosticRoot 'monitor-status.txt'
Set-Content -LiteralPath $pidPath -Value $PID

function Write-Status([string]$message) {
  $line = '{0:o} {1}' -f (Get-Date), $message
  Set-Content -LiteralPath $statusPath -Value $line
}

function Append-Line([string]$path, [string]$line) {
  [System.IO.File]::AppendAllText($path, $line + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
}

try {
  Write-Status "RUNNING pid=$PID interval=${IntervalSeconds}s"
  $lastEventCheck = (Get-Date).AddMinutes(-5)
  $sessionPath = Join-Path $diagnosticRoot ('session-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Append-Line $sessionPath ('Monitor started {0:o}; Windows={1}; PowerShell={2}' -f (Get-Date), [Environment]::OSVersion.VersionString, $PSVersionTable.PSVersion)

  while ($true) {
    $now = Get-Date
    $dailyGpuPath = Join-Path $diagnosticRoot ('gpu-{0}.csv' -f $now.ToString('yyyy-MM-dd'))
    if (-not (Test-Path -LiteralPath $dailyGpuPath)) {
      Append-Line $dailyGpuPath 'recorded_at,nvidia_timestamp,name,driver_version,pstate,temperature_c,gpu_util_percent,memory_used_mib,memory_total_mib,power_w,power_limit_w,graphics_clock_mhz,memory_clock_mhz,pcie_generation,pcie_width'
    }

    $gpuResult = & nvidia-smi --query-gpu=timestamp,name,driver_version,pstate,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,clocks.gr,clocks.mem,pcie.link.gen.current,pcie.link.width.current --format=csv,noheader,nounits 2>&1
    if ($LASTEXITCODE -eq 0) {
      foreach ($row in @($gpuResult)) {
        Append-Line $dailyGpuPath ('{0:o},{1}' -f $now, $row)
      }
    } else {
      Append-Line $dailyGpuPath ('{0:o},NVIDIA_SMI_FAILED,"{1}"' -f $now, (($gpuResult | Out-String).Trim() -replace '"','""'))
    }

    if (($now - $lastEventCheck).TotalSeconds -ge 30) {
      $eventPath = Join-Path $diagnosticRoot ('events-{0}.csv' -f $now.ToString('yyyy-MM-dd'))
      if (-not (Test-Path -LiteralPath $eventPath)) {
        Append-Line $eventPath 'time_created,id,level,provider,record_id,message'
      }
      $events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $lastEventCheck } -ErrorAction SilentlyContinue |
        Where-Object {
          $_.ProviderName -match 'Display|nvlddmkm|WHEA-Logger|Kernel-Power' -or $_.Id -in 41,4101
        } | Sort-Object TimeCreated
      foreach ($event in $events) {
        $message = ($event.Message -replace '[\r\n]+',' ' -replace '"','""')
        Append-Line $eventPath ('{0:o},{1},"{2}","{3}",{4},"{5}"' -f $event.TimeCreated, $event.Id, $event.LevelDisplayName, $event.ProviderName, $event.RecordId, $message)
      }
      $lastEventCheck = $now
      Write-Status "RUNNING pid=$PID last_sample=$($now.ToString('o'))"
    }

    Start-Sleep -Seconds ([Math]::Max(1, $IntervalSeconds))
  }
} catch {
  Append-Line $sessionPath ('Monitor stopped with error {0:o}: {1}' -f (Get-Date), ($_ | Out-String).Trim())
  Write-Status "STOPPED error=$($_.Exception.Message)"
} finally {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
