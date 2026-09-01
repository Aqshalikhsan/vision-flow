"""Fast, isolated smoke coverage for the operational feature suite."""
from __future__ import annotations

import io
import os
from pathlib import Path
import sys
import tempfile

from PIL import Image


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    data = tempfile.TemporaryDirectory(prefix="salnova-feature-suite-", ignore_cleanup_errors=True)
    os.environ["VISIONFLOW_DATA_DIR"] = data.name
    os.environ["VISIONFLOW_REQUIRE_AUTH"] = "0"

    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        created = client.post(
            "/api/projects",
            json={"name": "Feature Suite", "type": "Object Detection", "classes": ["object"]},
        )
        assert created.status_code == 201, created.text
        project_id = created.json()["id"]
        image = io.BytesIO()
        Image.new("RGB", (400, 300), "#7655d9").save(image, "PNG")
        uploaded = client.post(
            f"/api/projects/{project_id}/assets",
            files={"files": ("sample.png", image.getvalue(), "image/png")},
        )
        assert uploaded.status_code == 201, uploaded.text
        asset_id = uploaded.json()["assets"][0]["id"]
        boxes = [{"x": 10, "y": 10, "w": 40, "h": 40, "label": "object"}]
        assert client.put(
            f"/api/projects/{project_id}/assets/{asset_id}/annotations", json={"boxes": boxes}
        ).status_code == 200
        assert client.put(
            f"/api/projects/{project_id}/assets/{asset_id}/annotations", json={"boxes": []}
        ).status_code == 200

        collaboration = client.get(
            f"/api/projects/{project_id}/assets/{asset_id}/collaboration"
        ).json()
        assert collaboration["revisions"] and "boxes" in collaboration["revisions"][0]
        original = next(item for item in collaboration["revisions"] if item["annotations"] == 1)
        restored = client.post(
            f"/api/projects/{project_id}/assets/{asset_id}/revisions/{original['id']}/restore"
        )
        assert restored.status_code == 200 and len(restored.json()["assets"][0]["boxes"]) == 1

        lock = client.put(
            f"/api/projects/{project_id}/assets/{asset_id}/lock", json={"ttl_seconds": 60}
        )
        assert lock.status_code == 200 and lock.json()["locked"] is True
        assert client.delete(f"/api/projects/{project_id}/assets/{asset_id}/lock").status_code == 204

        action = client.post(
            f"/api/projects/{project_id}/health/actions",
            json={"asset_ids": [asset_id], "action": "review"},
        )
        assert action.status_code == 200 and action.json()["assets"][0]["reviewStatus"] == "needs-fix"
        blocked = client.post(
            f"/api/projects/{project_id}/versions",
            json={"resize": 160, "augment": False, "splits": [100, 0, 0], "enforce_quality": True},
        )
        assert blocked.status_code == 409, blocked.text

        monitoring = client.get(f"/api/projects/{project_id}/deployment/metrics").json()
        assert monitoring["p95LatencyMs"] == 0 and "driftScore" in monitoring
        config = client.get(f"/api/projects/{project_id}/deployment/config").json()
        assert config["canaryPercent"] == 0
        providers = client.get("/api/advance/providers").json()["categories"]
        video = next(item for item in providers if item["id"] == "video-propagation")
        assert next(item for item in video["engines"] if item["id"] == "video-tracking")["ready"] is True
        assert client.get("/api/jobs").status_code == 200
        assert client.get("/api/notifications").status_code == 200

        client.delete(f"/api/projects/{project_id}")
    data.cleanup()
    print("feature suite smoke test passed")


if __name__ == "__main__":
    main()
