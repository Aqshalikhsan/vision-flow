GPU diagnostics monitor

Files:
- gpu-YYYY-MM-DD.csv: GPU sample every 5 seconds.
- events-YYYY-MM-DD.csv: NVIDIA, Display, WHEA, and Kernel-Power events.
- session-*.log: monitor start/error information.
- monitor-status.txt: latest monitor heartbeat.

Start manually:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\monitor-gpu.ps1

Stop:
Use the PID in monitor.pid, then run Stop-Process -Id <PID>.
