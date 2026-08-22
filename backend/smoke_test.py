"""End-to-end API smoke test. Requires the local API on port 8000."""
from __future__ import annotations

import io
import json
import random
import sys
import time
import zipfile
from pathlib import Path

import requests
import cv2
import numpy as np
from PIL import Image, ImageDraw
from main import apply_augmentation, assign_asset_splits

BASE = "http://127.0.0.1:8000"


def main() -> None:
    all_transforms = {
        "horizontalFlip": {"enabled": True, "probability": 1, "amount": 0},
        "verticalFlip": {"enabled": True, "probability": 1, "amount": 0},
        "rotate": {"enabled": True, "probability": 1, "amount": 8},
        "translate": {"enabled": True, "probability": 1, "amount": 4},
        "shear": {"enabled": True, "probability": 1, "amount": 4},
        "crop": {"enabled": True, "probability": 1, "amount": 5},
        "brightness": {"enabled": True, "probability": 1, "amount": 10},
        "contrast": {"enabled": True, "probability": 1, "amount": 10},
        "saturation": {"enabled": True, "probability": 1, "amount": 10},
        "hue": {"enabled": True, "probability": 1, "amount": 5},
        "grayscale": {"enabled": True, "probability": 1, "amount": 0},
        "blur": {"enabled": True, "probability": 1, "amount": 0.5},
        "sharpen": {"enabled": True, "probability": 1, "amount": 0.5},
        "noise": {"enabled": True, "probability": 1, "amount": 3},
        "cutout": {"enabled": True, "probability": 1, "amount": 8},
        "jpeg": {"enabled": True, "probability": 1, "amount": 70},
    }
    transformed, transformed_boxes = apply_augmentation(
        Image.new("RGB", (320, 240), "#777777"),
        [{"x": 25, "y": 20, "w": 45, "h": 60, "label": "target"}],
        all_transforms,
        random.Random(7),
    )
    assert transformed.size == (320, 240) and transformed_boxes
    assert all(0 <= box["x"] <= 100 and 0 <= box["y"] <= 100 and box["x"] + box["w"] <= 100.0001 and box["y"] + box["h"] <= 100.0001 for box in transformed_boxes)
    assigned = assign_asset_splits([
        {"id": "locked", "split": "test", "split_locked": 1},
        {"id": "a", "split": "train", "split_locked": 0},
        {"id": "b", "split": "train", "split_locked": 0},
        {"id": "c", "split": "train", "split_locked": 0},
    ], (50, 25, 25), 1)
    assert assigned["locked"] == "test", "manual dataset splits must survive version generation"
    health = requests.get(f"{BASE}/api/health", timeout=10).json()
    assert health["status"] == "ok" and health["mlReady"] is True

    project = requests.post(
        f"{BASE}/api/projects",
        json={"name": "Smoke Test", "type": "Object Detection", "description": "Temporary API test", "classes": ["object"]},
        timeout=10,
    ).json()
    project_id = project["id"]
    workflow_id = None
    try:
        project = requests.put(
            f"{BASE}/api/projects/{project_id}",
            json={"name": "Smoke Test Updated", "description": "Updated through project settings"}, timeout=10,
        ).json()
        assert project["name"] == "Smoke Test Updated" and project["description"] == "Updated through project settings"
        project = requests.put(
            f"{BASE}/api/projects/{project_id}/classes",
            json={"classes": ["object"], "colors": {"object": "#ffcf4a"}}, timeout=10,
        ).json()
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/classes",
            json={"name": "secondary", "color": "#24c7bd"}, timeout=10,
        ).json()
        assert project["classes"] == ["object", "secondary"] and project["colors"]["secondary"] == "#24c7bd"
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/classes",
            json={"name": "unused", "color": "#4b9cff"}, timeout=10,
        ).json()
        project = requests.delete(f"{BASE}/api/projects/{project_id}/classes/unused", timeout=10).json()
        assert "unused" not in project["classes"]
        image = Image.new("RGB", (320, 240), "#ddd9ff")
        ImageDraw.Draw(image).rectangle((80, 50, 230, 190), fill="#6c4ee7")
        data = io.BytesIO()
        image.save(data, "PNG")
        image_bytes = data.getvalue()
        data.seek(0)
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/assets",
            files={"files": ("sample.png", data, "image/png")}, timeout=15,
        ).json()
        asset_id = project["assets"][0]["id"]
        invalid_annotation = requests.put(
            f"{BASE}/api/projects/{project_id}/assets/{asset_id}/annotations",
            json={"boxes": [{"x": -1, "y": 10, "w": 20, "h": 20, "label": "object"}]}, timeout=10,
        )
        assert invalid_annotation.status_code == 400
        unsafe_class = requests.post(
            f"{BASE}/api/projects/{project_id}/classes",
            json={"name": "../../escape", "color": "#ffffff"}, timeout=10,
        )
        assert unsafe_class.status_code == 400
        unsafe_workflow = requests.post(
            f"{BASE}/api/workflows",
            json={"name": "Unsafe", "nodes": [{"id": "hook", "type": "webhook", "config": {"url": "http://127.0.0.1:8000/api/health"}}], "edges": []}, timeout=10,
        )
        assert unsafe_workflow.status_code == 400
        project = requests.put(
            f"{BASE}/api/projects/{project_id}/assets/{asset_id}/annotations",
            json={"boxes": [
                {"x": 25, "y": 20, "w": 45, "h": 60, "label": "object"},
                {"x": 12, "y": 10, "w": 18, "h": 20, "label": "secondary", "type": "polygon", "points": [{"x": 12, "y": 10}, {"x": 30, "y": 12}, {"x": 27, "y": 30}, {"x": 15, "y": 28}]},
            ]}, timeout=10,
        ).json()
        assert project["assets"][0]["status"] == "annotated"
        in_use_class = requests.delete(f"{BASE}/api/projects/{project_id}/classes/object", timeout=10)
        assert in_use_class.status_code == 409
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/assets/bulk",
            json={"ids": [asset_id], "action": "split", "value": "valid"}, timeout=10,
        ).json()
        assert project["assets"][0]["split"] == "valid"
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/assets/bulk",
            json={"ids": [asset_id], "action": "review", "value": "approved"}, timeout=10,
        ).json()
        assert project["assets"][0]["reviewStatus"] == "approved"
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/assets/bulk",
            json={"ids": [asset_id], "action": "split", "value": "train"}, timeout=10,
        ).json()
        project = requests.put(f"{BASE}/api/projects/{project_id}/assets/{asset_id}/review", json={"status": "approved"}, timeout=10).json()
        assert project["assets"][0]["reviewStatus"] == "approved"
        mask_response = requests.post(f"{BASE}/api/projects/{project_id}/assets/{asset_id}/smart-mask", json={"x": 50, "y": 50, "label": "object", "size": 85}, timeout=20)
        assert mask_response.status_code == 200, mask_response.text
        assert len(mask_response.json()["points"]) >= 3
        created_key = requests.post(f"{BASE}/api/projects/{project_id}/deployment/keys", json={"name": "Smoke client"}, timeout=10).json()
        assert created_key["key"].startswith("vf_")
        keys = requests.get(f"{BASE}/api/projects/{project_id}/deployment/keys", timeout=10).json()
        assert keys[0]["prefix"] == created_key["prefix"] and "key" not in keys[0]
        unauthorized = requests.post(f"{BASE}/api/deploy/{project_id}/infer", files={"file": ("sample.png", io.BytesIO(image_bytes), "image/png")}, timeout=10)
        assert unauthorized.status_code == 401
        assert requests.delete(f"{BASE}/api/projects/{project_id}/deployment/keys/{created_key['id']}", timeout=10).status_code == 204
        project = requests.put(
            f"{BASE}/api/projects/{project_id}/classes/object",
            json={"name": "target", "color": "#e85d4a"}, timeout=10,
        ).json()
        assert project["classes"] == ["target", "secondary"]
        assert project["colors"]["target"] == "#e85d4a"
        assert project["assets"][0]["boxes"][0]["label"] == "target"
        project = requests.post(
            f"{BASE}/api/projects/{project_id}/versions",
            json={
                "resize": 416,
                "augment": True,
                "splits": [70, 20, 10],
                "augmentation_copies": 2,
                "augmentations": {
                    "horizontalFlip": {"enabled": True, "probability": 1, "amount": 0},
                    "brightness": {"enabled": True, "probability": 1, "amount": 18},
                    "noise": {"enabled": True, "probability": 1, "amount": 4},
                },
            }, timeout=15,
        ).json()
        assert project["versions"][0]["number"] == 1
        assert project["versions"][0]["generatedImages"] == 3
        assert project["versions"][0]["augmentations"]["copies"] == 2
        version = Path(__file__).resolve().parent.parent / "local_data" / "versions" / project_id / "v1"
        train_images = list((version / "images" / "train").glob("*.jpg"))
        assert len(train_images) == 3, "original + horizontal flip + brightness expected"
        assert Image.open(train_images[0]).size == (416, 416)
        assert list((version / "images" / "valid").glob("*.jpg")), "validation fallback expected"
        flip_label = next((version / "labels" / "train").glob("*-aug-01.txt")).read_text()
        assert "0 0.525000" in flip_label, "horizontal box transform is incorrect"
        export = requests.get(f"{BASE}/api/projects/{project_id}/versions/{project['versions'][0]['id']}/export", timeout=30)
        assert export.status_code == 200 and export.content[:2] == b"PK"
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            assert "data.yaml" in archive.namelist()
        coco_export = requests.get(
            f"{BASE}/api/projects/{project_id}/versions/{project['versions'][0]['id']}/export?format=coco",
            timeout=30,
        )
        assert coco_export.status_code == 200 and coco_export.content[:2] == b"PK"
        with zipfile.ZipFile(io.BytesIO(coco_export.content)) as archive:
            assert "annotations.json" in archive.namelist()
            coco = json.loads(archive.read("annotations.json"))
            assert [category["name"] for category in coco["categories"]] == ["target", "secondary"]
            assert coco["annotations"] and coco["annotations"][0]["category_id"] == 1
            assert any(annotation["segmentation"] for annotation in coco["annotations"]), "COCO polygon segmentation expected"
        if "--train" in sys.argv:
            project = requests.post(
                f"{BASE}/api/projects/{project_id}/train",
                json={"architecture": "yolo11n.pt", "epochs": 1, "image_size": 416}, timeout=15,
            ).json()
            deadline = time.time() + 240
            observed_progress = project["models"][-1]["progress"]
            while time.time() < deadline:
                time.sleep(2)
                project = requests.get(f"{BASE}/api/projects/{project_id}", timeout=10).json()
                model = project["models"][-1]
                observed_progress = max(observed_progress, model["progress"])
                if model["status"] != "training":
                    assert model["status"] == "ready", model.get("error")
                    assert model["progress"] == 100 and observed_progress >= 20
                    break
            else:
                raise AssertionError("training did not finish before timeout")
            workflow = requests.post(
                f"{BASE}/api/workflows",
                json={"name": "Smoke Workflow", "nodes": [{"id": "input", "type": "input"}, {"id": "model", "type": "model", "projectId": project_id}, {"id": "count", "type": "count"}], "edges": [{"from": "input", "to": "model"}, {"from": "model", "to": "count"}]}, timeout=10,
            ).json()
            workflow_id = workflow["id"]
            workflow_run = requests.post(
                f"{BASE}/api/workflows/{workflow_id}/run",
                files={"file": ("sample.png", io.BytesIO(image_bytes), "image/png")}, timeout=60,
            ).json()
            assert workflow_run["status"] == "completed" and "counts" in workflow_run
        version_id = project["versions"][0]["id"]
        removed_version = requests.delete(f"{BASE}/api/projects/{project_id}/versions/{version_id}", timeout=10)
        assert removed_version.status_code == 204
        assert not requests.get(f"{BASE}/api/projects/{project_id}", timeout=10).json()["versions"]
        deleted = requests.post(
            f"{BASE}/api/projects/{project_id}/assets/bulk",
            json={"ids": [asset_id], "action": "delete"}, timeout=10,
        )
        assert deleted.status_code == 200 and not deleted.json()["assets"]
        frame_files = [("files", (f"frame-{number}.png", io.BytesIO(image_bytes), "image/png")) for number in range(3)]
        project = requests.post(f"{BASE}/api/projects/{project_id}/assets", files=frame_files, timeout=20).json()
        frame_ids = [asset["id"] for asset in project["assets"]]
        for frame_id, x in ((frame_ids[0], 10), (frame_ids[2], 50)):
            project = requests.put(f"{BASE}/api/projects/{project_id}/assets/{frame_id}/annotations", json={"boxes": [{"x": x, "y": 20, "w": 20, "h": 20, "label": "target"}]}, timeout=10).json()
        project = requests.post(f"{BASE}/api/projects/{project_id}/assets/interpolate", json={"start_asset_id": frame_ids[0], "end_asset_id": frame_ids[2]}, timeout=10).json()
        middle = next(asset for asset in project["assets"] if asset["id"] == frame_ids[1])
        assert middle["status"] == "annotated" and abs(middle["boxes"][0]["x"] - 30) < 0.01
        for frame_id in frame_ids:
            requests.delete(f"{BASE}/api/projects/{project_id}/assets/{frame_id}", timeout=10)
        member = requests.post(f"{BASE}/api/members", json={"name": "Smoke Reviewer", "email": f"smoke-{project_id}@local.test", "role": "annotator"}, timeout=10).json()
        member = requests.put(f"{BASE}/api/members/{member['id']}", json={"name": member["name"], "email": member["email"], "role": "viewer"}, timeout=10).json()
        assert member["role"] == "viewer"
        assert requests.delete(f"{BASE}/api/members/{member['id']}", timeout=10).status_code == 204
        video_path = Path(__file__).resolve().parent.parent / "local_data" / f"smoke-{project_id}.mp4"
        writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 5, (64, 48))
        for frame_number in range(10):
            writer.write(np.full((48, 64, 3), frame_number * 20, dtype=np.uint8))
        writer.release()
        try:
            with video_path.open("rb") as video_file:
                project = requests.post(f"{BASE}/api/projects/{project_id}/assets", files={"files": ("sample.mp4", video_file, "video/mp4")}, timeout=30).json()
            assert len(project["assets"]) == 2, "one frame per second should be extracted"
            for frame in project["assets"]:
                requests.delete(f"{BASE}/api/projects/{project_id}/assets/{frame['id']}", timeout=10)
        finally:
            video_path.unlink(missing_ok=True)
        dataset_zip = io.BytesIO()
        with zipfile.ZipFile(dataset_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("data.yaml", "names:\n  0: target\n")
            archive.writestr("images/train/imported.png", image_bytes)
            archive.writestr("labels/train/imported.txt", "0 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\n")
        dataset_zip.seek(0)
        project = requests.post(f"{BASE}/api/projects/{project_id}/import/yolo", files={"file": ("dataset.zip", dataset_zip, "application/zip")}, timeout=30).json()
        assert len(project["assets"]) == 1 and project["assets"][0]["boxes"][0]["type"] == "polygon"
        imported_id = project["assets"][0]["id"]
        project = requests.put(f"{BASE}/api/projects/{project_id}/assets/{imported_id}/split", json={"split": "test"}, timeout=10).json()
        assert project["assets"][0]["split"] == "test"
        requests.delete(f"{BASE}/api/projects/{project_id}/assets/{imported_id}", timeout=10)
        coco_zip = io.BytesIO()
        with zipfile.ZipFile(coco_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("images/coco.png", image_bytes)
            archive.writestr("annotations.json", json.dumps({"images": [{"id": 1, "file_name": "coco.png", "width": 320, "height": 240}], "categories": [{"id": 1, "name": "defect"}], "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [32, 24, 96, 72], "segmentation": [[32, 24, 128, 24, 128, 96, 32, 96]]}]}))
        coco_zip.seek(0)
        project = requests.post(f"{BASE}/api/projects/{project_id}/import/yolo", files={"file": ("coco.zip", coco_zip, "application/zip")}, timeout=30).json()
        assert project["assets"][0]["boxes"][0]["type"] == "polygon" and project["classes"] == ["defect"]
        requests.delete(f"{BASE}/api/projects/{project_id}/assets/{project['assets'][0]['id']}", timeout=10)
        voc_zip = io.BytesIO()
        with zipfile.ZipFile(voc_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("images/voc.png", image_bytes)
            archive.writestr("annotations/voc.xml", "<annotation><filename>voc.png</filename><object><name>fault</name><bndbox><xmin>20</xmin><ymin>30</ymin><xmax>120</xmax><ymax>130</ymax></bndbox></object></annotation>")
        voc_zip.seek(0)
        project = requests.post(f"{BASE}/api/projects/{project_id}/import/yolo", files={"file": ("voc.zip", voc_zip, "application/zip")}, timeout=30).json()
        assert project["assets"][0]["boxes"][0]["label"] == "fault"
        requests.delete(f"{BASE}/api/projects/{project_id}/assets/{project['assets'][0]['id']}", timeout=10)
        classification = requests.post(f"{BASE}/api/projects", json={"name": "Smoke Classification", "type": "Single-Label Classification", "classes": ["good", "bad"]}, timeout=10).json()
        classification_id = classification["id"]
        try:
            classification = requests.post(f"{BASE}/api/projects/{classification_id}/assets", files={"files": ("classified.png", io.BytesIO(image_bytes), "image/png")}, timeout=15).json()
            classified_asset = classification["assets"][0]["id"]
            classification = requests.put(f"{BASE}/api/projects/{classification_id}/assets/{classified_asset}/annotations", json={"boxes": [{"x": 0, "y": 0, "w": 100, "h": 100, "label": "good", "type": "classification"}]}, timeout=10).json()
            classification = requests.post(f"{BASE}/api/projects/{classification_id}/versions", json={"resize": 416, "augment": False, "splits": [80, 20, 0]}, timeout=15).json()
            class_version = Path(__file__).resolve().parent.parent / "local_data" / "versions" / classification_id / "v1"
            assert list((class_version / "train" / "good").glob("*.jpg"))
            class_export = requests.get(f"{BASE}/api/projects/{classification_id}/versions/{classification['versions'][0]['id']}/export", timeout=30)
            with zipfile.ZipFile(io.BytesIO(class_export.content)) as archive:
                assert "classification.json" in archive.namelist()
        finally:
            requests.delete(f"{BASE}/api/projects/{classification_id}", timeout=10)
        print("SMOKE TEST PASSED: images, video interpolation, detection/segmentation/classification annotations, smart mask, review roles, API-key security, YOLO/COCO/VOC imports, augmentation, task-aware exports, version cleanup" + (", training, selected version, workflow" if "--train" in sys.argv else ""))
    finally:
        if workflow_id:
            requests.delete(f"{BASE}/api/workflows/{workflow_id}", timeout=10)
        requests.delete(f"{BASE}/api/projects/{project_id}", timeout=10)


if __name__ == "__main__":
    main()
