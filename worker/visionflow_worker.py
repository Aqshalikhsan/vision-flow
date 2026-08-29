"""VisionFlow laptop training worker.

The NAS remains the source of truth. This process claims remote jobs, downloads
an immutable dataset version, trains with Ultralytics, and uploads best.pt.
"""
from __future__ import annotations

import argparse
import json
import numbers
import os
import platform
import re
import shutil
import sys
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

import requests
import torch
from ultralytics import YOLO


class TrainingCancelled(Exception):
    pass


def is_evaluation_artifact(path: Path) -> bool:
    if path.name in {
        "results.png", "confusion_matrix.png", "confusion_matrix_normalized.png",
        "F1_curve.png", "PR_curve.png", "P_curve.png", "R_curve.png",
        "labels.jpg", "labels_correlogram.jpg", "args.yaml",
    }:
        return True
    return bool(
        re.fullmatch(r"(Box|Mask|Pose)(F1|PR|P|R)_curve\.png", path.name)
        or
        re.fullmatch(r"train_batch\d+\.jpg", path.name)
        or re.fullmatch(r"val_batch\d+_(labels|pred)\.jpg", path.name)
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO training jobs from a VisionFlow NAS")
    parser.add_argument("--server", default=os.getenv("VISIONFLOW_SERVER", "http://127.0.0.1:8000"))
    parser.add_argument("--token", default=os.getenv("VISIONFLOW_WORKER_TOKEN"))
    parser.add_argument("--work-dir", default=os.getenv("VISIONFLOW_WORK_DIR", "visionflow-worker-data"))
    parser.add_argument(
        "--provider",
        default=os.getenv("VISIONFLOW_WORKER_PROVIDER", "local"),
        choices=("local", "google-colab", "cloud-vm"),
    )
    parser.add_argument("--poll-seconds", type=max_poll, default=10)
    parser.add_argument("--once", action="store_true", help="Exit after one job or one empty claim")
    parser.add_argument("--keep-jobs", action="store_true", help="Keep successful run directories")
    args = parser.parse_args()
    if not args.token:
        parser.error("provide --token or VISIONFLOW_WORKER_TOKEN")
    return args


def max_poll(value: str) -> int:
    parsed = int(value)
    if not 2 <= parsed <= 300:
        raise argparse.ArgumentTypeError("poll interval must be between 2 and 300 seconds")
    return parsed


class VisionFlowWorker:
    def __init__(self, server: str, token: str, work_dir: Path, keep_jobs: bool, provider: str = "local"):
        self.server = server.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.work_dir = work_dir.resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.keep_jobs = keep_jobs
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        cuda_available = torch.cuda.is_available()
        self.capabilities = {
            "cuda": cuda_available,
            "gpuName": torch.cuda.get_device_name(0) if cuda_available else "",
            "gpuCount": torch.cuda.device_count() if cuda_available else 0,
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda or "",
            "cpu": platform.processor() or platform.machine(),
            "platform": f"{platform.system()} {platform.release()}",
            "provider": provider,
        }

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = self.session.request(method, self.server + path, timeout=kwargs.pop("timeout", 60), **kwargs)
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            raise requests.HTTPError(f"{response.status_code}: {detail}", response=response)
        return response

    def heartbeat(self) -> None:
        self.request("POST", "/api/training-workers/agent/heartbeat", json={"capabilities": self.capabilities})

    def claim(self) -> dict[str, Any] | None:
        response = self.request("POST", "/api/training-workers/agent/claim")
        return None if response.status_code == 204 else response.json()

    def job_cancelled(self, model_id: str) -> bool:
        try:
            response = self.request("GET", f"/api/training-workers/agent/jobs/{model_id}", timeout=15)
            return bool(response.json().get("cancelled"))
        except requests.RequestException as exc:
            print(f"[worker] status check unavailable; training continues: {exc}", flush=True)
            return False

    def download_checkpoint(self, path: str, destination: Path) -> None:
        with self.request("GET", path, stream=True, timeout=(30, 3600)) as response, destination.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)

    def upload_recovery_checkpoints(self, model_id: str, weights_dir: Path) -> bool:
        uploaded_last = False
        for kind in ("last", "best"):
            checkpoint_path = weights_dir / f"{kind}.pt"
            if not checkpoint_path.is_file():
                continue
            try:
                with checkpoint_path.open("rb") as checkpoint:
                    self.request(
                        "POST",
                        f"/api/training-workers/agent/jobs/{model_id}/checkpoint/{kind}",
                        data=checkpoint,
                        headers={"Content-Type": "application/octet-stream"},
                        timeout=1800,
                    )
                uploaded_last = uploaded_last or kind == "last"
                print(f"[worker] recovery {kind}.pt uploaded", flush=True)
            except requests.RequestException as exc:
                print(f"[worker] could not upload recovery {kind}.pt: {exc}", flush=True)
        return uploaded_last

    def download_dataset(self, job: dict[str, Any], destination: Path) -> Path:
        archive = destination / "dataset.zip"
        model_id = job["id"]
        print(
            "[worker] preparing dataset archive; large versions can take several minutes before download starts",
            flush=True,
        )
        preparation_stop = threading.Event()

        def show_preparation_progress() -> None:
            last_signature: tuple[Any, ...] | None = None
            while not preparation_stop.wait(2):
                try:
                    response = requests.get(
                        self.server + f"/api/training-workers/agent/jobs/{model_id}",
                        headers=self.headers,
                        timeout=15,
                    )
                    response.raise_for_status()
                    detail = response.json().get("trainingDetail") or {}
                    signature = (
                        detail.get("stage"),
                        detail.get("archivePercent"),
                        detail.get("processedFiles"),
                    )
                    if signature == last_signature or not detail.get("stage"):
                        continue
                    message = f"[worker] {detail['stage']}"
                    if detail.get("archivePercent") is not None:
                        message += f" {detail['archivePercent']}%"
                    if detail.get("totalFiles"):
                        message += (
                            f" · {detail.get('processedFiles', 0):,}/"
                            f"{detail['totalFiles']:,} files"
                        )
                    print(message, flush=True)
                    last_signature = signature
                except requests.RequestException:
                    continue

        preparation_thread = threading.Thread(
            target=show_preparation_progress,
            daemon=True,
        )
        preparation_thread.start()
        downloaded = 0
        last_reported = -1
        try:
            response = self.request(
                "GET",
                job["datasetUrl"],
                stream=True,
                timeout=(30, 3600),
            )
        finally:
            preparation_stop.set()
            preparation_thread.join(timeout=2)
        with response, archive.open("wb") as output:
            total = int(response.headers.get("Content-Length", "0") or 0)
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        percent = downloaded * 100 // total
                        if percent >= last_reported + 10:
                            print(
                                f"[worker] dataset download {percent}% "
                                f"({downloaded / 1024**3:.2f}/{total / 1024**3:.2f} GB)",
                                flush=True,
                            )
                            try:
                                requests.post(
                                    self.server
                                    + f"/api/training-workers/agent/jobs/{model_id}/progress",
                                    headers=self.headers,
                                    json={
                                        "progress": 5,
                                        "stage": f"Downloading dataset {percent}%",
                                        "metrics": {},
                                    },
                                    timeout=15,
                                ).raise_for_status()
                            except requests.RequestException:
                                pass
                            last_reported = percent
        print(
            f"[worker] dataset downloaded ({downloaded / 1024**3:.2f} GB); extracting",
            flush=True,
        )
        try:
            self.request(
                "POST",
                f"/api/training-workers/agent/jobs/{model_id}/progress",
                json={"progress": 5, "stage": "Extracting dataset", "metrics": {}},
                timeout=15,
            )
        except requests.RequestException:
            pass
        dataset = destination / "dataset"
        dataset.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            root = dataset.resolve()
            for item in bundle.infolist():
                target = (root / item.filename).resolve()
                if root != target and root not in target.parents:
                    raise RuntimeError("dataset archive contains an unsafe path")
            bundle.extractall(dataset)
        data_yaml = dataset / "data.yaml"
        if data_yaml.is_file():
            lines = data_yaml.read_text(encoding="utf-8").splitlines()
            replacement = f"path: {json.dumps(dataset.as_posix())}"
            lines = [replacement if line.strip().startswith("path:") else line for line in lines]
            if not any(line.strip().startswith("path:") for line in lines):
                lines.insert(0, replacement)
            data_yaml.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return dataset

    def run_job(self, job: dict[str, Any]) -> None:
        heartbeat_stop = threading.Event()

        def keep_alive() -> None:
            while not heartbeat_stop.wait(30):
                try:
                    requests.post(
                        self.server + "/api/training-workers/agent/heartbeat",
                        headers=self.headers,
                        json={"capabilities": self.capabilities},
                        timeout=15,
                    ).raise_for_status()
                except requests.RequestException as exc:
                    print(f"[worker] heartbeat unavailable; will retry: {exc}", flush=True)

        heartbeat_thread = threading.Thread(target=keep_alive, daemon=True)
        heartbeat_thread.start()
        try:
            self._run_job(job)
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=2)

    def _run_job(self, job: dict[str, Any]) -> None:
        model_id = job["id"]
        config = job["config"]
        job_dir = (self.work_dir / model_id).resolve()
        if job_dir.parent != self.work_dir:
            raise RuntimeError("invalid remote job identifier")
        last_checkpoint = job_dir / "run" / "weights" / "last.pt"
        dataset_dir = job_dir / "dataset"
        if job_dir.exists() and not last_checkpoint.is_file() and not dataset_dir.is_dir():
            shutil.rmtree(job_dir)
        job_dir.mkdir(parents=True, exist_ok=True)
        if job.get("resumeUrl") and not last_checkpoint.is_file():
            last_checkpoint.parent.mkdir(parents=True, exist_ok=True)
            print("[worker] downloading resumable last.pt", flush=True)
            self.download_checkpoint(job["resumeUrl"], last_checkpoint)
        resume = last_checkpoint.is_file()
        action = "resuming" if resume else "claimed"
        print(f"[worker] {action} {model_id}: {job['projectName']} v{job['version']}", flush=True)
        dataset = dataset_dir if dataset_dir.is_dir() else self.download_dataset(job, job_dir)
        target = config.get("execution_target", "remote-auto")
        if target in {"remote-gpu", "colab-gpu"}:
            if not self.capabilities["cuda"]:
                raise RuntimeError(
                    "job requires CUDA, but this worker cannot access an NVIDIA GPU; "
                    f"PyTorch {torch.__version__}, CUDA runtime {torch.version.cuda or 'none'}"
                )
            device: str | int = 0
        elif target in {"remote-cpu", "colab-cpu"}:
            device = "cpu"
        else:
            device = 0 if self.capabilities["cuda"] else "cpu"
        task_data: str = str(dataset if "Classification" in job["projectType"] else dataset / "data.yaml")
        try:
            self.request(
                "POST",
                f"/api/training-workers/agent/jobs/{model_id}/progress",
                json={"progress": 5, "stage": "Loading model checkpoint", "metrics": {}},
                timeout=15,
            )
        except requests.RequestException:
            pass
        initial_checkpoint: str = config["architecture"]
        if resume:
            initial_checkpoint = str(last_checkpoint)
        elif job.get("recoveryUrl"):
            recovery = job_dir / "recovery-best.pt"
            print("[worker] last.pt unavailable; recovering from best.pt with a fresh optimizer", flush=True)
            self.download_checkpoint(job["recoveryUrl"], recovery)
            initial_checkpoint = str(recovery)
        elif job.get("baseWeightsUrl"):
            fine_tune_base = job_dir / "fine-tune-base.pt"
            print("[worker] downloading fine-tune base best.pt", flush=True)
            self.download_checkpoint(job["baseWeightsUrl"], fine_tune_base)
            initial_checkpoint = str(fine_tune_base)
        model = YOLO(initial_checkpoint)
        cancelled = False
        current_batch = 0
        last_batch_report = 0.0

        def upload_progress(
            trainer: Any,
            stage: str,
            metrics: dict[str, float] | None = None,
            force: bool = False,
        ) -> None:
            nonlocal cancelled, last_batch_report
            timestamp = time.monotonic()
            if not force and timestamp - last_batch_report < 2:
                return
            # Check cancellation before posting progress: the server intentionally
            # rejects progress after the UI has requested a pause.
            cancelled = self.job_cancelled(model_id)
            if cancelled:
                trainer.stop = True
                return
            epoch = int(trainer.epoch) + 1
            epochs = max(1, int(config["epochs"]))
            total_batches = len(trainer.train_loader)
            progress = min(
                98,
                5 + round(((epoch - 1) + current_batch / max(1, total_batches)) / epochs * 92),
            )
            loss_value = getattr(trainer, "loss", None)
            try:
                loss = float(loss_value.detach().sum().cpu())
            except (AttributeError, TypeError, ValueError):
                loss = None
            self.request(
                "POST",
                f"/api/training-workers/agent/jobs/{model_id}/progress",
                json={
                    "progress": max(5, progress),
                    "epoch": epoch,
                    "total_epochs": epochs,
                    "batch": current_batch,
                    "total_batches": total_batches,
                    "stage": stage,
                    "loss": loss,
                    "metrics": metrics or {},
                },
                timeout=20,
            )
            print(
                f"[worker] {stage} · epoch {epoch}/{epochs} · "
                f"batch {current_batch}/{total_batches}"
                + (f" · loss {loss:.4f}" if loss is not None else ""),
                flush=True,
            )
            last_batch_report = timestamp

        def on_epoch_start(trainer: Any) -> None:
            nonlocal current_batch
            current_batch = 0

        def on_batch_end(trainer: Any) -> None:
            nonlocal current_batch
            current_batch += 1
            try:
                upload_progress(trainer, "Training batches")
            except requests.RequestException as exc:
                print(f"[worker] batch progress will retry: {exc}", flush=True)

        def on_epoch_end(trainer: Any) -> None:
            metrics = {
                key: float(value)
                for key, value in (getattr(trainer, "metrics", {}) or {}).items()
                if isinstance(value, numbers.Real)
            }
            try:
                upload_progress(trainer, "Validating epoch", metrics, force=True)
            except requests.RequestException as exc:
                print(f"[worker] progress upload will retry next epoch: {exc}", flush=True)

        model.add_callback("on_train_epoch_start", on_epoch_start)
        model.add_callback("on_train_batch_end", on_batch_end)
        model.add_callback("on_train_epoch_end", on_epoch_end)
        if resume:
            result = model.train(resume=True, device=device, workers=0, verbose=True)
        else:
            result = model.train(
                data=task_data,
                epochs=int(config["epochs"]),
                imgsz=int(config["image_size"]),
                batch=int(config.get("batch_size", 16)),
                optimizer=config.get("optimizer", "auto"),
                lr0=float(config.get("learning_rate", 0.01)),
                patience=int(config.get("patience", 50)),
                weight_decay=float(config.get("weight_decay", 0.0005)),
                cos_lr=bool(config.get("cos_lr", False)),
                close_mosaic=int(config.get("close_mosaic", 10)),
                amp=bool(config.get("amp", True)),
                freeze=int(config.get("freeze_layers", 0)) or None,
                device=device,
                project=str(job_dir),
                name="run",
                exist_ok=True,
                plots=True,
                save_period=1,
                verbose=True,
                workers=0,
            )
        if cancelled or self.job_cancelled(model_id):
            uploaded = self.upload_recovery_checkpoints(model_id, Path(result.save_dir) / "weights")
            try:
                self.request("POST", f"/api/training-workers/agent/jobs/{model_id}/paused", timeout=30)
            except requests.RequestException as exc:
                print(f"[worker] could not finalize paused state: {exc}", flush=True)
            raise TrainingCancelled(
                "training paused with last.pt checkpoint" if uploaded else "training stopped before a resumable checkpoint was available"
            )
        weights = Path(result.save_dir) / "weights" / "best.pt"
        if not weights.is_file():
            raise RuntimeError("Ultralytics did not produce weights/best.pt")
        metrics = {key: float(value) for key, value in result.results_dict.items() if isinstance(value, numbers.Real)}
        artifacts = [path for path in Path(result.save_dir).iterdir() if path.is_file() and is_evaluation_artifact(path)]
        if artifacts:
            artifact_archive = job_dir / "evaluation-artifacts.zip"
            with zipfile.ZipFile(artifact_archive, "w", zipfile.ZIP_DEFLATED) as archive:
                for artifact in artifacts:
                    archive.write(artifact, artifact.name)
            try:
                with artifact_archive.open("rb") as payload:
                    response = self.request(
                        "POST",
                        f"/api/training-workers/agent/jobs/{model_id}/artifacts",
                        data=payload,
                        headers={"Content-Type": "application/zip"},
                        timeout=600,
                    )
                stored = len(response.json().get("artifacts", []))
                print(f"[worker] uploaded {stored} evaluation artifacts", flush=True)
            except requests.RequestException as exc:
                print(f"[worker] warning: evaluation artifact upload failed: {exc}", flush=True)
        for attempt in range(1, 6):
            try:
                with weights.open("rb") as checkpoint:
                    self.request(
                        "POST",
                        f"/api/training-workers/agent/jobs/{model_id}/complete",
                        data=checkpoint,
                        headers={
                            "Content-Type": "application/octet-stream",
                            "X-VisionFlow-Metrics": json.dumps(metrics, separators=(",", ":")),
                        },
                        timeout=1800,
                    )
                break
            except requests.RequestException:
                if attempt == 5:
                    raise
                time.sleep(attempt * 5)
        print(f"[worker] completed {model_id}; best.pt uploaded to NAS", flush=True)
        if not self.keep_jobs:
            shutil.rmtree(job_dir)

    def report_failure(self, model_id: str, error: Exception) -> None:
        try:
            self.request(
                "POST",
                f"/api/training-workers/agent/jobs/{model_id}/failed",
                json={"error": str(error)[:2000]},
                timeout=30,
            )
        except requests.RequestException as report_error:
            print(f"[worker] could not report failure: {report_error}", flush=True)


def main() -> int:
    args = parse_args()
    worker = VisionFlowWorker(
        args.server,
        args.token,
        Path(args.work_dir),
        args.keep_jobs,
        args.provider,
    )
    hardware = worker.capabilities["gpuName"] or worker.capabilities["cpu"]
    acceleration = (
        f"CUDA {worker.capabilities['cudaVersion']}"
        if worker.capabilities["cuda"]
        else "CPU only (CUDA unavailable)"
    )
    print(
        f"[worker] connecting to {worker.server} with {hardware} | "
        f"PyTorch {worker.capabilities['torchVersion']} | {acceleration}",
        flush=True,
    )
    while True:
        try:
            worker.heartbeat()
            job = worker.claim()
            if not job:
                print("[worker] no matching job", flush=True)
                if args.once:
                    return 0
                time.sleep(args.poll_seconds)
                continue
            try:
                worker.run_job(job)
            except TrainingCancelled as exc:
                print(f"[worker] {exc}", flush=True)
            except Exception as exc:
                print(f"[worker] job failed: {exc}", file=sys.stderr, flush=True)
                worker.upload_recovery_checkpoints(
                    job["id"],
                    worker.work_dir / job["id"] / "run" / "weights",
                )
                worker.report_failure(job["id"], exc)
            if args.once:
                return 0
        except (requests.RequestException, OSError) as exc:
            print(f"[worker] server unavailable: {exc}", file=sys.stderr, flush=True)
            if args.once:
                return 1
            time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
