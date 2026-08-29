"""Run a persistent, real semantic-segmentation E2E validation in Salnova.

The project intentionally stays in the workspace after the test so it can be
inspected from the dashboard. A tiny official COCO8-Seg archive is imported,
trained on an external CUDA worker, promoted to production, and exercised via
the deployment API with a real image and polygon result.
"""
from __future__ import annotations

import argparse
import io
import json
import secrets
import subprocess
import sys
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path

import requests


DATASET_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/coco8-seg.zip"
COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli",
    "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
    "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]


def checked(response: requests.Response) -> requests.Response:
    if response.ok:
        return response
    try:
        detail = response.json()
    except ValueError:
        detail = response.text[:1000]
    raise RuntimeError(
        f"{response.status_code} {response.request.method} {response.url}: {detail}"
    )


def authenticated_session(base_url: str, credential_path: Path) -> requests.Session:
    credential_path.parent.mkdir(parents=True, exist_ok=True)
    if credential_path.is_file():
        credentials = json.loads(credential_path.read_text(encoding="utf-8"))
    else:
        credentials = {
            "name": "salnova-semantic-e2e",
            "email": "salnova.semantic.e2e@gmail.com",
            "password": secrets.token_urlsafe(24),
        }
        credential_path.write_text(json.dumps(credentials), encoding="utf-8")
    session = requests.Session()
    login = session.post(
        f"{base_url}/api/auth/login",
        json={"email": credentials["email"], "password": credentials["password"]},
        timeout=30,
    )
    if login.status_code == 401:
        register = session.post(
            f"{base_url}/api/auth/register", json=credentials, timeout=30
        )
        if register.status_code == 409:
            raise RuntimeError(
                "The persistent E2E account exists but its local credential file does not match"
            )
        checked(register)
    else:
        checked(login)
    checked(session.get(f"{base_url}/api/auth/me", timeout=20))
    print("[auth] authenticated isolated E2E account", flush=True)
    return session


def dataset_archive(cache_path: Path) -> bytes:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if not cache_path.is_file():
        print(f"[dataset] downloading {DATASET_URL}", flush=True)
        response = checked(requests.get(DATASET_URL, timeout=180))
        cache_path.write_bytes(response.content)
    source_bytes = cache_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as source:
        normalized = io.BytesIO()
        yaml = (
            "path: .\n"
            "train: coco8-seg/images/train\n"
            "val: coco8-seg/images/val\n"
            "names:\n"
            + "".join(f"  {index}: {name}\n" for index, name in enumerate(COCO_NAMES))
        )
        with zipfile.ZipFile(normalized, "w", zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                if not item.is_dir():
                    target.writestr(item.filename, source.read(item))
            target.writestr("data.yaml", yaml)
    print(f"[dataset] archive ready · {len(source_bytes) / 1024:.1f} KiB", flush=True)
    return normalized.getvalue()


def inference_images(archive_bytes: bytes) -> list[tuple[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = [
            name
            for name in archive.namelist()
            if "/images/val/" in name
            and name.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        return [(Path(name).name, archive.read(name)) for name in names]


def stream_worker_output(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        encoding = sys.stdout.encoding or "utf-8"
        safe_line = line.rstrip().encode(encoding, errors="replace").decode(encoding)
        print(safe_line, flush=True)


def wait_for_worker(
    session: requests.Session, base_url: str, worker_id: str, timeout: int = 120
) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        workers = checked(session.get(f"{base_url}/api/training-workers", timeout=20)).json()
        worker = next((item for item in workers if item["id"] == worker_id), None)
        if worker and worker["status"] in {"online", "busy"}:
            if not worker.get("capabilities", {}).get("cuda"):
                raise RuntimeError(f"Worker is online without CUDA: {worker['capabilities']}")
            print(
                f"[worker] online · {worker['capabilities'].get('gpuName')} · CUDA ready",
                flush=True,
            )
            return worker
        time.sleep(2)
    raise TimeoutError("CUDA worker did not become online")


def wait_for_training(
    session: requests.Session,
    base_url: str,
    project_id: str,
    model_id: str,
    timeout: int,
) -> dict:
    deadline = time.monotonic() + timeout
    previous = ""
    while time.monotonic() < deadline:
        project = checked(
            session.get(f"{base_url}/api/projects/{project_id}", timeout=30)
        ).json()
        model = next(item for item in project["models"] if item["id"] == model_id)
        detail = model.get("trainingDetail") or {}
        message = f"[training] {model['status']} {model['progress']}% · {detail.get('stage', 'waiting')}"
        if detail.get("epoch") is not None:
            message += f" · epoch {detail['epoch']}/{detail.get('totalEpochs', '?')}"
        if detail.get("batch") is not None:
            message += f" · batch {detail['batch']}/{detail.get('totalBatches', '?')}"
        if detail.get("loss") is not None:
            message += f" · loss {detail['loss']:.4f}"
        if message != previous:
            print(message, flush=True)
            previous = message
        if model["status"] == "ready":
            return model
        if model["status"] in {"failed", "cancelled", "paused"}:
            raise RuntimeError(f"Training ended as {model['status']}: {model.get('error')}")
        time.sleep(2)
    raise TimeoutError("Segmentation training exceeded the configured timeout")


def run(
    base_url: str,
    epochs: int,
    timeout_minutes: int,
    cache_path: Path,
    credential_path: Path,
    worker_python: Path,
) -> dict:
    started = time.monotonic()
    session = authenticated_session(base_url, credential_path)
    health = checked(session.get(f"{base_url}/api/health", timeout=20)).json()
    if not health.get("mlReady"):
        raise RuntimeError("Backend reports that the ML runtime is not ready")
    archive_bytes = dataset_archive(cache_path)
    samples = inference_images(archive_bytes)
    if not samples:
        raise RuntimeError("COCO8-Seg validation images were not found")

    suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    project = checked(
        session.post(
            f"{base_url}/api/projects",
            json={
                "name": f"E2E COCO8 Semantic Segmentation {suffix}",
                "type": "Semantic Segmentation",
                "description": "Persistent GPU E2E validation using official Ultralytics COCO8-Seg polygons.",
                "classes": ["object"],
            },
            timeout=30,
        )
    ).json()
    project_id = project["id"]
    print(f"[project] created {project_id} · {project['name']}", flush=True)

    project = checked(
        session.post(
            f"{base_url}/api/projects/{project_id}/import/yolo",
            files={"file": ("coco8-seg-salnova.zip", archive_bytes, "application/zip")},
            timeout=180,
        )
    ).json()
    polygons = [
        annotation
        for asset in project["assets"]
        for annotation in asset["boxes"]
        if annotation.get("type") == "polygon" and len(annotation.get("points") or []) >= 3
    ]
    if len(project["assets"]) != 8 or not polygons:
        raise RuntimeError(
            f"Import incomplete: {len(project['assets'])} images, {len(polygons)} polygons"
        )
    print(
        f"[dataset] imported 8 images · {len(polygons)} polygons · {len(project['classes'])} classes",
        flush=True,
    )

    project = checked(
        session.post(
            f"{base_url}/api/projects/{project_id}/versions",
            json={"resize": 640, "augment": False, "splits": [50, 50, 0]},
            timeout=180,
        )
    ).json()
    version_id = project["versions"][-1]["id"]
    print(f"[version] immutable dataset v1 ready · {version_id}", flush=True)

    worker_record = checked(
        session.post(
            f"{base_url}/api/training-workers",
            json={"name": f"E2E RTX Worker {suffix}"},
            timeout=30,
        )
    ).json()
    worker_id = worker_record["id"]
    worker_token = worker_record["token"]
    project = checked(
        session.post(
            f"{base_url}/api/projects/{project_id}/train",
            json={
                "architecture": "yolo11n-seg.pt",
                "epochs": epochs,
                "image_size": 640,
                "version_id": version_id,
                "batch_size": 4,
                "optimizer": "AdamW",
                "learning_rate": 0.001,
                "patience": max(epochs, 10),
                "device": "auto",
                "execution_target": "remote-gpu",
                "worker_id": worker_id,
                "freeze_layers": 0,
                "weight_decay": 0.0005,
                "cos_lr": True,
                "close_mosaic": min(5, epochs),
                "amp": True,
            },
            timeout=30,
        )
    ).json()
    model_id = project["models"][-1]["id"]
    print(f"[training] queued {model_id} · YOLO11n-seg · {epochs} epochs", flush=True)
    work_dir = Path(__file__).resolve().parent.parent / ".runtime" / "e2e-semantic-worker"
    command = [
        str(worker_python),
        str(Path(__file__).resolve().parent.parent / "worker" / "visionflow_worker.py"),
        "--server",
        base_url,
        "--token",
        worker_token,
        "--work-dir",
        str(work_dir),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output_thread = threading.Thread(
        target=stream_worker_output, args=(process,), daemon=True
    )
    output_thread.start()
    try:
        wait_for_worker(session, base_url, worker_id)
        elapsed = int(time.monotonic() - started)
        model = wait_for_training(
            session,
            base_url,
            project_id,
            model_id,
            max(60, timeout_minutes * 60 - elapsed),
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        output_thread.join(timeout=3)

    if not model.get("deployable"):
        raise RuntimeError("Training completed without a deployable best.pt")
    print(
        f"[model] best.pt ready · mAP50 {model['map']}% · precision {model['precision']}% · recall {model['recall']}%",
        flush=True,
    )
    project = checked(
        session.put(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/lifecycle",
            json={"stage": "production", "alias": "coco8-semantic-production"},
            timeout=30,
        )
    ).json()
    production = next(item for item in project["models"] if item["id"] == model_id)
    if production.get("stage") != "production":
        raise RuntimeError("Production promotion was not persisted")
    print("[deploy] model promoted to production", flush=True)

    deployment_key = checked(
        session.post(
            f"{base_url}/api/projects/{project_id}/deployment/keys",
            json={"name": "Semantic E2E client"},
            timeout=30,
        )
    ).json()
    inference = None
    inference_name = ""
    for name, image_bytes in samples:
        result = checked(
            requests.post(
                f"{base_url}/api/deploy/{project_id}/infer?confidence=0.05",
                headers={"X-API-Key": deployment_key["key"]},
                files={"file": (name, image_bytes, "image/jpeg")},
                timeout=180,
            )
        ).json()
        masked = [
            prediction
            for prediction in result.get("predictions", [])
            if len(prediction.get("points") or []) >= 3
        ]
        if masked:
            inference = result
            inference_name = name
            break
    if not inference:
        raise RuntimeError("Deployment produced no polygon mask on validation images")
    first_mask = next(
        prediction
        for prediction in inference["predictions"]
        if len(prediction.get("points") or []) >= 3
    )
    print(
        f"[inference] SEGMENTED {first_mask['class']} · confidence {first_mask['confidence']:.1%} · {len(first_mask['points'])} polygon points",
        flush=True,
    )

    weights = checked(
        session.get(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/weights",
            timeout=300,
        )
    ).content
    metrics = checked(
        session.get(f"{base_url}/api/projects/{project_id}/deployment/metrics", timeout=30)
    ).json()
    if len(weights) < 1_000_000 or metrics.get("requests", 0) < 1:
        raise RuntimeError("Deployment artifacts or metrics are incomplete")
    evaluation_artifacts = checked(
        session.get(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/evaluation",
            timeout=30,
        )
    ).json()
    artifact_names = {artifact["name"] for artifact in evaluation_artifacts}
    if not {"results.png", "confusion_matrix.png", "BoxPR_curve.png", "MaskPR_curve.png"}.issubset(artifact_names):
        raise RuntimeError(f"Remote evaluation artifacts are incomplete: {sorted(artifact_names)}")
    preview = checked(
        session.get(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/evaluation/results.png",
            timeout=30,
        )
    )
    if len(preview.content) < 1024:
        raise RuntimeError("Evaluation artifact download returned an invalid file")
    print(f"[evaluation] {len(evaluation_artifacts)} plots/config files available for preview and download", flush=True)
    summary = {
        "status": "passed",
        "projectId": project_id,
        "projectUrl": f"/#/projects/{project_id}/deploy",
        "modelId": model_id,
        "dataset": {
            "source": DATASET_URL,
            "images": len(project["assets"]),
            "polygons": len(polygons),
        },
        "training": {
            "epochs": epochs,
            "map50Percent": model["map"],
            "precisionPercent": model["precision"],
            "recallPercent": model["recall"],
            "bestPtBytes": len(weights),
        },
        "inference": {
            "image": inference_name,
            "predictionCount": len(inference["predictions"]),
            "firstMask": first_mask,
        },
        "deploymentMetrics": metrics,
        "evaluationArtifacts": len(evaluation_artifacts),
        "elapsedSeconds": round(time.monotonic() - started, 1),
    }
    print("\nE2E_RESULT=" + json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--timeout-minutes", type=int, default=45)
    parser.add_argument(
        "--dataset-cache", type=Path, default=root / ".tmp" / "coco8-seg.zip"
    )
    parser.add_argument(
        "--credential-file", type=Path, default=root / ".tmp" / "semantic-e2e-auth.json"
    )
    parser.add_argument(
        "--worker-python",
        type=Path,
        default=Path(r"C:\Users\User\VisionFlowWorker\.venv\Scripts\python.exe"),
    )
    args = parser.parse_args()
    if not args.worker_python.is_file():
        print(f"E2E FAILED: CUDA worker Python not found: {args.worker_python}", file=sys.stderr)
        return 1
    try:
        run(
            args.base_url.rstrip("/"),
            args.epochs,
            args.timeout_minutes,
            args.dataset_cache,
            args.credential_file,
            args.worker_python,
        )
    except Exception as error:
        print(f"E2E FAILED: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
