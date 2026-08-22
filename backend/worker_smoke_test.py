"""Smoke-test the authenticated remote training protocol against a running API."""
from __future__ import annotations

import argparse
import io
from pathlib import Path
import zipfile

import requests
from PIL import Image

BASE = "http://127.0.0.1:8000"


def checked(response: requests.Response) -> requests.Response:
    if not response.ok:
        raise requests.HTTPError(
            f"{response.status_code} {response.request.method} {response.url}: {response.text}",
            response=response,
        )
    return response


def main(checkpoint: Path | None = None) -> None:
    project_id: str | None = None
    worker_ids: list[str] = []
    try:
        image = io.BytesIO()
        Image.new("RGB", (128, 128), "#7655d9").save(image, "PNG")
        image.seek(0)
        project = checked(
            requests.post(
                f"{BASE}/api/projects",
                json={"name": "Remote Worker Smoke", "type": "Object Detection", "classes": ["object"]},
                timeout=15,
            )
        ).json()
        project_id = project["id"]
        project = checked(
            requests.post(
                f"{BASE}/api/projects/{project_id}/assets",
                files={"files": ("worker-smoke.png", image, "image/png")},
                timeout=15,
            )
        ).json()
        asset_id = project["assets"][0]["id"]
        checked(
            requests.put(
                f"{BASE}/api/projects/{project_id}/assets/{asset_id}/annotations",
                json={"boxes": [{"x": 20, "y": 20, "w": 50, "h": 50, "label": "object"}]},
                timeout=15,
            )
        )
        project = checked(
            requests.post(
                f"{BASE}/api/projects/{project_id}/versions",
                json={"resize": 160, "augment": False, "splits": [100, 0, 0]},
                timeout=30,
            )
        ).json()
        version_id = project["versions"][-1]["id"]

        unauthenticated = requests.post(f"{BASE}/api/training-workers/agent/claim", timeout=10)
        assert unauthenticated.status_code == 401

        workers = []
        for name in ("Smoke Laptop", "Other Laptop"):
            worker = checked(
                requests.post(f"{BASE}/api/training-workers", json={"name": name}, timeout=10)
            ).json()
            worker_ids.append(worker["id"])
            workers.append(worker)
        headers = {"Authorization": f"Bearer {workers[0]['token']}"}
        other_headers = {"Authorization": f"Bearer {workers[1]['token']}"}
        checked(
            requests.post(
                f"{BASE}/api/training-workers/agent/heartbeat",
                headers=headers,
                json={"capabilities": {"cuda": False, "cpu": "Smoke CPU", "platform": "test"}},
                timeout=10,
            )
        )
        project = checked(
            requests.post(
                f"{BASE}/api/projects/{project_id}/train",
                json={
                    "architecture": "yolo11n.pt",
                    "epochs": 1,
                    "image_size": 160,
                    "version_id": version_id,
                    "execution_target": "remote-cpu",
                    "worker_id": workers[0]["id"],
                },
                timeout=15,
            )
        ).json()
        model = project["models"][-1]
        assert model["status"] == "queued" and model["workerId"] is None

        job = checked(
            requests.post(f"{BASE}/api/training-workers/agent/claim", headers=headers, timeout=15)
        ).json()
        assert job["id"] == model["id"] and job["config"]["execution_target"] == "remote-cpu"
        forbidden = requests.get(
            f"{BASE}{job['datasetUrl']}", headers=other_headers, timeout=15
        )
        assert forbidden.status_code == 404
        dataset = checked(
            requests.get(f"{BASE}{job['datasetUrl']}", headers=headers, timeout=30)
        ).content
        with zipfile.ZipFile(io.BytesIO(dataset)) as archive:
            assert "data.yaml" in archive.namelist()

        checked(
            requests.post(
                f"{BASE}/api/training-workers/agent/jobs/{model['id']}/progress",
                headers=headers,
                json={"progress": 42, "epoch": 1, "metrics": {"metrics/mAP50(B)": 0.5}},
                timeout=10,
            )
        )
        current = checked(requests.get(f"{BASE}/api/projects/{project_id}", timeout=10)).json()
        current_model = next(item for item in current["models"] if item["id"] == model["id"])
        assert current_model["status"] == "training" and current_model["progress"] == 42
        assert current_model["workerId"] == workers[0]["id"]

        if checkpoint:
            with checkpoint.open("rb") as best_pt:
                completed = checked(
                    requests.post(
                        f"{BASE}/api/training-workers/agent/jobs/{model['id']}/complete",
                        headers={
                            **headers,
                            "Content-Type": "application/octet-stream",
                            "X-VisionFlow-Metrics": '{"metrics/mAP50(B)":0.55,"metrics/precision(B)":0.6,"metrics/recall(B)":0.5}',
                        },
                        data=best_pt,
                        timeout=1800,
                    )
                ).json()
            assert completed["status"] == "ready" and completed["bytes"] == checkpoint.stat().st_size
            current = checked(requests.get(f"{BASE}/api/projects/{project_id}", timeout=10)).json()
            ready = next(item for item in current["models"] if item["id"] == model["id"])
            assert ready["status"] == "ready" and ready["map"] == 55
            downloaded = checked(
                requests.get(
                    f"{BASE}/api/projects/{project_id}/models/{model['id']}/weights", timeout=300
                )
            ).content
            assert len(downloaded) == checkpoint.stat().st_size
        else:
            checked(
                requests.post(f"{BASE}/api/projects/{project_id}/models/{model['id']}/cancel", timeout=10)
            )
            status = checked(
                requests.get(
                    f"{BASE}/api/training-workers/agent/jobs/{model['id']}", headers=headers, timeout=10
                )
            ).json()
            assert status["cancelled"] is True
        empty = requests.post(f"{BASE}/api/training-workers/agent/claim", headers=headers, timeout=10)
        assert empty.status_code == 204
        retried = checked(
            requests.post(
                f"{BASE}/api/projects/{project_id}/models/{model['id']}/retry", timeout=10
            )
        ).json()
        retried_model = next(item for item in retried["models"] if item["id"] == model["id"])
        assert retried_model["status"] == "queued"
        checked(requests.delete(f"{BASE}/api/training-workers/{workers[0]['id']}", timeout=10))
        checked(
            requests.post(
                f"{BASE}/api/training-workers/agent/heartbeat",
                headers=other_headers,
                json={"capabilities": {"cuda": False, "cpu": "Other CPU", "platform": "test"}},
                timeout=10,
            )
        )
        reassigned = checked(
            requests.post(
                f"{BASE}/api/training-workers/agent/claim", headers=other_headers, timeout=10
            )
        ).json()
        assert reassigned["id"] == model["id"]
        assert reassigned["config"]["worker_id"] is None
        checked(
            requests.post(f"{BASE}/api/projects/{project_id}/models/{model['id']}/cancel", timeout=10)
        )
        assert (
            requests.post(
                f"{BASE}/api/training-workers/agent/claim", headers=other_headers, timeout=10
            ).status_code
            == 204
        )
        print("Remote worker protocol smoke test passed")
    finally:
        if project_id:
            requests.delete(f"{BASE}/api/projects/{project_id}", timeout=15)
        for worker_id in worker_ids:
            requests.delete(f"{BASE}/api/training-workers/{worker_id}", timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, help="Also validate the best.pt completion/upload flow")
    arguments = parser.parse_args()
    main(arguments.checkpoint)
