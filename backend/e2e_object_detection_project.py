"""Create and verify a persistent VisionFlow object-detection project end to end.

The script downloads the official Ultralytics COCO8 dataset, imports its real
bounding-box annotations, creates an immutable version, trains a small YOLO
model, promotes best.pt to production, and requires a real deployed inference.

Usage:
    python backend/e2e_object_detection_project.py --base-url http://127.0.0.1:8002
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path

import requests


DATASET_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/coco8.zip"
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
    if not response.ok:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:1000]
        raise RuntimeError(
            f"{response.status_code} {response.request.method} {response.url}: {detail}"
        )
    return response


def dataset_archive(cache_path: Path) -> bytes:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if not cache_path.is_file():
        print(f"[dataset] downloading {DATASET_URL}", flush=True)
        response = checked(requests.get(DATASET_URL, timeout=120))
        cache_path.write_bytes(response.content)
    source_bytes = cache_path.read_bytes()
    source = zipfile.ZipFile(io.BytesIO(source_bytes))
    normalized = io.BytesIO()
    yaml = "path: .\ntrain: coco8/images/train\nval: coco8/images/val\nnames:\n" + "".join(
        f"  {index}: {name}\n" for index, name in enumerate(COCO_NAMES)
    )
    with zipfile.ZipFile(normalized, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            if not item.is_dir():
                target.writestr(item.filename, source.read(item))
        target.writestr("data.yaml", yaml)
    return normalized.getvalue()


def find_inference_images(archive_bytes: bytes) -> list[tuple[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        candidates = [
            name
            for name in archive.namelist()
            if "/images/val/" in name and name.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        return [(Path(name).name, archive.read(name)) for name in candidates]


def wait_for_training(
    base_url: str,
    project_id: str,
    model_id: str,
    timeout_seconds: int,
) -> dict:
    deadline = time.monotonic() + timeout_seconds
    last_message = ""
    while time.monotonic() < deadline:
        project = checked(requests.get(f"{base_url}/api/projects/{project_id}", timeout=20)).json()
        model = next(item for item in project["models"] if item["id"] == model_id)
        detail = model.get("trainingDetail") or {}
        message = (
            f"[training] {model['status']} {model['progress']}% · "
            f"{detail.get('stage', 'waiting')}"
        )
        if detail.get("epoch") is not None:
            message += f" · epoch {detail['epoch']}/{detail.get('totalEpochs', '?')}"
        if detail.get("batch") is not None:
            message += f" · batch {detail['batch']}/{detail.get('totalBatches', '?')}"
        if detail.get("loss") is not None:
            message += f" · loss {detail['loss']:.4f}"
        if message != last_message:
            print(message, flush=True)
            last_message = message
        if model["status"] == "ready":
            return model
        if model["status"] in {"failed", "cancelled", "paused"}:
            raise RuntimeError(f"Training ended as {model['status']}: {model.get('error')}")
        time.sleep(2)
    raise TimeoutError(f"Training exceeded the {timeout_seconds // 60}-minute limit")


def run(base_url: str, timeout_minutes: int, epochs: int, cache_path: Path) -> dict:
    started = time.monotonic()
    health = checked(requests.get(f"{base_url}/api/health", timeout=10)).json()
    if not health.get("mlReady"):
        raise RuntimeError("Backend reports that the ML runtime is not ready")

    archive_bytes = dataset_archive(cache_path)
    inference_images = find_inference_images(archive_bytes)
    if not inference_images:
        raise RuntimeError("COCO8 validation images were not found")

    suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    project = checked(
        requests.post(
            f"{base_url}/api/projects",
            json={
                "name": f"E2E COCO8 Detection {suffix}",
                "type": "Object Detection",
                "description": "Persistent real-object E2E validation using official Ultralytics COCO8.",
                "classes": ["object"],
            },
            timeout=20,
        )
    ).json()
    project_id = project["id"]
    print(f"[project] created {project_id} · {project['name']}", flush=True)

    project = checked(
        requests.post(
            f"{base_url}/api/projects/{project_id}/import/yolo",
            files={"file": ("coco8-visionflow.zip", archive_bytes, "application/zip")},
            timeout=120,
        )
    ).json()
    box_count = sum(len(asset["boxes"]) for asset in project["assets"])
    if len(project["assets"]) != 8 or box_count == 0:
        raise RuntimeError(
            f"Dataset import is incomplete: {len(project['assets'])} images, {box_count} boxes"
        )
    print(
        f"[dataset] imported 8 real images · {box_count} bounding boxes · {len(project['classes'])} classes",
        flush=True,
    )

    project = checked(
        requests.post(
            f"{base_url}/api/projects/{project_id}/versions",
            json={"resize": 640, "augment": False, "splits": [50, 50, 0]},
            timeout=120,
        )
    ).json()
    version_id = project["versions"][-1]["id"]
    print(f"[version] immutable dataset v1 created · {version_id}", flush=True)

    project = checked(
        requests.post(
            f"{base_url}/api/projects/{project_id}/train",
            json={
                "architecture": "yolo11s.pt",
                "epochs": epochs,
                "image_size": 640,
                "version_id": version_id,
                "batch_size": 4,
                "optimizer": "AdamW",
                "learning_rate": 0.001,
                "patience": 12,
                "device": "cpu",
                "execution_target": "server",
                "freeze_layers": 10,
                "weight_decay": 0.0005,
                "cos_lr": True,
                "close_mosaic": 5,
                "amp": False,
            },
            timeout=30,
        )
    ).json()
    model_id = project["models"][-1]["id"]
    print(f"[training] queued {model_id} · YOLO11s · {epochs} epochs", flush=True)
    elapsed = int(time.monotonic() - started)
    model = wait_for_training(
        base_url,
        project_id,
        model_id,
        max(60, timeout_minutes * 60 - elapsed),
    )
    if not model.get("deployable"):
        raise RuntimeError("Training finished but best.pt is not deployable")
    print(
        f"[model] best.pt ready · mAP50 {model['map']}% · precision {model['precision']}% · recall {model['recall']}%",
        flush=True,
    )

    project = checked(
        requests.put(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/lifecycle",
            json={"stage": "production", "alias": "coco8-e2e-production"},
            timeout=20,
        )
    ).json()
    production = next(item for item in project["models"] if item["id"] == model_id)
    if production["stage"] != "production":
        raise RuntimeError("Model promotion to production did not persist")
    print("[deploy] model promoted to production", flush=True)

    deployment_key = checked(
        requests.post(
            f"{base_url}/api/projects/{project_id}/deployment/keys",
            json={"name": "E2E validation client"},
            timeout=20,
        )
    ).json()
    inference = None
    inference_name = ""
    for name, image_bytes in inference_images:
        result = checked(
            requests.post(
                f"{base_url}/api/deploy/{project_id}/infer?confidence=0.10",
                headers={"X-API-Key": deployment_key["key"]},
                files={"file": (name, image_bytes, "image/jpeg")},
                timeout=180,
            )
        ).json()
        if result.get("predictions"):
            inference, inference_name = result, name
            break
    if not inference:
        raise RuntimeError("Deployment returned no detected object on all COCO8 validation images")
    detected = inference["predictions"][0]
    required = {"x1", "y1", "x2", "y2", "confidence", "class"}
    if not required.issubset(detected):
        raise RuntimeError(f"Inference prediction has incomplete object data: {detected}")
    print(
        f"[inference] DETECTED {detected['class']} · confidence {detected['confidence']:.1%} · "
        f"box ({detected['x1']:.0f}, {detected['y1']:.0f})–({detected['x2']:.0f}, {detected['y2']:.0f})",
        flush=True,
    )

    metrics = checked(
        requests.get(f"{base_url}/api/projects/{project_id}/deployment/metrics", timeout=20)
    ).json()
    if metrics["requests"] < 1 or metrics["errors"]:
        raise RuntimeError(f"Deployment metrics are inconsistent: {metrics}")
    weights = checked(
        requests.get(
            f"{base_url}/api/projects/{project_id}/models/{model_id}/weights",
            timeout=300,
        )
    ).content
    if len(weights) < 1_000_000:
        raise RuntimeError("Downloaded best.pt is unexpectedly small")

    summary = {
        "status": "passed",
        "projectId": project_id,
        "projectUrl": f"/#/projects/{project_id}/deploy",
        "modelId": model_id,
        "dataset": {"source": DATASET_URL, "images": 8, "boxes": box_count},
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
            "firstObject": detected,
        },
        "deploymentMetrics": metrics,
        "elapsedSeconds": round(time.monotonic() - started, 1),
    }
    print("\nE2E_RESULT=" + json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout-minutes", type=int, default=60)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument(
        "--dataset-cache",
        type=Path,
        default=Path(__file__).resolve().parent.parent / ".tmp" / "coco8.zip",
    )
    args = parser.parse_args()
    try:
        run(args.base_url.rstrip("/"), args.timeout_minutes, args.epochs, args.dataset_cache)
    except Exception as exc:
        print(f"E2E FAILED: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
