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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO training jobs from a VisionFlow NAS")
    parser.add_argument("--server", default=os.getenv("VISIONFLOW_SERVER", "http://127.0.0.1:8000"))
    parser.add_argument("--token", default=os.getenv("VISIONFLOW_WORKER_TOKEN"))
    parser.add_argument("--work-dir", default=os.getenv("VISIONFLOW_WORK_DIR", "visionflow-worker-data"))
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
    def __init__(self, server: str, token: str, work_dir: Path, keep_jobs: bool):
        self.server = server.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.work_dir = work_dir.resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.keep_jobs = keep_jobs
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        self.capabilities = {
            "cuda": torch.cuda.is_available(),
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "",
            "cpu": platform.processor() or platform.machine(),
            "platform": f"{platform.system()} {platform.release()}",
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

    def download_dataset(self, job: dict[str, Any], destination: Path) -> Path:
        archive = destination / "dataset.zip"
        with self.request("GET", job["datasetUrl"], stream=True, timeout=300) as response, archive.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
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
        resume = last_checkpoint.is_file() and (job_dir / "dataset").is_dir()
        if job_dir.exists() and not resume:
            shutil.rmtree(job_dir)
        job_dir.mkdir(parents=True, exist_ok=True)
        action = "resuming" if resume else "claimed"
        print(f"[worker] {action} {model_id}: {job['projectName']} v{job['version']}", flush=True)
        dataset = job_dir / "dataset" if resume else self.download_dataset(job, job_dir)
        target = config.get("execution_target", "remote-auto")
        if target == "remote-gpu":
            if not self.capabilities["cuda"]:
                raise RuntimeError("job requires CUDA but this laptop has no available CUDA device")
            device: str | int = 0
        elif target == "remote-cpu":
            device = "cpu"
        else:
            device = 0 if self.capabilities["cuda"] else "cpu"
        task_data: str = str(dataset if "Classification" in job["projectType"] else dataset / "data.yaml")
        model = YOLO(str(last_checkpoint) if resume else config["architecture"])
        cancelled = False

        def on_epoch_end(trainer: Any) -> None:
            nonlocal cancelled
            epoch = int(trainer.epoch) + 1
            epochs = max(1, int(config["epochs"]))
            progress = min(98, 5 + round(epoch / epochs * 92))
            metrics = {
                key: float(value)
                for key, value in (getattr(trainer, "metrics", {}) or {}).items()
                if isinstance(value, numbers.Real)
            }
            try:
                self.request(
                    "POST",
                    f"/api/training-workers/agent/jobs/{model_id}/progress",
                    json={"progress": progress, "epoch": epoch, "metrics": metrics},
                    timeout=20,
                )
                cancelled = self.job_cancelled(model_id)
                if cancelled:
                    trainer.stop = True
            except requests.RequestException as exc:
                print(f"[worker] progress upload will retry next epoch: {exc}", flush=True)

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
                device=device,
                project=str(job_dir),
                name="run",
                exist_ok=True,
                plots=True,
                verbose=True,
                workers=0,
            )
        if cancelled or self.job_cancelled(model_id):
            raise TrainingCancelled("job cancelled from VisionFlow")
        weights = Path(result.save_dir) / "weights" / "best.pt"
        if not weights.is_file():
            raise RuntimeError("Ultralytics did not produce weights/best.pt")
        metrics = {key: float(value) for key, value in result.results_dict.items() if isinstance(value, numbers.Real)}
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
    worker = VisionFlowWorker(args.server, args.token, Path(args.work_dir), args.keep_jobs)
    hardware = worker.capabilities["gpuName"] or worker.capabilities["cpu"]
    print(f"[worker] connecting to {worker.server} with {hardware}", flush=True)
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
