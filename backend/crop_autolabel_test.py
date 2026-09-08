"""Isolated regression coverage for upload crop and exemplar auto-label."""

from __future__ import annotations

import io
import os
from pathlib import Path
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw


def image_bytes(object_x: int) -> bytes:
    image = Image.new("RGB", (100, 80), "#d7d2c8")
    draw = ImageDraw.Draw(image)
    for row in range(4):
        for column in range(4):
            color = "#1d1740" if (row + column) % 2 else "#f4b942"
            draw.rectangle(
                (object_x + column * 5, 20 + row * 5, object_x + column * 5 + 4, 20 + row * 5 + 4),
                fill=color,
            )
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def chunk_upload(client, project_id: str, name: str, content_type: str, data: bytes, crop: dict) -> dict:
    created = client.post(
        f"/api/projects/{project_id}/asset-uploads",
        json={
            "filename": name,
            "content_type": content_type,
            "size": len(data),
            "frame_interval_seconds": 1,
            "crop": crop,
        },
    )
    assert created.status_code == 201, created.text
    upload_id = created.json()["uploadId"]
    appended = client.put(
        f"/api/projects/{project_id}/asset-uploads/{upload_id}",
        content=data,
        headers={"X-Upload-Offset": "0", "Content-Type": "application/octet-stream"},
    )
    assert appended.status_code == 200, appended.text
    complete = client.post(f"/api/projects/{project_id}/asset-uploads/{upload_id}/complete")
    assert complete.status_code == 202, complete.text
    status = client.get(f"/api/projects/{project_id}/asset-uploads/{upload_id}")
    assert status.json()["status"] == "completed", status.text
    return client.get(f"/api/projects/{project_id}").json()


def main() -> None:
    workspace = Path(__file__).resolve().parent.parent
    data_dir = tempfile.TemporaryDirectory(prefix="salnova-crop-autolabel-", ignore_cleanup_errors=True)
    os.environ["VISIONFLOW_DATA_DIR"] = data_dir.name
    os.environ["VISIONFLOW_REQUIRE_AUTH"] = "0"

    import sys

    sys.path.insert(0, str(workspace))
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        created = client.post(
            "/api/projects",
            json={"name": "Crop + examples", "type": "Object Detection", "classes": ["part"]},
        )
        assert created.status_code == 201, created.text
        project_id = created.json()["id"]

        cropped = chunk_upload(
            client,
            project_id,
            "crop-source.png",
            "image/png",
            image_bytes(10),
            {"x": 50, "y": 25, "w": 50, "h": 50},
        )
        crop_asset = cropped["assets"][-1]
        crop_response = client.get(crop_asset["src"])
        assert Image.open(io.BytesIO(crop_response.content)).size == (50, 40)

        reference = client.post(
            f"/api/projects/{project_id}/assets",
            files={"files": ("reference.png", image_bytes(10), "image/png")},
        ).json()["assets"][-1]
        saved = client.put(
            f"/api/projects/{project_id}/assets/{reference['id']}/annotations",
            json={"boxes": [{"x": 10, "y": 25, "w": 20, "h": 25, "label": "part"}]},
        )
        assert saved.status_code == 200, saved.text
        locked = next(item for item in saved.json()["assets"] if item["id"] == reference["id"])
        assert locked["metadata"]["exampleLocked"] == "true"

        target = client.post(
            f"/api/projects/{project_id}/assets",
            files={"files": ("target.png", image_bytes(60), "image/png")},
        ).json()["assets"][-1]
        proposed = client.post(
            f"/api/projects/{project_id}/assets/{target['id']}/example-auto-label",
            json={"confidence": 0.5, "max_examples": 10, "max_detections": 5},
        )
        assert proposed.status_code == 200, proposed.text
        suggestions = proposed.json()["boxes"]
        assert suggestions, proposed.text
        assert any(box["label"] == "part" and abs(box["x"] - 60) < 8 for box in suggestions)
        unchanged = client.get(f"/api/projects/{project_id}").json()
        target_after = next(item for item in unchanged["assets"] if item["id"] == target["id"])
        assert target_after["boxes"] == [], "drafts must not save before review"

        video_file = Path(data_dir.name) / "source.avi"
        writer = cv2.VideoWriter(str(video_file), cv2.VideoWriter_fourcc(*"MJPG"), 1, (100, 80))
        writer.write(np.full((80, 100, 3), 127, dtype=np.uint8))
        writer.release()
        video_project = client.post(
            "/api/projects",
            json={"name": "Video crop", "type": "Object Detection", "classes": ["part"]},
        ).json()
        video_result = chunk_upload(
            client,
            video_project["id"],
            "source.avi",
            "video/x-msvideo",
            video_file.read_bytes(),
            {"x": 25, "y": 25, "w": 50, "h": 50},
        )
        video_asset = video_result["assets"][0]
        frame = Image.open(io.BytesIO(client.get(video_asset["src"]).content))
        assert frame.size == (50, 40)

    data_dir.cleanup()
    print("crop + exemplar auto-label test passed")


if __name__ == "__main__":
    main()
