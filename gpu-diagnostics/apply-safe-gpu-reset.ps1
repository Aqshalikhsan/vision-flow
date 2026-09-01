$ErrorActionPreference = 'Stop'
$diagnosticRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resultPath = Join-Path $diagnosticRoot 'last-fix-result.txt'

function Log([string]$message) {
  $line = '{0:o} {1}' -f (Get-Date), $message
  [System.IO.File]::AppendAllText($resultPath, $line + [Environment]::NewLine)
}

Set-Content -LiteralPath $resultPath -Value ('Started {0:o}' -f (Get-Date))

try {
  Log 'Stopping Gigabyte Control Center and NVIDIA Overlay processes.'
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(GCC|NVIDIA Overlay)$' } |
    Stop-Process -Force -ErrorAction SilentlyContinue

  Log 'Resetting NVIDIA graphics clocks to firmware defaults.'
  $gpuReset = & nvidia-smi --reset-gpu-clocks 2>&1
  Log (($gpuReset | Out-String).Trim())

  Log 'Resetting NVIDIA memory clocks to firmware defaults.'
  $memoryReset = & nvidia-smi --reset-memory-clocks 2>&1
  Log (($memoryReset | Out-String).Trim())

  Log 'Disabling PCI Express Link State Power Management on AC and DC.'
  & powercfg /setacvalueindex scheme_current sub_pciexpress ASPM 0
  if ($LASTEXITCODE -ne 0) { throw 'Failed to change AC PCIe power setting.' }
  & powercfg /setdcvalueindex scheme_current sub_pciexpress ASPM 0
  if ($LASTEXITCODE -ne 0) { throw 'Failed to change DC PCIe power setting.' }
  & powercfg /setactive scheme_current
  if ($LASTEXITCODE -ne 0) { throw 'Failed to reactivate the current power scheme.' }

  Log 'SAFE_RESET_COMPLETE'
} catch {
  Log ('SAFE_RESET_FAILED: ' + ($_ | Out-String).Trim())
  exit 1
}
