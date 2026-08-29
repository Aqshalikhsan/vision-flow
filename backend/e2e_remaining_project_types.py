"""Persistent E2E coverage for Salnova project types outside detection/segmentation."""
from __future__ import annotations

import argparse
import io
import json
import math
import subprocess
import sys
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path

import requests
from PIL import Image, ImageDraw

from e2e_semantic_segmentation_project import (
    authenticated_session,
    checked,
    stream_worker_output,
    wait_for_training,
    wait_for_worker,
)


def sample_image(kind: str, index: int, size: int = 256) -> bytes:
    image = Image.new("RGB", (size, size), (242, 245, 249))
    draw = ImageDraw.Draw(image)
    if kind == "circle":
        draw.ellipse((55, 55, 201, 201), fill=(225, 54 + index % 30, 65), outline=(80, 20, 20), width=7)
    elif kind == "square":
        draw.rectangle((55, 55, 201, 201), fill=(45, 115, 230), outline=(15, 40, 90), width=7)
    elif kind == "obb-horizontal":
        draw.polygon([(38, 92), (218, 92), (218, 164), (38, 164)], fill=(237, 164, 45), outline=(80, 50, 5))
    elif kind == "obb-diagonal":
        draw.polygon([(75, 42), (221, 126), (181, 214), (35, 130)], fill=(61, 183, 126), outline=(15, 70, 45))
    elif kind == "pose":
        offset = (index % 3 - 1) * 5
        points = [(128 + offset, 45), (128, 85), (86, 120), (170, 120), (128, 180)]
        draw.line([points[0], points[1], points[2]], fill=(25, 65, 160), width=10)
        draw.line([points[1], points[3]], fill=(25, 65, 160), width=10)
        draw.line([points[1], points[4]], fill=(25, 65, 160), width=10)
        for x, y in points:
            draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(240, 70, 80))
    elif kind == "multi":
        draw.rectangle((35, 45, 221, 211), fill=(220, 55, 65), outline=(70, 15, 20), width=5)
        if index % 2 == 0:
            for x in range(45, 220, 24):
                draw.line((x, 50, x, 206), fill=(255, 230, 80), width=8)
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def create_and_annotate(
    session: requests.Session,
    base_url: str,
    name: str,
    project_type: str,
    classes: list[str],
    examples: list[tuple[str, bytes, list[dict]]],
) -> tuple[dict, bytes]:
    project = checked(session.post(f"{base_url}/api/projects", json={
        "name": name, "type": project_type,
        "description": f"Persistent E2E validation for {project_type}.", "classes": classes,
    }, timeout=30)).json()
    project_id = project["id"]
    files = [("files", (filename, payload, "image/png")) for filename, payload, _ in examples]
    project = checked(session.post(f"{base_url}/api/projects/{project_id}/assets", files=files, timeout=120)).json()
    annotations = {filename: boxes for filename, _, boxes in examples}
    inference_image = examples[-1][1]
    for index, asset in enumerate(project["assets"]):
        boxes = annotations[asset["name"]]
        checked(session.put(
            f"{base_url}/api/projects/{project_id}/assets/{asset['id']}/annotations",
            json={"boxes": boxes}, timeout=30,
        ))
        split = "valid" if index >= len(examples) - 4 else "train"
        checked(session.put(
            f"{base_url}/api/projects/{project_id}/assets/{asset['id']}/split",
            json={"split": split}, timeout=30,
        ))
    project = checked(session.post(
        f"{base_url}/api/projects/{project_id}/versions",
        json={"resize": 256, "augment": False, "splits": [67, 33, 0]}, timeout=180,
    )).json()
    print(f"[{project_type}] project, {len(project['assets'])} annotations, and v1 ready", flush=True)
    return project, inference_image


def train_and_deploy(
    session: requests.Session, base_url: str, project: dict, architecture: str,
    image: bytes, worker_python: Path, epochs: int,
) -> dict:
    project_id = project["id"]
    worker = checked(session.post(f"{base_url}/api/training-workers", json={
        "name": f"E2E {project['type']} Worker"
    }, timeout=30)).json()
    worker_id = worker["id"]
    version_id = project["versions"][-1]["id"]
    project = checked(session.post(f"{base_url}/api/projects/{project_id}/train", json={
        "architecture": architecture, "epochs": epochs, "image_size": 256,
        "version_id": version_id, "batch_size": 4, "optimizer": "AdamW",
        "learning_rate": 0.001, "patience": max(epochs, 5), "device": "auto",
        "execution_target": "remote-gpu", "worker_id": worker_id,
        "freeze_layers": 0, "weight_decay": 0.0005, "cos_lr": True,
        "close_mosaic": min(2, epochs), "amp": True,
    }, timeout=30)).json()
    model_id = project["models"][-1]["id"]
    command = [str(worker_python), str(Path(__file__).resolve().parent.parent / "worker" / "visionflow_worker.py"),
               "--server", base_url, "--token", worker["token"], "--work-dir",
               str(Path(__file__).resolve().parent.parent / ".runtime" / "e2e-all-types-worker")]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace")
    output_thread = threading.Thread(target=stream_worker_output, args=(process,), daemon=True)
    output_thread.start()
    try:
        wait_for_worker(session, base_url, worker_id)
        model = wait_for_training(session, base_url, project_id, model_id, 30 * 60)
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        output_thread.join(timeout=3)
        session.delete(f"{base_url}/api/training-workers/{worker_id}", timeout=30)
    if not model.get("deployable"):
        raise RuntimeError(f"{project['type']} produced no deployable checkpoint")
    project = checked(session.put(
        f"{base_url}/api/projects/{project_id}/models/{model_id}/lifecycle",
        json={"stage": "production", "alias": f"e2e-{project['type'].lower().replace(' ', '-')}-production"}, timeout=30,
    )).json()
    key = checked(session.post(f"{base_url}/api/projects/{project_id}/deployment/keys",
                               json={"name": "E2E client"}, timeout=30)).json()["key"]
    inference = checked(requests.post(
        f"{base_url}/api/deploy/{project_id}/infer?confidence=0.05",
        headers={"X-API-Key": key}, files={"file": ("sample.png", image, "image/png")}, timeout=180,
    )).json()
    if not inference.get("predictions"):
        raise RuntimeError(f"{project['type']} deployment returned no predictions")
    artifacts = checked(session.get(
        f"{base_url}/api/projects/{project_id}/models/{model_id}/evaluation", timeout=30,
    )).json()
    print(f"[{project['type']}] deploy passed, {len(inference['predictions'])} predictions, {len(artifacts)} artifacts", flush=True)
    return {"projectId": project_id, "modelId": model_id, "mapOrAccuracy": model["map"],
            "predictions": inference["predictions"], "artifacts": len(artifacts)}


def run(base_url: str, worker_python: Path, epochs: int, credential_file: Path) -> dict:
    session = authenticated_session(base_url, credential_file)
    suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    results: dict[str, dict] = {}

    single_examples = []
    for i in range(12):
        label = "circle" if i % 2 == 0 else "square"
        single_examples.append((f"{label}-{i:02}.png", sample_image(label, i), [
            {"x": 0, "y": 0, "w": 100, "h": 100, "label": label, "type": "classification"}
        ]))
    single, image = create_and_annotate(session, base_url, f"E2E Single Label {suffix}",
                                         "Single-Label Classification", ["circle", "square"], single_examples)
    results["singleLabel"] = train_and_deploy(session, base_url, single, "yolo11n-cls.pt", image, worker_python, epochs)

    obb_examples = []
    for i in range(12):
        diagonal = i % 2 == 1
        label = "diagonal" if diagonal else "horizontal"
        points = ([{"x": 29.3, "y": 16.4}, {"x": 86.3, "y": 49.2}, {"x": 70.7, "y": 83.6}, {"x": 13.7, "y": 50.8}]
                  if diagonal else [{"x": 14.8, "y": 35.9}, {"x": 85.2, "y": 35.9}, {"x": 85.2, "y": 64.1}, {"x": 14.8, "y": 64.1}])
        xs, ys = [p["x"] for p in points], [p["y"] for p in points]
        obb_examples.append((f"obb-{label}-{i:02}.png", sample_image(f"obb-{label}", i), [
            {"x": min(xs), "y": min(ys), "w": max(xs)-min(xs), "h": max(ys)-min(ys),
             "label": label, "type": "obb", "points": points}
        ]))
    obb, image = create_and_annotate(session, base_url, f"E2E OBB {suffix}", "Oriented Bounding Box",
                                      ["horizontal", "diagonal"], obb_examples)
    results["obb"] = train_and_deploy(session, base_url, obb, "yolo11n-obb.pt", image, worker_python, epochs)

    # A tiny stick-figure dataset is not representative enough to validate a
    # pretrained 17-point pose model. Reuse the official COCO8-Pose fixture so
    # this all-types harness exercises a real schema and real inference.
    from e2e_keypoint_multilabel import pose_examples

    official_pose_examples = pose_examples(Path(__file__).resolve().parent.parent / ".tmp" / "coco8-pose.zip")
    pose, image = create_and_annotate(session, base_url, f"E2E COCO8 Pose {suffix}", "Keypoint Detection",
                                       ["person"], official_pose_examples)
    results["keypoint"] = train_and_deploy(
        session, base_url, pose, "yolo11n-pose.pt", image, worker_python, min(epochs, 10)
    )

    multi_examples = []
    for i in range(12):
        labels = ["red"] + (["striped"] if i % 2 == 0 else [])
        boxes = [{"x": 0, "y": 0, "w": 100, "h": 100, "label": label, "type": "classification"} for label in labels]
        multi_examples.append((f"multi-{i:02}.png", sample_image("multi", i), boxes))
    multi, _ = create_and_annotate(session, base_url, f"E2E Multi Label {suffix}",
                                    "Multi-Label Classification", ["red", "striped"], multi_examples)
    export = checked(session.get(
        f"{base_url}/api/projects/{multi['id']}/versions/{multi['versions'][-1]['id']}/export", timeout=60,
    ))
    with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
        if "classification.json" not in archive.namelist():
            raise RuntimeError("Multi-label export is missing classification metadata")
    rejected = session.post(f"{base_url}/api/projects/{multi['id']}/train", json={
        "architecture": "yolo11n-cls.pt", "epochs": epochs, "image_size": 256,
        "version_id": multi["versions"][-1]["id"], "batch_size": 4,
    }, timeout=30)
    results["multiLabel"] = {"projectId": multi["id"], "versionExport": "passed",
                              "trainingStatus": rejected.status_code,
                              "trainingDetail": rejected.json().get("detail", rejected.text)}
    print("[Multi-Label Classification] annotation/version/export passed; training capability audited", flush=True)
    print("\nE2E_ALL_TYPES_RESULT=" + json.dumps(results, ensure_ascii=False), flush=True)
    return results


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--worker-python", type=Path, default=Path(r"C:\Users\User\VisionFlowWorker\.venv\Scripts\python.exe"))
    parser.add_argument("--credential-file", type=Path, default=root / ".tmp" / "semantic-e2e-auth.json")
    args = parser.parse_args()
    try:
        run(args.base_url.rstrip("/"), args.worker_python, args.epochs, args.credential_file)
    except Exception as error:
        print(f"E2E ALL TYPES FAILED: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
