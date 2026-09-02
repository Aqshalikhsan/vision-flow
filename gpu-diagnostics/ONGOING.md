# Ongoing: RTX 5060 black-screen / CUDA stability investigation

Last updated: 2026-08-31 16:42 Asia/Bangkok

## User intent

- Diagnose why CUDA access causes black screens or incompatibility messages.
- This investigation is separate from the web project; do not modify app code.
- Preserve diagnostic logs automatically so a later Codex session can resume.

## Confirmed findings

- GPU: NVIDIA GeForce RTX 5060, 8 GB, WDDM.
- NVIDIA driver: 591.86; `nvidia-smi` reports CUDA 13.1.
- GPU idle state was healthy at inspection: 31 C, about 19 W.
- Windows Error Reporting recorded `LiveKernelEvent 0x141` in
  `nvlddmkm.sys`, bucket label `Blackwell_UserOC`.
- Windows also recorded `VIDEO_TDR_FAILURE 0x116` in `nvlddmkm.sys` and wrote
  `C:\Windows\Minidump\083126-7000-01.dmp`.
- System log contains corrected PCI Express Root Port errors:
  `WHEA-Logger` event 17 on 2026-08-26 and 2026-08-31.
- Unexpected reboot evidence exists as `Kernel-Power` event 41.
- Gigabyte Control Center (`GCC`) and NVIDIA Overlay were running during the
  inspection. An OC/tuning profile has not yet been confirmed manually.
- `C:\Users\User\SalnovaWorker\.venv` currently does not contain `torch` or
  `torchvision`; its interrupted install is not proof of CUDA wheel
  incompatibility.

## Current assessment

GPU compute is currently working after resetting NVIDIA graphics/memory clocks
to firmware defaults and disabling PCI Express Link State Power Management.
The original failure was a combination of prior TDR/PCIe instability and a
worker environment that did not contain a CUDA-enabled PyTorch build.

## Fixes applied and verified (2026-08-31)

- Elevated `nvidia-smi --reset-gpu-clocks` and `--reset-memory-clocks`
  completed successfully.
- Gigabyte Control Center and NVIDIA Overlay were stopped during the reset.
  NVIDIA Overlay later respawned, but subsequent load tests remained stable.
- PCI Express Link State Power Management is now Off for AC and DC on the
  active Balanced power scheme.
- Installed official PyTorch CUDA packages in
  `C:\Users\User\SalnovaWorker\.venv`:
  - `torch 2.13.0+cu130`
  - `torchvision 0.28.0+cu130`
  - `ultralytics 8.4.136`
  - requests and all worker requirements
- CUDA reports RTX 5060 correctly with compute capability 12.0.
- Small CUDA matmul and torchvision GPU NMS passed.
- A controlled full-load FP16 matmul test ran at 100% GPU, approximately
  145 W and 52 C, with no WHEA, TDR, black screen, or driver reset.
- Five CUDA training steps with convolution, autograd, backward pass, and
  AdamW completed successfully; loss decreased and no new GPU events appeared.
- Safe reset log: `gpu-diagnostics/last-fix-result.txt`.

The GPU is usable for training now. Continue monitoring during the first real
training job. If instability returns after a reboot, first rerun
`gpu-diagnostics/apply-safe-gpu-reset.ps1` as Administrator and verify that
NVIDIA Automatic Tuning/GCC performance profiles are disabled.

## Worker registration check (2026-09-02)

- The RTX 5060 runtime and CUDA environment remain installed and were
  previously validated, but no `Salnova Training Worker` scheduled task,
  worker process, or local worker configuration was active during this check.
- The production registry contains no `this-pc` (shared PC RTX) worker. Its
  non-revoked entries are `own-device` workers; their stored heartbeat is stale,
  so none is currently usable as an online shared RTX worker.
- The deployed backend supports a shared `this-pc` worker for every account,
  but it must first be created from the production Train page and its downloaded
  setup script must be run on this RTX PC.
- The production Train page now exposes this only as **Admin lab: daftarkan PC
  RTX sekali**. Its Windows setup installs `Salnova Training Worker` with boot
  and logon triggers, and `worker/run-worker.ps1` now also locates the existing
  `C:\Users\User\SalnovaWorker` runtime. Normal users only select the shared
  worker once its heartbeat is online.

## Logging

- Monitor script: `gpu-diagnostics/monitor-gpu.ps1`
- GPU samples: `gpu-diagnostics/gpu-YYYY-MM-DD.csv`
- Relevant Windows events: `gpu-diagnostics/events-YYYY-MM-DD.csv`
- Heartbeat: `gpu-diagnostics/monitor-status.txt`
- Monitor PID: `gpu-diagnostics/monitor.pid`
- Windows scheduled task: `SalnovaGpuDiagnostics` (runs at user logon).
- The monitor was started successfully on 2026-08-31 and its heartbeat and GPU
  sample files were verified.

## Next checks

1. Run the first real training job while the automatic monitor remains active.
2. Confirm NVIDIA Automatic Tuning and GCC performance/OC settings remain off,
   especially after reboot.
3. If TDR/WHEA returns, check PSU model/wattage, GPU power cable and seating,
   XMP/CPU overclock, chipset driver, and BIOS before changing Python packages.
4. A clean NVIDIA driver install or rollback is not currently necessary because
   CUDA detection, full load, NMS, and training/backpropagation all pass.
