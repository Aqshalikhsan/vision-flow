"""Finish persistent E2E coverage for official pose and multi-label projects."""
from __future__ import annotations

import argparse
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

import requests

from e2e_remaining_project_types import create_and_annotate, sample_image, train_and_deploy
from e2e_semantic_segmentation_project import authenticated_session, checked


POSE_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/coco8-pose.zip"


def pose_examples(cache: Path) -> list[tuple[str, bytes, list[dict]]]:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.is_file():
        cache.write_bytes(checked(requests.get(POSE_URL, timeout=180)).content)
    examples = []
    with zipfile.ZipFile(cache) as archive:
        images = [name for name in archive.namelist() if "/images/" in name and Path(name).suffix.lower() in {".jpg", ".jpeg", ".png"}]
        images.sort(key=lambda name: ("/val/" in name, name))
        for image_name in images:
            path = Path(image_name)
            label_name = path.with_suffix(".txt").as_posix().replace("/images/", "/labels/")
            boxes = []
            if label_name in archive.namelist():
                for line in archive.read(label_name).decode("utf-8").splitlines():
                    values = [float(value) for value in line.split()]
                    if len(values) < 5 + 17 * 3:
                        continue
                    _, cx, cy, width, height, *raw_points = values
                    points = [
                        {"x": max(0.0, min(100.0, raw_points[index] * 100)),
                         "y": max(0.0, min(100.0, raw_points[index + 1] * 100)),
                         "visibility": raw_points[index + 2]}
                        for index in range(0, 17 * 3, 3)
                    ]
                    x = max(0.0, min(99.999, (cx - width / 2) * 100))
                    y = max(0.0, min(99.999, (cy - height / 2) * 100))
                    box_width = max(0.001, min(width * 100, 100 - x))
                    box_height = max(0.001, min(height * 100, 100 - y))
                    boxes.append({"x": x, "y": y, "w": box_width, "h": box_height, "label": "person",
                                  "type": "keypoint", "points": points})
            examples.append((path.name, archive.read(image_name), boxes))
    if len(examples) != 8 or not any(boxes for _, _, boxes in examples):
        raise RuntimeError("Official COCO8-Pose archive was incomplete")
    return examples


def run(base_url: str, worker_python: Path, epochs: int, credentials: Path, cache: Path) -> dict:
    session = authenticated_session(base_url, credentials)
    suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    examples = pose_examples(cache)
    pose, image = create_and_annotate(session, base_url, f"E2E COCO8 Pose {suffix}",
                                       "Keypoint Detection", ["person"], examples)
    pose_result = train_and_deploy(session, base_url, pose, "yolo11n-pose.pt", image, worker_python, epochs)
    pose_prediction = pose_result["predictions"][0]
    if len(pose_prediction.get("points") or []) != 17:
        raise RuntimeError(f"Pose deployment returned {len(pose_prediction.get('points') or [])} points instead of 17")

    multi_examples = []
    for index in range(12):
        labels = ["red"] + (["striped"] if index % 2 == 0 else [])
        boxes = [{"x": 0, "y": 0, "w": 100, "h": 100, "label": label, "type": "classification"} for label in labels]
        multi_examples.append((f"multi-{index:02}.png", sample_image("multi", index), boxes))
    multi, _ = create_and_annotate(session, base_url, f"E2E Multi Label {suffix}",
                                    "Multi-Label Classification", ["red", "striped"], multi_examples)
    export = checked(session.get(
        f"{base_url}/api/projects/{multi['id']}/versions/{multi['versions'][-1]['id']}/export", timeout=60,
    ))
    with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
        metadata = json.loads(archive.read("classification.json"))
    rejected = session.post(f"{base_url}/api/projects/{multi['id']}/train", json={
        "architecture": "yolo11n-cls.pt", "epochs": epochs, "image_size": 256,
        "version_id": multi["versions"][-1]["id"], "batch_size": 4,
    }, timeout=30)
    result = {"keypoint": pose_result, "multiLabel": {"projectId": multi["id"],
              "exportTask": metadata["task"], "trainingStatus": rejected.status_code,
              "trainingDetail": rejected.json().get("detail", rejected.text)}}
    print("\nE2E_KEYPOINT_MULTILABEL_RESULT=" + json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--worker-python", type=Path, default=Path(r"C:\Users\User\VisionFlowWorker\.venv\Scripts\python.exe"))
    parser.add_argument("--credential-file", type=Path, default=root / ".tmp" / "semantic-e2e-auth.json")
    parser.add_argument("--dataset-cache", type=Path, default=root / ".tmp" / "coco8-pose.zip")
    args = parser.parse_args()
    try:
        run(args.base_url.rstrip("/"), args.worker_python, args.epochs, args.credential_file, args.dataset_cache)
    except Exception as error:
        print(f"E2E KEYPOINT/MULTI-LABEL FAILED: {error}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
