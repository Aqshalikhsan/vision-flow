"""Regression coverage for image/video uploads larger than a proxy body limit."""
from __future__ import annotations

import io
import os
from pathlib import Path
import sys
import tempfile

import cv2
import numpy as np
from PIL import Image


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    data = tempfile.TemporaryDirectory(prefix="salnova-chunk-upload-", ignore_cleanup_errors=True)
    os.environ["VISIONFLOW_DATA_DIR"] = data.name
    os.environ["VISIONFLOW_REQUIRE_AUTH"] = "0"

    from fastapi.testclient import TestClient
    from backend.main import app

    image = io.BytesIO()
    Image.new("RGB", (8, 8), "#7655d9").save(image, "PNG")
    image_bytes = image.getvalue()
    declared_size = 101 * 1024 * 1024
    chunk_size = 8 * 1024 * 1024

    with TestClient(app) as client:
        project = client.post(
            "/api/projects",
            json={"name": "Large upload", "type": "Object Detection", "classes": ["object"]},
        )
        assert project.status_code == 201, project.text
        project_id = project.json()["id"]
        created = client.post(
            f"/api/projects/{project_id}/asset-uploads",
            json={
                "filename": "larger-than-100mb.png",
                "content_type": "image/png",
                "size": declared_size,
                "frame_interval_seconds": 1,
            },
        )
        assert created.status_code == 201, created.text
        upload_id = created.json()["uploadId"]

        offset = 0
        while offset < declared_size:
            length = min(chunk_size, declared_size - offset)
            prefix = image_bytes if offset == 0 else b""
            body = prefix + bytes(length - len(prefix))
            uploaded = client.put(
                f"/api/projects/{project_id}/asset-uploads/{upload_id}",
                content=body,
                headers={"X-Upload-Offset": str(offset), "Content-Type": "application/octet-stream"},
            )
            assert uploaded.status_code == 200, uploaded.text
            offset = uploaded.json()["offset"]

        completed = client.post(
            f"/api/projects/{project_id}/asset-uploads/{upload_id}/complete"
        )
        assert completed.status_code == 202, completed.text
        status = client.get(
            f"/api/projects/{project_id}/asset-uploads/{upload_id}"
        ).json()
        assert status["status"] == "completed", status
        refreshed = client.get(f"/api/projects/{project_id}").json()
        assert refreshed["assets"][0]["name"] == "larger-than-100mb.png"
        assert Path(data.name, "uploads", project_id, refreshed["assets"][0]["id"] + ".png").stat().st_size == declared_size

        removed = client.delete(
            f"/api/projects/{project_id}/assets/{refreshed['assets'][0]['id']}"
        )
        assert removed.status_code == 204, removed.text
        source_video = Path(data.name, "source.avi")
        writer = cv2.VideoWriter(
            str(source_video), cv2.VideoWriter_fourcc(*"MJPG"), 1, (16, 16)
        )
        assert writer.isOpened()
        writer.write(np.full((16, 16, 3), 96, dtype=np.uint8))
        writer.release()
        video_bytes = source_video.read_bytes()
        created = client.post(
            f"/api/projects/{project_id}/asset-uploads",
            json={
                "filename": "larger-than-100mb.avi",
                "content_type": "video/x-msvideo",
                "size": declared_size,
                "frame_interval_seconds": 1,
            },
        )
        assert created.status_code == 201, created.text
        upload_id = created.json()["uploadId"]
        offset = 0
        while offset < declared_size:
            length = min(chunk_size, declared_size - offset)
            prefix = video_bytes if offset == 0 else b""
            body = prefix + bytes(length - len(prefix))
            uploaded = client.put(
                f"/api/projects/{project_id}/asset-uploads/{upload_id}",
                content=body,
                headers={"X-Upload-Offset": str(offset), "Content-Type": "application/octet-stream"},
            )
            assert uploaded.status_code == 200, uploaded.text
            offset = uploaded.json()["offset"]
        completed = client.post(
            f"/api/projects/{project_id}/asset-uploads/{upload_id}/complete"
        )
        assert completed.status_code == 202, completed.text
        status = client.get(
            f"/api/projects/{project_id}/asset-uploads/{upload_id}"
        ).json()
        assert status["status"] == "completed", status
        refreshed = client.get(f"/api/projects/{project_id}").json()
        assert refreshed["assets"][0]["metadata"]["sourceVideo"] == "larger-than-100mb.avi"

    data.cleanup()
    print("chunked upload test passed (101 MiB image and video)")


if __name__ == "__main__":
    main()
