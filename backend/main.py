from __future__ import annotations

import base64
import hashlib
import io
import ipaddress
import json
import random
import re
import secrets
import shutil
import socket
import sqlite3
import threading
import time
import uuid
import zipfile
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "local_data"
UPLOADS = DATA / "uploads"
VERSIONS = DATA / "versions"
RUNS = DATA / "runs"
EXPORTS = DATA / "exports"
DB_PATH = DATA / "visionflow.db"
TRAIN_CANCEL: dict[str, threading.Event] = {}
TRAIN_SCHEDULER_LOCK = threading.Lock()
for folder in (DATA, UPLOADS, VERSIONS, RUNS, EXPORTS):
    folder.mkdir(parents=True, exist_ok=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex[:12]


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
              classes TEXT NOT NULL DEFAULT '[]', colors TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL, path TEXT NOT NULL, split TEXT NOT NULL DEFAULT 'train',
              status TEXT NOT NULL DEFAULT 'unannotated', boxes TEXT NOT NULL DEFAULT '[]',
              split_locked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS versions (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              number INTEGER NOT NULL, created_at TEXT NOT NULL, images INTEGER NOT NULL,
              resize INTEGER NOT NULL, augment INTEGER NOT NULL, splits TEXT NOT NULL,
              path TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS models (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
              progress INTEGER NOT NULL DEFAULT 0, map REAL NOT NULL DEFAULT 0,
              precision REAL NOT NULL DEFAULT 0, recall REAL NOT NULL DEFAULT 0,
              weights_path TEXT, error TEXT
            );
            CREATE TABLE IF NOT EXISTS workflows (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, nodes TEXT NOT NULL,
              edges TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_keys (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL,
              created_at TEXT NOT NULL, last_used TEXT, revoked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS inference_logs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              model_id TEXT, created_at TEXT NOT NULL, latency_ms REAL NOT NULL,
              predictions INTEGER NOT NULL, status TEXT NOT NULL, secure INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS workspace_members (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
              role TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )
        columns = {row["name"] for row in con.execute("PRAGMA table_info(projects)")}
        if "colors" not in columns:
            con.execute("ALTER TABLE projects ADD COLUMN colors TEXT NOT NULL DEFAULT '{}'")
        version_columns = {row["name"] for row in con.execute("PRAGMA table_info(versions)")}
        if "augmentations" not in version_columns:
            con.execute("ALTER TABLE versions ADD COLUMN augmentations TEXT NOT NULL DEFAULT '{}'")
        if "generated_images" not in version_columns:
            con.execute("ALTER TABLE versions ADD COLUMN generated_images INTEGER NOT NULL DEFAULT 0")
        model_columns = {row["name"] for row in con.execute("PRAGMA table_info(models)")}
        if "config" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN config TEXT NOT NULL DEFAULT '{}'")
        if "created_at" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN created_at TEXT")
        if "metrics_history" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN metrics_history TEXT NOT NULL DEFAULT '[]'")
        asset_columns = {row["name"] for row in con.execute("PRAGMA table_info(assets)")}
        if "review_status" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'")
        if "split_locked" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN split_locked INTEGER NOT NULL DEFAULT 0")
        # Jobs survive an application restart. The scheduler resumes from last.pt
        # when Ultralytics has already written a checkpoint for the run.
        con.execute("UPDATE models SET status='queued', error='Queued for automatic resume after server restart' WHERE status='training'")
        if not con.execute("SELECT 1 FROM workspace_members LIMIT 1").fetchone():
            con.execute("INSERT INTO workspace_members (id,name,email,role,created_at) VALUES (?,?,?,?,?)", (uid(), "Local Owner", "owner@visionflow.local", "owner", now()))


def project_dict(con: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    assets = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (row["id"],)).fetchall()
    versions = con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY number", (row["id"],)).fetchall()
    models = con.execute("SELECT * FROM models WHERE project_id=? ORDER BY rowid", (row["id"],)).fetchall()
    return {
        "id": row["id"], "name": row["name"], "type": row["type"],
        "description": row["description"], "createdAt": row["created_at"],
        "classes": json.loads(row["classes"]), "colors": json.loads(row["colors"] or "{}"),
        "assets": [{
            "id": a["id"], "name": a["name"], "src": f"/files/{a['id']}",
            "split": a["split"], "status": a["status"], "reviewStatus": a["review_status"], "boxes": json.loads(a["boxes"])
        } for a in assets],
        "versions": [{
            "id": v["id"], "number": v["number"], "createdAt": v["created_at"],
            "images": v["images"], "resize": v["resize"], "augment": bool(v["augment"]),
            "splits": json.loads(v["splits"]),
            "augmentations": json.loads(v["augmentations"] or "{}"),
            "generatedImages": v["generated_images"] or v["images"]
        } for v in versions],
        "models": [{
            "id": m["id"], "name": m["name"], "version": m["version"],
            "status": m["status"], "progress": m["progress"], "map": m["map"],
            "precision": m["precision"], "recall": m["recall"], "error": m["error"]
            , "config": json.loads(m["config"] or "{}"), "createdAt": m["created_at"], "metricsHistory": json.loads(m["metrics_history"] or "[]")
        } for m in models]
    }


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str = "Object Detection"
    description: str = ""
    classes: list[str] = Field(default_factory=lambda: ["object"])
    colors: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def supported_types(cls) -> set[str]:
        return {"Object Detection", "Instance Segmentation", "Semantic Segmentation", "Oriented Bounding Box", "Keypoint Detection", "Single-Label Classification", "Multi-Label Classification"}


class ProjectUpdatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)


class BoxPayload(BaseModel):
    id: str | None = None
    x: float
    y: float
    w: float
    h: float
    label: str
    type: str = "box"
    points: list[dict[str, float]] | None = None


class AnnotationPayload(BaseModel):
    boxes: list[BoxPayload]


class SplitPayload(BaseModel):
    split: str = Field(pattern=r"^(train|valid|test)$")


class ReviewPayload(BaseModel):
    status: str = Field(pattern=r"^(pending|approved|needs-fix)$")


class BulkAssetPayload(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=5000)
    action: str = Field(pattern=r"^(split|review|delete)$")
    value: str | None = None


class InterpolatePayload(BaseModel):
    start_asset_id: str
    end_asset_id: str


class ClassesPayload(BaseModel):
    classes: list[str] = Field(min_length=1)
    colors: dict[str, str] = Field(default_factory=dict)


class ClassCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class ClassRenamePayload(ClassCreatePayload):
    pass


class VersionPayload(BaseModel):
    resize: int = Field(default=640, ge=160, le=2048)
    augment: bool = True
    splits: tuple[int, int, int] = (70, 20, 10)
    augmentations: dict[str, dict[str, Any]] = Field(default_factory=dict)
    augmentation_copies: int = Field(default=2, ge=1, le=8)


class TrainPayload(BaseModel):
    architecture: str = "yolo11n.pt"
    epochs: int = Field(default=10, ge=1, le=300)
    image_size: int = Field(default=640, ge=160, le=1280)
    version_id: str | None = None
    batch_size: int = Field(default=16, ge=1, le=128)
    optimizer: str = Field(default="auto", pattern=r"^(auto|SGD|Adam|AdamW|NAdam|RAdam|RMSProp)$")
    learning_rate: float = Field(default=0.01, gt=0, le=1)
    patience: int = Field(default=50, ge=0, le=300)
    device: str = Field(default="auto", pattern=r"^(auto|cpu|0)$")


class ModelRenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ModelExportPayload(BaseModel):
    format: str = Field(pattern=r"^(onnx|torchscript|openvino|ncnn|tflite)$")


class ApiKeyCreatePayload(BaseModel):
    name: str = Field(default="Local application", min_length=1, max_length=80)


class AutoLabelPayload(BaseModel):
    confidence: float = Field(default=0.35, ge=0.01, le=0.99)
    overwrite: bool = False
    model_id: str | None = None
    limit: int = Field(default=500, ge=1, le=5000)


class SmartMaskPayload(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    label: str = Field(min_length=1, max_length=60)
    size: float = Field(default=36, ge=5, le=95)


class WorkflowPayload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]] = Field(default_factory=list)


class MemberPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=160)
    role: str = Field(pattern=r"^(owner|admin|annotator|viewer)$")


app = FastAPI(title="Roboflow Local API", version="0.3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
init_db()


WINDOWS_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def validate_class_names(names: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(name.strip() for name in names if name.strip()))
    for name in cleaned:
        if len(name) > 60 or name.rstrip(" .") != name or name.upper() in WINDOWS_RESERVED_NAMES or any(character in name for character in '<>:"/\\|?*') or any(ord(character) < 32 for character in name):
            raise HTTPException(400, f"Unsafe class name: {name!r}")
    if not cleaned:
        raise HTTPException(400, "At least one class is required")
    return cleaned


def validate_webhook_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(400, "Webhook must be an HTTP(S) URL without embedded credentials")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise HTTPException(400, "Webhook hostname could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(400, "Webhook cannot target a private, local, or reserved network address")
    return url


def validate_zip_size(archive: zipfile.ZipFile, maximum_uncompressed: int) -> None:
    total = sum(item.file_size for item in archive.infolist())
    compressed = max(1, sum(item.compress_size for item in archive.infolist()))
    if total > maximum_uncompressed or total / compressed > 200:
        raise HTTPException(413, "ZIP expands beyond the safe local extraction limit")


@app.get("/api/health")
def health():
    try:
        import ultralytics  # noqa: F401
        ml_ready = True
    except ImportError:
        ml_ready = False
    return {"status": "ok", "database": str(DB_PATH), "mlReady": ml_ready}


@app.get("/api/system")
def system_info():
    total, used, free = shutil.disk_usage(ROOT)
    try:
        import torch
        gpu = {"available": torch.cuda.is_available(), "name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, "count": torch.cuda.device_count()}
    except ImportError:
        gpu = {"available": False, "name": None, "count": 0}
    with db() as con:
        counts = {table: con.execute(f"SELECT COUNT(*) n FROM {table}").fetchone()["n"] for table in ("projects", "assets", "versions", "models", "workflows")}
    return {"disk": {"total": total, "used": used, "free": free}, "gpu": gpu, "data": counts, "database": str(DB_PATH)}


@app.get("/api/members")
def list_members():
    with db() as con:
        return [{"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"], "createdAt": row["created_at"]} for row in con.execute("SELECT * FROM workspace_members ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'annotator' THEN 2 ELSE 3 END,rowid")]


@app.post("/api/members", status_code=201)
def create_member(payload: MemberPayload):
    member_id = uid()
    try:
        with db() as con:
            con.execute("INSERT INTO workspace_members (id,name,email,role,created_at) VALUES (?,?,?,?,?)", (member_id, payload.name.strip(), payload.email.lower(), payload.role, now()))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "A member with this email already exists") from exc
    return {"id": member_id, **payload.model_dump(), "email": payload.email.lower(), "createdAt": now()}


@app.put("/api/members/{member_id}")
def update_member(member_id: str, payload: MemberPayload):
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
        if not member:
            raise HTTPException(404, "Member not found")
        if member["role"] == "owner" and payload.role != "owner" and con.execute("SELECT COUNT(*) n FROM workspace_members WHERE role='owner'").fetchone()["n"] <= 1:
            raise HTTPException(409, "The final workspace owner cannot be demoted")
        try:
            con.execute("UPDATE workspace_members SET name=?,email=?,role=? WHERE id=?", (payload.name.strip(), payload.email.lower(), payload.role, member_id))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "A member with this email already exists") from exc
    return {"id": member_id, **payload.model_dump(), "email": payload.email.lower(), "createdAt": member["created_at"]}


@app.delete("/api/members/{member_id}", status_code=204)
def delete_member(member_id: str):
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
        if not member:
            raise HTTPException(404, "Member not found")
        if member["role"] == "owner" and con.execute("SELECT COUNT(*) n FROM workspace_members WHERE role='owner'").fetchone()["n"] <= 1:
            raise HTTPException(409, "The final workspace owner cannot be deleted")
        con.execute("DELETE FROM workspace_members WHERE id=?", (member_id,))


@app.get("/api/backup")
def backup_workspace():
    archive = EXPORTS / f"visionflow-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(DB_PATH, "visionflow.db")
        for root in (UPLOADS, VERSIONS, RUNS):
            for path in root.rglob("*"):
                if path.is_file():
                    bundle.write(path, Path(root.name) / path.relative_to(root))
        bundle.writestr("manifest.json", json.dumps({"createdAt": now(), "version": app.version, "root": str(ROOT)}, indent=2))
    return FileResponse(archive, media_type="application/zip", filename=archive.name)


@app.post("/api/restore")
async def restore_workspace(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > 4 * 1024 * 1024 * 1024:
        raise HTTPException(413, "Backup archive exceeds 4 GB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "Invalid backup ZIP") from exc
    validate_zip_size(archive, 20 * 1024 * 1024 * 1024)
    names = set(archive.namelist())
    if "visionflow.db" not in names or "manifest.json" not in names:
        raise HTTPException(400, "Not a VisionFlow backup")
    temporary_db = DATA / f"restore-{uid()}.db"
    temporary_db.write_bytes(archive.read("visionflow.db"))
    source: sqlite3.Connection | None = None
    try:
        source = sqlite3.connect(temporary_db)
        tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"projects", "assets", "versions", "models", "workflows"}.issubset(tables):
            raise HTTPException(400, "Backup database schema is incomplete")
        safety_copy = DATA / f"visionflow-pre-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        shutil.copy2(DB_PATH, safety_copy)
        with db() as destination:
            source.backup(destination)
        roots = {"uploads": UPLOADS, "versions": VERSIONS, "runs": RUNS}
        for item in archive.infolist():
            parts = Path(item.filename).parts
            if item.is_dir() or not parts or parts[0] not in roots or ".." in parts:
                continue
            target = (roots[parts[0]] / Path(*parts[1:])).resolve()
            if roots[parts[0]].resolve() not in target.parents:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(item))
        return {"status": "restored", "safetyCopy": str(safety_copy), "projects": len(list_projects())}
    finally:
        if source is not None:
            source.close()
        temporary_db.unlink(missing_ok=True)


@app.get("/api/projects")
def list_projects():
    with db() as con:
        return [project_dict(con, row) for row in con.execute("SELECT * FROM projects ORDER BY rowid DESC")]


@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectCreate):
    if payload.type not in ProjectCreate.supported_types():
        raise HTTPException(400, "Unsupported project type")
    cleaned_classes = validate_class_names(payload.classes)
    project_id = payload.name.lower().strip()
    project_id = "-".join("".join(c if c.isalnum() else " " for c in project_id).split()) + "-" + uid()[:4]
    with db() as con:
        colors = {name: payload.colors.get(name, "#7457e8") for name in cleaned_classes}
        con.execute("INSERT INTO projects (id,name,type,description,created_at,classes,colors) VALUES (?,?,?,?,?,?,?)", (project_id, payload.name, payload.type, payload.description, now()[:10], json.dumps(cleaned_classes), json.dumps(colors)))
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        return project_dict(con, row)


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdatePayload):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    with db() as con:
        result = con.execute(
            "UPDATE projects SET name=?,description=? WHERE id=?",
            (name, payload.description.strip(), project_id),
        )
        if not result.rowcount:
            raise HTTPException(404, "Project not found")
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        model_ids = [row["id"] for row in con.execute("SELECT id FROM models WHERE project_id=?", (project_id,))]
        con.execute("DELETE FROM projects WHERE id=?", (project_id,))
    for root in (UPLOADS, VERSIONS):
        target = (root / project_id).resolve()
        if target.parent == root.resolve() and target.is_dir():
            shutil.rmtree(target)
    for model_id in model_ids:
        target = (RUNS / model_id).resolve()
        if target.parent == RUNS.resolve() and target.is_dir():
            shutil.rmtree(target)
    for archive in EXPORTS.glob(f"{project_id}-v*-*.zip"):
        if archive.resolve().parent == EXPORTS.resolve():
            archive.unlink()


@app.post("/api/projects/{project_id}/assets", status_code=201)
async def upload_assets(project_id: str, files: list[UploadFile] = File(...)):
    project_dir = UPLOADS / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    created = []
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        for incoming in files:
            media_type = incoming.content_type or ""
            if not (media_type.startswith("image/") or media_type.startswith("video/")):
                continue
            content = await incoming.read()
            limit = 500 * 1024 * 1024 if media_type.startswith("video/") else 20 * 1024 * 1024
            if len(content) > limit:
                raise HTTPException(413, f"{incoming.filename}: file exceeds the local size limit")
            if media_type.startswith("video/"):
                import cv2
                video_id = uid()
                suffix = Path(incoming.filename or "video.mp4").suffix.lower() or ".mp4"
                temporary = project_dir / f"video-{video_id}{suffix}"
                temporary.write_bytes(content)
                capture = cv2.VideoCapture(str(temporary))
                fps = max(1, round(capture.get(cv2.CAP_PROP_FPS) or 1))
                frame_index = 0
                extracted = 0
                while capture.isOpened() and extracted < 100:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if frame_index % fps == 0:
                        asset_id = uid()
                        target = project_dir / f"{asset_id}.jpg"
                        cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                        display_name = f"{Path(incoming.filename or 'video').stem}-frame-{frame_index:06d}.jpg"
                        con.execute("INSERT INTO assets (id,project_id,name,path,split,status,boxes) VALUES (?,?,?,?,?,?,?)", (asset_id, project_id, display_name, str(target), "train", "unannotated", "[]"))
                        created.append(asset_id)
                        extracted += 1
                    frame_index += 1
                capture.release()
                temporary.unlink(missing_ok=True)
                if not extracted:
                    raise HTTPException(400, f"{incoming.filename}: video contains no readable frames")
                continue
            try:
                with Image.open(io.BytesIO(content)) as image:
                    image.verify()
            except Exception as exc:
                raise HTTPException(400, f"{incoming.filename}: invalid image") from exc
            asset_id = uid()
            suffix = Path(incoming.filename or "image.jpg").suffix.lower() or ".jpg"
            target = project_dir / f"{asset_id}{suffix}"
            target.write_bytes(content)
            con.execute("INSERT INTO assets (id,project_id,name,path,split,status,boxes) VALUES (?,?,?,?,?,?,?)", (asset_id, project_id, incoming.filename or target.name, str(target), "train", "unannotated", "[]"))
            created.append(asset_id)
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.post("/api/projects/{project_id}/import/yolo", status_code=201)
async def import_yolo_dataset(project_id: str, file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > 2 * 1024 * 1024 * 1024:
        raise HTTPException(413, "Dataset archive exceeds 2 GB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "Invalid ZIP archive") from exc
    validate_zip_size(archive, 10 * 1024 * 1024 * 1024)
    safe_files = [item for item in archive.infolist() if not item.is_dir() and not Path(item.filename).is_absolute() and ".." not in Path(item.filename).parts]
    yaml_entry = next((item for item in safe_files if Path(item.filename).name in {"data.yaml", "data.yml"}), None)
    imported_classes: list[str] = []
    coco_data: dict[str, Any] | None = None
    labelme_documents: dict[str, dict[str, Any]] = {}
    voc_documents: dict[str, ET.Element] = {}
    cvat_images: dict[str, ET.Element] = {}
    if yaml_entry:
        import yaml
        config = yaml.safe_load(archive.read(yaml_entry)) or {}
        names = config.get("names", [])
        imported_classes = [str(names[key]) for key in sorted(names)] if isinstance(names, dict) else [str(name) for name in names]
    else:
        for item in (entry for entry in safe_files if Path(entry.filename).suffix.lower() == ".json"):
            try:
                document = json.loads(archive.read(item))
            except Exception:
                continue
            if isinstance(document, dict) and isinstance(document.get("images"), list) and isinstance(document.get("annotations"), list):
                coco_data = document
                imported_classes = [str(category["name"]) for category in sorted(document.get("categories", []), key=lambda category: category.get("id", 0))]
                break
            if isinstance(document, dict) and isinstance(document.get("shapes"), list):
                labelme_documents[Path(item.filename).stem] = document
                for shape in document["shapes"]:
                    name = str(shape.get("label", "object"))
                    if name not in imported_classes:
                        imported_classes.append(name)
        for item in (entry for entry in safe_files if Path(entry.filename).suffix.lower() == ".xml"):
            try:
                root = ET.fromstring(archive.read(item))
            except ET.ParseError:
                continue
            if root.tag == "annotation":
                filename = root.findtext("filename") or Path(item.filename).stem
                voc_documents[Path(filename).stem] = root
                for obj in root.findall("object"):
                    name = obj.findtext("name") or "object"
                    if name not in imported_classes:
                        imported_classes.append(name)
            elif root.tag == "annotations":
                for image_node in root.findall("image"):
                    cvat_images[Path(image_node.attrib.get("name", "")).name] = image_node
                    for shape in list(image_node):
                        name = shape.attrib.get("label", "object")
                        if name not in imported_classes:
                            imported_classes.append(name)
    image_entries = [item for item in safe_files if Path(item.filename).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}]
    if not image_entries:
        raise HTTPException(400, "No supported images found in archive")
    project_dir = UPLOADS / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        classes = validate_class_names(imported_classes or json.loads(project["classes"]))
        colors = json.loads(project["colors"] or "{}")
        palette = ["#ffcf4a", "#7a62ed", "#24c7bd", "#f06b9d", "#f0943f", "#4b9cff"]
        for index, name in enumerate(classes):
            colors.setdefault(name, palette[index % len(palette)])
        con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        filename_map = {Path(item.filename).with_suffix("").as_posix(): item for item in safe_files if Path(item.filename).suffix.lower() == ".txt"}
        for entry in image_entries:
            image_bytes = archive.read(entry)
            try:
                with Image.open(io.BytesIO(image_bytes)) as probe:
                    image_width, image_height = probe.size
                    probe.verify()
            except Exception:
                continue
            asset_id = uid()
            suffix = Path(entry.filename).suffix.lower()
            target = project_dir / f"{asset_id}{suffix}"
            target.write_bytes(image_bytes)
            path = Path(entry.filename)
            parts_lower = [part.lower() for part in path.parts]
            split = "valid" if "valid" in parts_lower or "val" in parts_lower else "test" if "test" in parts_lower else "train"
            candidates = [path.with_suffix("").as_posix(), Path(*[("labels" if part.lower() == "images" else part) for part in path.parts]).with_suffix("").as_posix()]
            label_entry = next((filename_map[candidate] for candidate in candidates if candidate in filename_map), None)
            boxes: list[dict[str, Any]] = []
            if coco_data:
                image_record = next((image for image in coco_data["images"] if Path(str(image.get("file_name", ""))).name == path.name), None)
                categories = {category.get("id"): str(category.get("name")) for category in coco_data.get("categories", [])}
                for annotation in (item for item in coco_data["annotations"] if image_record and item.get("image_id") == image_record.get("id")):
                    label = categories.get(annotation.get("category_id"), "object")
                    segmentation = annotation.get("segmentation") or []
                    if isinstance(segmentation, list) and segmentation and isinstance(segmentation[0], list) and len(segmentation[0]) >= 6:
                        raw = segmentation[0]
                        points = [{"x": raw[i]/image_width*100, "y": raw[i+1]/image_height*100} for i in range(0, len(raw)-1, 2)]
                        xs, ys = [point["x"] for point in points], [point["y"] for point in points]
                        boxes.append({"id": uid(), "type": "polygon", "label": label, "points": points, "x": min(xs), "y": min(ys), "w": max(xs)-min(xs), "h": max(ys)-min(ys)})
                    elif len(annotation.get("bbox", [])) >= 4:
                        x, y, width, height = annotation["bbox"][:4]
                        boxes.append({"id": uid(), "type": "box", "label": label, "x": x/image_width*100, "y": y/image_height*100, "w": width/image_width*100, "h": height/image_height*100})
            elif path.stem in labelme_documents:
                for shape in labelme_documents[path.stem]["shapes"]:
                    points = [{"x": float(point[0])/image_width*100, "y": float(point[1])/image_height*100} for point in shape.get("points", [])]
                    if len(points) < 2:
                        continue
                    xs, ys = [point["x"] for point in points], [point["y"] for point in points]
                    shape_type = shape.get("shape_type", "polygon")
                    boxes.append({"id": uid(), "type": "box" if shape_type == "rectangle" else "polygon", "label": str(shape.get("label", "object")), "points": points if shape_type != "rectangle" else None, "x": min(xs), "y": min(ys), "w": max(xs)-min(xs), "h": max(ys)-min(ys)})
            elif path.stem in voc_documents:
                for obj in voc_documents[path.stem].findall("object"):
                    bounds = obj.find("bndbox")
                    if bounds is None:
                        continue
                    x1, y1, x2, y2 = [float(bounds.findtext(name, "0")) for name in ("xmin", "ymin", "xmax", "ymax")]
                    boxes.append({"id": uid(), "type": "box", "label": obj.findtext("name") or "object", "x": x1/image_width*100, "y": y1/image_height*100, "w": (x2-x1)/image_width*100, "h": (y2-y1)/image_height*100})
            elif path.name in cvat_images:
                for shape in list(cvat_images[path.name]):
                    label = shape.attrib.get("label", "object")
                    if shape.tag == "box":
                        x1, y1, x2, y2 = [float(shape.attrib.get(name, 0)) for name in ("xtl", "ytl", "xbr", "ybr")]
                        boxes.append({"id": uid(), "type": "box", "label": label, "x": x1/image_width*100, "y": y1/image_height*100, "w": (x2-x1)/image_width*100, "h": (y2-y1)/image_height*100})
                    elif shape.tag == "polygon":
                        points = [{"x": float(pair.split(",")[0])/image_width*100, "y": float(pair.split(",")[1])/image_height*100} for pair in shape.attrib.get("points", "").split(";") if "," in pair]
                        if len(points) >= 3:
                            xs, ys = [point["x"] for point in points], [point["y"] for point in points]
                            boxes.append({"id": uid(), "type": "polygon", "label": label, "points": points, "x": min(xs), "y": min(ys), "w": max(xs)-min(xs), "h": max(ys)-min(ys)})
            elif label_entry:
                for line in archive.read(label_entry).decode("utf-8", errors="ignore").splitlines():
                    values = line.split()
                    if len(values) < 5:
                        continue
                    try:
                        class_id = int(float(values[0]))
                        coordinates = [float(value) for value in values[1:]]
                    except ValueError:
                        continue
                    if not 0 <= class_id < len(classes):
                        continue
                    if len(coordinates) == 4:
                        cx, cy, width, height = coordinates
                        boxes.append({"id": uid(), "type": "box", "label": classes[class_id], "x": (cx-width/2)*100, "y": (cy-height/2)*100, "w": width*100, "h": height*100})
                    elif len(coordinates) >= 6 and len(coordinates) % 2 == 0:
                        points = [{"x": coordinates[i]*100, "y": coordinates[i+1]*100} for i in range(0, len(coordinates), 2)]
                        xs, ys = [point["x"] for point in points], [point["y"] for point in points]
                        boxes.append({"id": uid(), "type": "polygon", "label": classes[class_id], "points": points, "x": min(xs), "y": min(ys), "w": max(xs)-min(xs), "h": max(ys)-min(ys)})
            con.execute("INSERT INTO assets (id,project_id,name,path,split,status,boxes,split_locked) VALUES (?,?,?,?,?,?,?,1)", (asset_id, project_id, path.name, str(target), split, "annotated" if boxes else "unannotated", json.dumps(boxes)))
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.put("/api/projects/{project_id}/assets/{asset_id}/split")
def update_asset_split(project_id: str, asset_id: str, payload: SplitPayload):
    with db() as con:
        result = con.execute("UPDATE assets SET split=?,split_locked=1 WHERE id=? AND project_id=?", (payload.split, asset_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Asset not found")
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.post("/api/projects/{project_id}/assets/bulk")
def bulk_update_assets(project_id: str, payload: BulkAssetPayload):
    unique_ids = list(dict.fromkeys(payload.ids))
    placeholders = ",".join("?" for _ in unique_ids)
    files_to_remove: list[str] = []
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        rows = con.execute(
            f"SELECT id,path FROM assets WHERE project_id=? AND id IN ({placeholders})",
            (project_id, *unique_ids),
        ).fetchall()
        if len(rows) != len(unique_ids):
            raise HTTPException(404, "One or more images were not found")
        if payload.action == "split":
            if payload.value not in {"train", "valid", "test"}:
                raise HTTPException(400, "Bulk split must be train, valid, or test")
            con.execute(
                f"UPDATE assets SET split=?,split_locked=1 WHERE project_id=? AND id IN ({placeholders})",
                (payload.value, project_id, *unique_ids),
            )
        elif payload.action == "review":
            if payload.value not in {"pending", "approved", "needs-fix"}:
                raise HTTPException(400, "Bulk review must be pending, approved, or needs-fix")
            con.execute(
                f"UPDATE assets SET review_status=? WHERE project_id=? AND id IN ({placeholders})",
                (payload.value, project_id, *unique_ids),
            )
        else:
            files_to_remove = [row["path"] for row in rows]
            con.execute(
                f"DELETE FROM assets WHERE project_id=? AND id IN ({placeholders})",
                (project_id, *unique_ids),
            )
        updated = project_dict(con, project)
    project_root = (UPLOADS / project_id).resolve()
    for filename in files_to_remove:
        target = Path(filename).resolve()
        if target.parent == project_root and target.is_file():
            target.unlink()
    return updated


@app.get("/files/{asset_id}")
def asset_file(asset_id: str):
    with db() as con:
        row = con.execute("SELECT path FROM assets WHERE id=?", (asset_id,)).fetchone()
    path = Path(row["path"]).resolve() if row else None
    if not path or UPLOADS.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


@app.delete("/api/projects/{project_id}/assets/{asset_id}", status_code=204)
def delete_asset(project_id: str, asset_id: str):
    with db() as con:
        row = con.execute("SELECT path FROM assets WHERE id=? AND project_id=?", (asset_id, project_id)).fetchone()
        if not row:
            raise HTTPException(404, "Asset not found")
        con.execute("DELETE FROM assets WHERE id=?", (asset_id,))
    target = Path(row["path"]).resolve()
    project_root = (UPLOADS / project_id).resolve()
    if target.parent == project_root and target.is_file():
        target.unlink()


@app.put("/api/projects/{project_id}/assets/{asset_id}/annotations")
def save_annotations(project_id: str, asset_id: str, payload: AnnotationPayload):
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        classes = set(json.loads(project["classes"]))
        boxes = []
        allowed_types = {"box", "polygon", "obb", "keypoint", "classification"}
        for box in payload.boxes:
            item = dict(box.model_dump(), id=box.id or uid())
            if item["label"] not in classes:
                raise HTTPException(400, f"Unknown annotation class: {item['label']}")
            if item["type"] not in allowed_types:
                raise HTTPException(400, f"Unsupported annotation type: {item['type']}")
            if item["w"] <= 0 or item["h"] <= 0 or item["x"] < 0 or item["y"] < 0 or item["x"] + item["w"] > 100.0001 or item["y"] + item["h"] > 100.0001:
                raise HTTPException(400, "Annotation bounds must be positive and stay inside the image")
            points = item.get("points") or []
            if any(point.get("x", -1) < 0 or point.get("x", 101) > 100 or point.get("y", -1) < 0 or point.get("y", 101) > 100 for point in points):
                raise HTTPException(400, "Annotation points must stay inside the image")
            if item["type"] == "polygon" and len(points) < 3:
                raise HTTPException(400, "Polygon annotations require at least three points")
            if item["type"] == "obb" and len(points) != 4:
                raise HTTPException(400, "Oriented bounding boxes require exactly four points")
            if item["type"] == "keypoint" and not points:
                raise HTTPException(400, "Keypoint annotations require at least one point")
            boxes.append(item)
        result = con.execute("UPDATE assets SET boxes=?, status=? WHERE id=? AND project_id=?", (json.dumps(boxes), "annotated" if boxes else "unannotated", asset_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Asset not found")
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.put("/api/projects/{project_id}/classes")
def save_classes(project_id: str, payload: ClassesPayload):
    classes = validate_class_names(payload.classes)
    with db() as con:
        colors = {name: payload.colors.get(name, "#7457e8") for name in classes}
        result = con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        if not result.rowcount:
            raise HTTPException(404, "Project not found")
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.post("/api/projects/{project_id}/classes")
def add_class(project_id: str, payload: ClassCreatePayload):
    name = validate_class_names([payload.name])[0]
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        classes = json.loads(row["classes"])
        if name in classes:
            raise HTTPException(409, "Class already exists")
        colors = json.loads(row["colors"] or "{}")
        classes.append(name)
        colors[name] = payload.color
        con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.put("/api/projects/{project_id}/classes/{old_name}")
def rename_class(project_id: str, old_name: str, payload: ClassRenamePayload):
    new_name = validate_class_names([payload.name])[0]
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        classes = json.loads(row["classes"])
        if old_name not in classes:
            raise HTTPException(404, "Class not found")
        if new_name != old_name and new_name in classes:
            raise HTTPException(409, "Class already exists")
        colors = json.loads(row["colors"] or "{}")
        classes[classes.index(old_name)] = new_name
        colors.pop(old_name, None)
        colors[new_name] = payload.color
        for asset in con.execute("SELECT id,boxes FROM assets WHERE project_id=?", (project_id,)):
            boxes = json.loads(asset["boxes"])
            changed = False
            for box in boxes:
                if box["label"] == old_name:
                    box["label"] = new_name
                    changed = True
            if changed:
                con.execute("UPDATE assets SET boxes=? WHERE id=?", (json.dumps(boxes), asset["id"]))
        con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.delete("/api/projects/{project_id}/classes/{class_name}")
def delete_class(project_id: str, class_name: str):
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        classes = json.loads(row["classes"])
        if class_name not in classes:
            raise HTTPException(404, "Class not found")
        if len(classes) == 1:
            raise HTTPException(409, "A project must keep at least one class")
        usage = 0
        for asset in con.execute("SELECT boxes FROM assets WHERE project_id=?", (project_id,)):
            usage += sum(box.get("label") == class_name for box in json.loads(asset["boxes"]))
        if usage:
            raise HTTPException(409, f"Class is used by {usage} annotation(s); remove or relabel them first")
        classes.remove(class_name)
        colors = json.loads(row["colors"] or "{}")
        colors.pop(class_name, None)
        con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


def _setting(recipe: dict[str, dict[str, Any]], name: str) -> dict[str, Any]:
    value = recipe.get(name, {})
    return value if isinstance(value, dict) else {}


def _enabled(rng: random.Random, recipe: dict[str, dict[str, Any]], name: str) -> bool:
    setting = _setting(recipe, name)
    return bool(setting.get("enabled")) and rng.random() <= max(0.0, min(1.0, float(setting.get("probability", 1))))


def _amount(recipe: dict[str, dict[str, Any]], name: str, fallback: float) -> float:
    try:
        return float(_setting(recipe, name).get("amount", fallback))
    except (TypeError, ValueError):
        return fallback


def _affine_image_boxes(image: Image.Image, boxes: list[dict[str, Any]], matrix: Any) -> tuple[Image.Image, list[dict[str, Any]]]:
    import cv2
    import numpy as np

    width, height = image.size
    pixels = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    warped = cv2.warpAffine(pixels, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(114, 114, 114))
    transformed: list[dict[str, Any]] = []
    for box in boxes:
        if box.get("points"):
            polygon = np.array([[point["x"] * width / 100, point["y"] * height / 100, 1] for point in box["points"]], dtype=np.float32)
            polygon = polygon @ np.asarray(matrix, dtype=np.float32).T
            polygon[:, 0] = np.clip(polygon[:, 0], 0, width)
            polygon[:, 1] = np.clip(polygon[:, 1], 0, height)
            if len(polygon) >= 3:
                x1, y1, x2, y2 = float(polygon[:, 0].min()), float(polygon[:, 1].min()), float(polygon[:, 0].max()), float(polygon[:, 1].max())
                if x2 - x1 >= 2 and y2 - y1 >= 2:
                    transformed.append({**box, "x": x1 / width * 100, "y": y1 / height * 100, "w": (x2 - x1) / width * 100, "h": (y2 - y1) / height * 100, "points": [{"x": float(point[0]) / width * 100, "y": float(point[1]) / height * 100} for point in polygon]})
            continue
        left, top = box["x"] * width / 100, box["y"] * height / 100
        right, bottom = (box["x"] + box["w"]) * width / 100, (box["y"] + box["h"]) * height / 100
        corners = np.array([[left, top, 1], [right, top, 1], [right, bottom, 1], [left, bottom, 1]], dtype=np.float32)
        points = corners @ np.asarray(matrix, dtype=np.float32).T
        x1, y1 = max(0.0, float(points[:, 0].min())), max(0.0, float(points[:, 1].min()))
        x2, y2 = min(float(width), float(points[:, 0].max())), min(float(height), float(points[:, 1].max()))
        if x2 - x1 >= 2 and y2 - y1 >= 2:
            transformed.append({**box, "x": x1 / width * 100, "y": y1 / height * 100, "w": (x2 - x1) / width * 100, "h": (y2 - y1) / height * 100})
    return Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)), transformed


def apply_augmentation(image: Image.Image, boxes: list[dict[str, Any]], recipe: dict[str, dict[str, Any]], rng: random.Random) -> tuple[Image.Image, list[dict[str, Any]]]:
    """Apply a deterministic augmentation chain and keep detection boxes synchronized."""
    import cv2
    import numpy as np

    result, output_boxes = image.copy(), [dict(box) for box in boxes]
    width, height = result.size
    if _enabled(rng, recipe, "horizontalFlip"):
        result = ImageOps.mirror(result)
        output_boxes = [{**box, "x": 100 - box["x"] - box["w"], "points": [{"x": 100-point["x"], "y": point["y"]} for point in box["points"]] if box.get("points") else None} for box in output_boxes]
    if _enabled(rng, recipe, "verticalFlip"):
        result = ImageOps.flip(result)
        output_boxes = [{**box, "y": 100 - box["y"] - box["h"], "points": [{"x": point["x"], "y": 100-point["y"]} for point in box["points"]] if box.get("points") else None} for box in output_boxes]
    if _enabled(rng, recipe, "rotate"):
        angle = rng.uniform(-abs(_amount(recipe, "rotate", 15)), abs(_amount(recipe, "rotate", 15)))
        result, output_boxes = _affine_image_boxes(result, output_boxes, cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1))
    if _enabled(rng, recipe, "translate"):
        limit = abs(_amount(recipe, "translate", 10)) / 100
        dx, dy = rng.uniform(-limit, limit) * width, rng.uniform(-limit, limit) * height
        result, output_boxes = _affine_image_boxes(result, output_boxes, np.array([[1, 0, dx], [0, 1, dy]], dtype=np.float32))
    if _enabled(rng, recipe, "shear"):
        shear = abs(_amount(recipe, "shear", 10))
        sx, sy = np.tan(np.radians(rng.uniform(-shear, shear))), np.tan(np.radians(rng.uniform(-shear, shear)))
        matrix = np.array([[1, sx, -sx * height / 2], [sy, 1, -sy * width / 2]], dtype=np.float32)
        result, output_boxes = _affine_image_boxes(result, output_boxes, matrix)
    if _enabled(rng, recipe, "crop"):
        max_crop = max(0.0, min(45.0, abs(_amount(recipe, "crop", 15)))) / 100
        crop_left, crop_right = rng.uniform(0, max_crop) * width, rng.uniform(0, max_crop) * width
        crop_top, crop_bottom = rng.uniform(0, max_crop) * height, rng.uniform(0, max_crop) * height
        crop_width, crop_height = max(2.0, width - crop_left - crop_right), max(2.0, height - crop_top - crop_bottom)
        cropped_boxes = []
        for box in output_boxes:
            if box.get("points"):
                points = [{"x": max(0.0, min(100.0, (point["x"] * width / 100 - crop_left) / crop_width * 100)), "y": max(0.0, min(100.0, (point["y"] * height / 100 - crop_top) / crop_height * 100))} for point in box["points"]]
                x_values, y_values = [point["x"] for point in points], [point["y"] for point in points]
                if len(points) >= 3 and max(x_values) - min(x_values) > .5 and max(y_values) - min(y_values) > .5:
                    cropped_boxes.append({**box, "x": min(x_values), "y": min(y_values), "w": max(x_values)-min(x_values), "h": max(y_values)-min(y_values), "points": points})
                continue
            x1, y1 = box["x"] * width / 100, box["y"] * height / 100
            x2, y2 = (box["x"] + box["w"]) * width / 100, (box["y"] + box["h"]) * height / 100
            x1, y1, x2, y2 = max(x1, crop_left), max(y1, crop_top), min(x2, width - crop_right), min(y2, height - crop_bottom)
            if x2 - x1 >= 2 and y2 - y1 >= 2:
                cropped_boxes.append({**box, "x": (x1 - crop_left) / crop_width * 100, "y": (y1 - crop_top) / crop_height * 100, "w": (x2 - x1) / crop_width * 100, "h": (y2 - y1) / crop_height * 100})
        result = result.crop((round(crop_left), round(crop_top), round(width - crop_right), round(height - crop_bottom))).resize((width, height), Image.Resampling.LANCZOS)
        output_boxes = cropped_boxes
    if _enabled(rng, recipe, "brightness"):
        value = abs(_amount(recipe, "brightness", 20)) / 100
        result = ImageEnhance.Brightness(result).enhance(rng.uniform(max(0.1, 1 - value), 1 + value))
    if _enabled(rng, recipe, "contrast"):
        value = abs(_amount(recipe, "contrast", 20)) / 100
        result = ImageEnhance.Contrast(result).enhance(rng.uniform(max(0.1, 1 - value), 1 + value))
    if _enabled(rng, recipe, "saturation"):
        value = abs(_amount(recipe, "saturation", 25)) / 100
        result = ImageEnhance.Color(result).enhance(rng.uniform(max(0, 1 - value), 1 + value))
    if _enabled(rng, recipe, "hue"):
        hsv = np.asarray(result.convert("HSV")).copy()
        shift = round(rng.uniform(-abs(_amount(recipe, "hue", 12)), abs(_amount(recipe, "hue", 12))) / 360 * 255)
        hsv[:, :, 0] = (hsv[:, :, 0].astype(np.int16) + shift) % 256
        result = Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")
    if _enabled(rng, recipe, "grayscale"):
        result = ImageOps.grayscale(result).convert("RGB")
    if _enabled(rng, recipe, "blur"):
        result = result.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, max(0.2, abs(_amount(recipe, "blur", 1.5))))))
    if _enabled(rng, recipe, "sharpen"):
        result = ImageEnhance.Sharpness(result).enhance(1 + rng.uniform(0.2, max(0.2, abs(_amount(recipe, "sharpen", 1.5)))))
    if _enabled(rng, recipe, "noise"):
        pixels = np.asarray(result).astype(np.float32)
        noise = np.random.default_rng(rng.randrange(2**32)).normal(0, abs(_amount(recipe, "noise", 12)), pixels.shape)
        result = Image.fromarray(np.clip(pixels + noise, 0, 255).astype(np.uint8))
    if _enabled(rng, recipe, "cutout"):
        size = max(2, round(min(width, height) * min(60, abs(_amount(recipe, "cutout", 18))) / 100))
        x, y = rng.randrange(max(1, width - size + 1)), rng.randrange(max(1, height - size + 1))
        pixels = np.asarray(result).copy()
        pixels[y:y + size, x:x + size] = 114
        result = Image.fromarray(pixels)
    if _enabled(rng, recipe, "jpeg"):
        quality = round(max(15, min(95, _amount(recipe, "jpeg", 55))))
        buffer = io.BytesIO()
        result.save(buffer, "JPEG", quality=quality)
        buffer.seek(0)
        result = Image.open(buffer).convert("RGB")
    return result, output_boxes


def assign_asset_splits(assets: list[sqlite3.Row], splits: tuple[int, int, int], seed: int) -> dict[str, str]:
    names = ("train", "valid", "test")
    total = len(assets)
    desired = {
        "train": round(total * splits[0] / 100),
        "valid": round(total * splits[1] / 100),
    }
    desired["test"] = total - desired["train"] - desired["valid"]
    assigned = {asset["id"]: asset["split"] for asset in assets if asset["split_locked"] and asset["split"] in names}
    counts = {name: sum(value == name for value in assigned.values()) for name in names}
    unlocked = [asset for asset in assets if asset["id"] not in assigned]
    random.Random(seed).shuffle(unlocked)
    for asset in unlocked:
        split = max(names, key=lambda name: desired[name] - counts[name])
        assigned[asset["id"]] = split
        counts[split] += 1
    return assigned


def make_yolo_version(con: sqlite3.Connection, project_id: str, version_no: int, payload: VersionPayload) -> tuple[Path, int]:
    project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    assets = list(con.execute("SELECT * FROM assets WHERE project_id=?", (project_id,)))
    classes = validate_class_names(json.loads(project["classes"]))
    target = VERSIONS / project_id / f"v{version_no}"
    if sum(payload.splits) != 100:
        raise HTTPException(400, "Dataset splits must total 100")
    if any(value < 0 or value > 100 for value in payload.splits):
        raise HTTPException(400, "Each dataset split must be between 0 and 100")
    for split in ("train", "valid", "test"):
        (target / "images" / split).mkdir(parents=True, exist_ok=True)
        (target / "labels" / split).mkdir(parents=True, exist_ok=True)
    assigned_splits = assign_asset_splits(assets, payload.splits, version_no)
    written: dict[str, list[tuple[Path, Path]]] = {"train": [], "valid": [], "test": []}

    def label_lines(boxes: list[dict[str, Any]]) -> str:
        lines = []
        for box in boxes:
            if box["label"] not in classes:
                continue
            if project["type"] == "Keypoint Detection":
                points = box.get("points") or []
                if not points:
                    continue
                cx = (box["x"] + box["w"] / 2) / 100
                cy = (box["y"] + box["h"] / 2) / 100
                keypoints = " ".join(f"{point['x']/100:.6f} {point['y']/100:.6f} {int(point.get('visibility', 2))}" for point in points)
                lines.append(f"{classes.index(box['label'])} {cx:.6f} {cy:.6f} {box['w']/100:.6f} {box['h']/100:.6f} {keypoints}")
                continue
            if box.get("points") and len(box["points"]) >= 3:
                if project["type"] == "Oriented Bounding Box" and len(box["points"]) != 4:
                    continue
                coordinates = " ".join(f"{point['x']/100:.6f} {point['y']/100:.6f}" for point in box["points"])
                lines.append(f"{classes.index(box['label'])} {coordinates}")
                continue
            cx = (box["x"] + box["w"] / 2) / 100
            cy = (box["y"] + box["h"] / 2) / 100
            lines.append(f"{classes.index(box['label'])} {cx:.6f} {cy:.6f} {box['w']/100:.6f} {box['h']/100:.6f}")
        return "\n".join(lines)

    def save_example(image: Image.Image, boxes: list[dict[str, Any]], split: str, stem: str) -> None:
        image_path = target / "images" / split / f"{stem}.jpg"
        label_path = target / "labels" / split / f"{stem}.txt"
        image.save(image_path, "JPEG", quality=92)
        label_path.write_text(label_lines(boxes), encoding="utf-8")
        written[split].append((image_path, label_path))

    for asset in assets:
        split = assigned_splits[asset["id"]]
        source = Path(asset["path"])
        boxes = json.loads(asset["boxes"])
        with Image.open(source) as raw:
            image = ImageOps.exif_transpose(raw).convert("RGB").resize((payload.resize, payload.resize), Image.Resampling.LANCZOS)
            save_example(image, boxes, split, asset["id"])
            if payload.augment and split == "train":
                if payload.augmentations:
                    for copy_index in range(payload.augmentation_copies):
                        augmented, augmented_boxes = apply_augmentation(image, boxes, payload.augmentations, random.Random(f"{version_no}:{asset['id']}:{copy_index}"))
                        save_example(augmented, augmented_boxes, split, f"{asset['id']}-aug-{copy_index + 1:02d}")
                else:
                    flipped_boxes = [{**box, "x": 100 - box["x"] - box["w"]} for box in boxes]
                    save_example(ImageOps.mirror(image), flipped_boxes, split, f"{asset['id']}-flip")
                    save_example(ImageEnhance.Brightness(image).enhance(1.18), boxes, split, f"{asset['id']}-bright")
    if not written["valid"] and written["train"]:
        image_path, label_path = written["train"][0]
        shutil.copy2(image_path, target / "images" / "valid" / image_path.name)
        shutil.copy2(label_path, target / "labels" / "valid" / label_path.name)
    yaml_text = f"path: {target.as_posix()}\ntrain: images/train\nval: images/valid\ntest: images/test\nnames:\n"
    yaml_text += "".join(f"  {i}: {json.dumps(label)}\n" for i, label in enumerate(classes))
    if project["type"] == "Keypoint Detection":
        keypoint_count = max((len(box.get("points") or []) for asset in assets for box in json.loads(asset["boxes"])), default=1)
        yaml_text += f"kpt_shape: [{keypoint_count}, 3]\n"
    (target / "data.yaml").write_text(yaml_text, encoding="utf-8")
    return target, sum(len(items) for items in written.values())


def make_classification_version(con: sqlite3.Connection, project_id: str, version_no: int, payload: VersionPayload) -> tuple[Path, int]:
    """Build the folder-per-class layout consumed by Ultralytics classifiers."""
    project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    assets = list(con.execute("SELECT * FROM assets WHERE project_id=?", (project_id,)))
    classes = validate_class_names(json.loads(project["classes"]))
    if sum(payload.splits) != 100:
        raise HTTPException(400, "Dataset splits must total 100")
    target = VERSIONS / project_id / f"v{version_no}"
    for split in ("train", "valid", "test"):
        for class_name in classes:
            (target / split / class_name).mkdir(parents=True, exist_ok=True)
    assigned_splits = assign_asset_splits(assets, payload.splits, version_no)
    written = 0
    for asset in assets:
        labels = list(dict.fromkeys(box.get("label") for box in json.loads(asset["boxes"]) if box.get("label") in classes))
        if not labels:
            continue
        if project["type"] == "Single-Label Classification":
            labels = labels[:1]
        split = assigned_splits[asset["id"]]
        with Image.open(asset["path"]) as raw:
            image = ImageOps.exif_transpose(raw).convert("RGB").resize((payload.resize, payload.resize), Image.Resampling.LANCZOS)
            for label_index, label in enumerate(labels):
                suffix = f"-{label_index}" if label_index else ""
                image.save(target / split / label / f"{asset['id']}{suffix}.jpg", "JPEG", quality=92)
                written += 1
                if payload.augment and split == "train":
                    for copy_index in range(payload.augmentation_copies if payload.augmentations else 1):
                        augmented, _ = apply_augmentation(image, [], payload.augmentations, random.Random(f"{version_no}:{asset['id']}:{label}:{copy_index}")) if payload.augmentations else (ImageOps.mirror(image), [])
                        augmented.save(target / split / label / f"{asset['id']}{suffix}-aug-{copy_index + 1:02d}.jpg", "JPEG", quality=92)
                        written += 1
    (target / "classification.json").write_text(json.dumps({"task": project["type"], "classes": classes, "splits": payload.splits}, indent=2), encoding="utf-8")
    return target, written


@app.post("/api/projects/{project_id}/versions", status_code=201)
def generate_version(project_id: str, payload: VersionPayload):
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        count = con.execute("SELECT COUNT(*) n FROM assets WHERE project_id=?", (project_id,)).fetchone()["n"]
        if not count:
            raise HTTPException(400, "Upload at least one image first")
        version_no = con.execute("SELECT COALESCE(MAX(number),0)+1 n FROM versions WHERE project_id=?", (project_id,)).fetchone()["n"]
        if project["type"] in {"Single-Label Classification", "Multi-Label Classification"}:
            target, generated_images = make_classification_version(con, project_id, version_no, payload)
        else:
            target, generated_images = make_yolo_version(con, project_id, version_no, payload)
        version_id = uid()
        con.execute("INSERT INTO versions (id,project_id,number,created_at,images,resize,augment,splits,path,augmentations,generated_images) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (version_id, project_id, version_no, now()[:10], count, payload.resize, int(payload.augment), json.dumps(payload.splits), str(target), json.dumps({"copies": payload.augmentation_copies, "transforms": payload.augmentations}), generated_images))
        return project_dict(con, project)


@app.put("/api/projects/{project_id}/assets/{asset_id}/review")
def update_asset_review(project_id: str, asset_id: str, payload: ReviewPayload):
    with db() as con:
        result = con.execute("UPDATE assets SET review_status=? WHERE id=? AND project_id=?", (payload.status, asset_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Image not found")
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, project)


@app.post("/api/projects/{project_id}/assets/interpolate")
def interpolate_annotations(project_id: str, payload: InterpolatePayload):
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        assets = list(con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (project_id,)))
        positions = {asset["id"]: index for index, asset in enumerate(assets)}
        if payload.start_asset_id not in positions or payload.end_asset_id not in positions:
            raise HTTPException(404, "Interpolation endpoint frame not found")
        start_index, end_index = positions[payload.start_asset_id], positions[payload.end_asset_id]
        if end_index - start_index < 2:
            raise HTTPException(400, "Choose annotated endpoints with at least one frame between them")
        start_boxes, end_boxes = json.loads(assets[start_index]["boxes"]), json.loads(assets[end_index]["boxes"])
        if not start_boxes or not end_boxes:
            raise HTTPException(400, "Both endpoint frames must be annotated")
        end_by_label: dict[str, list[dict[str, Any]]] = {}
        for box in end_boxes:
            end_by_label.setdefault(box["label"], []).append(box)
        used: dict[str, int] = {}
        pairs = []
        for start_box in start_boxes:
            ordinal = used.get(start_box["label"], 0)
            candidates = end_by_label.get(start_box["label"], [])
            if ordinal < len(candidates):
                pairs.append((start_box, candidates[ordinal]))
                used[start_box["label"]] = ordinal + 1
        if not pairs:
            raise HTTPException(400, "Endpoint frames have no matching classes")
        for frame_index in range(start_index + 1, end_index):
            ratio = (frame_index - start_index) / (end_index - start_index)
            generated = []
            for first, last in pairs:
                annotation = {**first, "id": uid()}
                for field in ("x", "y", "w", "h"):
                    annotation[field] = round(float(first[field]) + (float(last[field]) - float(first[field])) * ratio, 5)
                first_points, last_points = first.get("points") or [], last.get("points") or []
                if first_points and len(first_points) == len(last_points):
                    annotation["points"] = [{"x": round(a["x"] + (b["x"] - a["x"]) * ratio, 5), "y": round(a["y"] + (b["y"] - a["y"]) * ratio, 5), **({"visibility": a.get("visibility", 2)} if "visibility" in a else {})} for a, b in zip(first_points, last_points)]
                generated.append(annotation)
            con.execute("UPDATE assets SET boxes=?,status='annotated',review_status='pending' WHERE id=?", (json.dumps(generated), assets[frame_index]["id"]))
        return project_dict(con, project)


@app.get("/api/projects/{project_id}/versions/{version_id}/export")
def export_version(project_id: str, version_id: str, format: str = "yolo"):
    with db() as con:
        version = con.execute("SELECT v.*,p.type project_type FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND v.project_id=?", (version_id, project_id)).fetchone()
    if not version:
        raise HTTPException(404, "Dataset version not found")
    source = Path(version["path"]).resolve()
    if source.parent != (VERSIONS / project_id).resolve() or not source.is_dir():
        raise HTTPException(404, "Version files are unavailable")
    if format.lower() not in {"yolo", "coco"}:
        raise HTTPException(400, "Supported export formats: yolo, coco")
    if version["project_type"] in {"Single-Label Classification", "Multi-Label Classification"}:
        archive = Path(shutil.make_archive(str(EXPORTS / f"{project_id}-v{version['number']}-classification"), "zip", root_dir=source))
        return FileResponse(archive, media_type="application/zip", filename=archive.name)
    archive_base = EXPORTS / f"{project_id}-v{version['number']}-{format.lower()}"
    if format.lower() == "yolo":
        archive = Path(shutil.make_archive(str(archive_base), "zip", root_dir=source))
    else:
        import yaml
        config = yaml.safe_load((source / "data.yaml").read_text(encoding="utf-8"))
        names_raw = config.get("names", {})
        names = [names_raw[key] for key in sorted(names_raw)] if isinstance(names_raw, dict) else list(names_raw)
        coco: dict[str, Any] = {
            "info": {"description": f"VisionFlow {project_id} dataset v{version['number']}", "version": str(version["number"])},
            "licenses": [], "images": [], "annotations": [],
            "categories": [{"id": index + 1, "name": name, "supercategory": "object"} for index, name in enumerate(names)],
        }
        annotation_id = 1
        image_id = 1
        archive = archive_base.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for split in ("train", "valid", "test"):
                for image_path in sorted((source / "images" / split).glob("*")):
                    if not image_path.is_file():
                        continue
                    with Image.open(image_path) as image:
                        width, height = image.size
                    archive_name = f"images/{split}/{image_path.name}"
                    bundle.write(image_path, archive_name)
                    coco["images"].append({"id": image_id, "file_name": archive_name, "width": width, "height": height, "split": split})
                    label_path = source / "labels" / split / f"{image_path.stem}.txt"
                    if label_path.is_file():
                        for line in label_path.read_text(encoding="utf-8").splitlines():
                            if not line.strip():
                                continue
                            values = list(map(float, line.split()))
                            class_id = values[0]
                            if len(values) > 5:
                                polygon = [round(value * (width if index % 2 == 0 else height), 3) for index, value in enumerate(values[1:])]
                                xs, ys = polygon[0::2], polygon[1::2]
                                x, y, box_w_px, box_h_px = min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys)
                                segmentation = [polygon]
                            else:
                                _, cx, cy, box_width, box_height = values
                                box_w_px, box_h_px = box_width * width, box_height * height
                                x = (cx - box_width / 2) * width
                                y = (cy - box_height / 2) * height
                                segmentation = []
                            coco["annotations"].append({"id": annotation_id, "image_id": image_id, "category_id": int(class_id) + 1, "bbox": [round(x, 3), round(y, 3), round(box_w_px, 3), round(box_h_px, 3)], "area": round(box_w_px * box_h_px, 3), "iscrowd": 0, "segmentation": segmentation})
                            annotation_id += 1
                    image_id += 1
            bundle.writestr("annotations.json", json.dumps(coco, indent=2))
    return FileResponse(archive, media_type="application/zip", filename=archive.name)


@app.delete("/api/projects/{project_id}/versions/{version_id}", status_code=204)
def delete_version(project_id: str, version_id: str):
    with db() as con:
        version = con.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (version_id, project_id)).fetchone()
        if not version:
            raise HTTPException(404, "Dataset version not found")
        active = con.execute("SELECT 1 FROM models WHERE project_id=? AND version=? AND status IN ('queued','training')", (project_id, version["number"])).fetchone()
        if active:
            raise HTTPException(409, "Cannot delete a version while it is training")
        con.execute("DELETE FROM versions WHERE id=?", (version_id,))
    target = Path(version["path"]).resolve()
    expected_parent = (VERSIONS / project_id).resolve()
    if target.parent == expected_parent and target.is_dir():
        shutil.rmtree(target)
    for archive in EXPORTS.glob(f"{project_id}-v{version['number']}-*.zip"):
        if archive.resolve().parent == EXPORTS.resolve():
            archive.unlink()


def train_worker(model_id: str, version_path: Path, payload: TrainPayload):
    try:
        from ultralytics import YOLO
        with db() as con:
            con.execute("UPDATE models SET progress=10 WHERE id=?", (model_id,))
        last_checkpoint = RUNS / model_id / "weights" / "last.pt"
        resume = last_checkpoint.is_file()
        model = YOLO(str(last_checkpoint) if resume else payload.architecture)
        cancel_event = TRAIN_CANCEL[model_id]

        def on_epoch_end(trainer):
            progress = 20 + round(((trainer.epoch + 1) / payload.epochs) * 75)
            with db() as callback_db:
                model_row = callback_db.execute("SELECT metrics_history FROM models WHERE id=?", (model_id,)).fetchone()
                history = json.loads(model_row["metrics_history"] or "[]") if model_row else []
                epoch_metrics = {key: round(float(value), 6) for key, value in (getattr(trainer, "metrics", {}) or {}).items() if isinstance(value, (int, float))}
                history.append({"epoch": trainer.epoch + 1, **epoch_metrics})
                callback_db.execute("UPDATE models SET progress=?,metrics_history=? WHERE id=?", (min(progress, 95), json.dumps(history), model_id))
            if cancel_event.is_set():
                trainer.stop = True

        model.add_callback("on_train_epoch_end", on_epoch_end)
        with db() as con:
            con.execute("UPDATE models SET progress=20 WHERE id=?", (model_id,))
        if resume:
            result = model.train(resume=True, device=None if payload.device == "auto" else payload.device, workers=0, plots=True)
        else:
            training_data = version_path if "-cls" in payload.architecture else version_path / "data.yaml"
            result = model.train(data=str(training_data), epochs=payload.epochs, imgsz=payload.image_size, batch=payload.batch_size, optimizer=payload.optimizer, lr0=payload.learning_rate, patience=payload.patience, device=None if payload.device == "auto" else payload.device, project=str(RUNS), name=model_id, exist_ok=True, verbose=False, workers=0, plots=True)
        if cancel_event.is_set():
            with db() as con:
                con.execute("UPDATE models SET status='cancelled',error='Cancelled by user' WHERE id=?", (model_id,))
            return
        metrics = result.results_dict
        weights = RUNS / model_id / "weights" / "best.pt"
        with db() as con:
            con.execute(
                "UPDATE models SET status='ready',progress=100,map=?,precision=?,recall=?,weights_path=? WHERE id=?",
                (round(float(metrics.get("metrics/accuracy_top1", metrics.get("metrics/mAP50(B)", metrics.get("metrics/mAP50(M)", 0))))*100, 1), round(float(metrics.get("metrics/precision(B)", metrics.get("metrics/precision(M)", 0)))*100, 1), round(float(metrics.get("metrics/recall(B)", metrics.get("metrics/recall(M)", 0)))*100, 1), str(weights), model_id)
            )
    except Exception as exc:
        with db() as con:
            con.execute("UPDATE models SET status='failed',error=? WHERE id=?", (str(exc)[:1000], model_id))
    finally:
        TRAIN_CANCEL.pop(model_id, None)
        schedule_training_jobs()


def schedule_training_jobs() -> None:
    """Start the oldest queued job, with one local training process at a time."""
    if not TRAIN_SCHEDULER_LOCK.acquire(blocking=False):
        return
    try:
        with db() as con:
            active = con.execute("SELECT 1 FROM models WHERE status='training' LIMIT 1").fetchone()
            if active:
                return
            queued = con.execute("SELECT m.*,v.path version_path FROM models m JOIN versions v ON v.project_id=m.project_id AND v.number=m.version WHERE m.status='queued' ORDER BY m.rowid LIMIT 1").fetchone()
            if not queued:
                return
            try:
                payload = TrainPayload.model_validate_json(queued["config"] or "{}")
            except Exception as exc:
                con.execute("UPDATE models SET status='failed',error=? WHERE id=?", (f"Invalid saved training configuration: {exc}"[:1000], queued["id"]))
                threading.Timer(0.05, schedule_training_jobs).start()
                return
            model_id = queued["id"]
            TRAIN_CANCEL[model_id] = threading.Event()
            con.execute("UPDATE models SET status='training',progress=MAX(progress,2),error=NULL WHERE id=?", (model_id,))
        threading.Thread(target=train_worker, args=(model_id, Path(queued["version_path"]), payload), daemon=True).start()
    finally:
        TRAIN_SCHEDULER_LOCK.release()


@app.on_event("startup")
def resume_training_queue() -> None:
    schedule_training_jobs()


@app.post("/api/projects/{project_id}/train", status_code=202)
def start_training(project_id: str, payload: TrainPayload):
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        active = con.execute("SELECT 1 FROM models WHERE project_id=? AND status IN ('queued','training')", (project_id,)).fetchone()
        if active:
            raise HTTPException(409, "A training job is already running for this project")
        if payload.version_id:
            version = con.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (payload.version_id, project_id)).fetchone()
            if not version:
                raise HTTPException(404, "Selected dataset version not found")
        else:
            version = con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1", (project_id,)).fetchone()
        if not version:
            raise HTTPException(400, "Generate a dataset version first")
        task_suffix = {
            "Object Detection": "detect", "Instance Segmentation": "segment", "Semantic Segmentation": "segment",
            "Oriented Bounding Box": "obb", "Keypoint Detection": "pose", "Single-Label Classification": "classify",
        }.get(project["type"])
        if project["type"] == "Multi-Label Classification":
            raise HTTPException(400, "Multi-label datasets can be annotated and exported; YOLO softmax checkpoints only support single-label training")
        architecture_task = "segment" if "-seg" in payload.architecture else "obb" if "-obb" in payload.architecture else "pose" if "-pose" in payload.architecture else "classify" if "-cls" in payload.architecture else "detect"
        if task_suffix != architecture_task:
            raise HTTPException(400, "Selected model task does not match the project type")
        if not re.match(r"^(yolo(26|12|11)[nslmx](-(seg|pose|obb|cls))?|yolov(10[nsmblx]|9[tsmce](-seg)?|8[nslmx](-(seg|pose|obb|cls))?|5[nslmx]u|3u|3-tinyu))\.pt$", payload.architecture):
            raise HTTPException(400, "Unsupported or unsafe model checkpoint name")
        annotated = con.execute("SELECT boxes FROM assets WHERE project_id=?", (project_id,)).fetchall()
        if not any(json.loads(row["boxes"]) for row in annotated):
            raise HTTPException(400, "Annotate at least one object before training")
        model_id = uid()
        display = payload.architecture.replace(".pt", "")
        con.execute("INSERT INTO models (id,project_id,name,version,status,progress,config,created_at,metrics_history) VALUES (?,?,?,?,?,?,?,?,?)", (model_id, project_id, display, version["number"], "queued", 0, payload.model_dump_json(), now(), "[]"))
        result = project_dict(con, project)
    schedule_training_jobs()
    return result


@app.post("/api/projects/{project_id}/models/{model_id}/cancel")
def cancel_training(project_id: str, model_id: str):
    event = TRAIN_CANCEL.get(model_id)
    with db() as con:
        model = con.execute("SELECT status FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
        if not model or model["status"] not in {"queued", "training"}:
            raise HTTPException(404, "Active training job not found")
        if model["status"] == "queued":
            con.execute("UPDATE models SET status='cancelled',error='Cancelled by user' WHERE id=?", (model_id,))
        elif event:
            event.set()
        else:
            raise HTTPException(409, "Training process is recovering; try again shortly")
    return {"status": "cancelling", "modelId": model_id}


@app.put("/api/projects/{project_id}/models/{model_id}")
def rename_model(project_id: str, model_id: str, payload: ModelRenamePayload):
    with db() as con:
        result = con.execute("UPDATE models SET name=? WHERE id=? AND project_id=?", (payload.name.strip(), model_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Model not found")
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, project)


@app.delete("/api/projects/{project_id}/models/{model_id}", status_code=204)
def delete_model(project_id: str, model_id: str):
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
        if not model:
            raise HTTPException(404, "Model not found")
        if model["status"] in {"queued", "training"}:
            raise HTTPException(409, "Cancel active training before deleting the model")
        con.execute("DELETE FROM models WHERE id=?", (model_id,))
    target = (RUNS / model_id).resolve()
    if target.parent == RUNS.resolve() and target.is_dir():
        shutil.rmtree(target)


@app.post("/api/projects/{project_id}/models/{model_id}/export")
def export_model(project_id: str, model_id: str, payload: ModelExportPayload):
    with db() as con:
        model_row = con.execute("SELECT * FROM models WHERE id=? AND project_id=? AND status='ready'", (model_id, project_id)).fetchone()
    if not model_row or not model_row["weights_path"] or not Path(model_row["weights_path"]).is_file():
        raise HTTPException(400, "A ready model with weights is required")
    from ultralytics import YOLO
    exported = Path(YOLO(model_row["weights_path"]).export(format=payload.format))
    if exported.is_dir():
        archive = Path(shutil.make_archive(str(EXPORTS / f"{project_id}-{model_id}-{payload.format}"), "zip", root_dir=exported))
        return FileResponse(archive, media_type="application/zip", filename=archive.name)
    return FileResponse(exported, filename=exported.name)


@app.get("/api/projects/{project_id}/models/{model_id}/evaluation/{artifact}")
def model_evaluation_artifact(project_id: str, model_id: str, artifact: str):
    allowed = {"results.png", "confusion_matrix.png", "confusion_matrix_normalized.png", "F1_curve.png", "PR_curve.png", "P_curve.png", "R_curve.png", "labels.jpg"}
    if artifact not in allowed:
        raise HTTPException(400, "Unsupported evaluation artifact")
    with db() as con:
        model = con.execute("SELECT 1 FROM models WHERE id=? AND project_id=? AND status='ready'", (model_id, project_id)).fetchone()
    path = (RUNS / model_id / artifact).resolve()
    if not model or path.parent != (RUNS / model_id).resolve() or not path.is_file():
        raise HTTPException(404, "Evaluation artifact is unavailable for this run")
    return FileResponse(path)


@app.get("/api/projects/{project_id}/deployment/keys")
def list_api_keys(project_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        rows = con.execute("SELECT id,name,prefix,created_at,last_used,revoked FROM api_keys WHERE project_id=? ORDER BY rowid DESC", (project_id,)).fetchall()
        return [{"id": row["id"], "name": row["name"], "prefix": row["prefix"], "createdAt": row["created_at"], "lastUsed": row["last_used"], "revoked": bool(row["revoked"])} for row in rows]


@app.post("/api/projects/{project_id}/deployment/keys", status_code=201)
def create_api_key(project_id: str, payload: ApiKeyCreatePayload):
    raw_key = "vf_" + secrets.token_urlsafe(32)
    key_id = uid()
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        con.execute("INSERT INTO api_keys (id,project_id,name,key_hash,prefix,created_at) VALUES (?,?,?,?,?,?)", (key_id, project_id, payload.name.strip(), hashlib.sha256(raw_key.encode()).hexdigest(), raw_key[:10], now()))
    return {"id": key_id, "name": payload.name.strip(), "key": raw_key, "prefix": raw_key[:10], "createdAt": now(), "revoked": False}


@app.delete("/api/projects/{project_id}/deployment/keys/{key_id}", status_code=204)
def revoke_api_key(project_id: str, key_id: str):
    with db() as con:
        result = con.execute("UPDATE api_keys SET revoked=1 WHERE id=? AND project_id=?", (key_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "API key not found")


@app.get("/api/projects/{project_id}/deployment/metrics")
def deployment_metrics(project_id: str):
    with db() as con:
        rows = con.execute("SELECT created_at,latency_ms,predictions,status,secure FROM inference_logs WHERE project_id=? ORDER BY rowid DESC LIMIT 100", (project_id,)).fetchall()
    total = len(rows)
    return {"requests": total, "averageLatencyMs": round(sum(row["latency_ms"] for row in rows) / total, 1) if total else 0, "errors": sum(row["status"] != "ok" for row in rows), "recent": [dict(row) for row in rows]}


@app.post("/api/projects/{project_id}/infer")
async def infer(project_id: str, file: UploadFile = File(...), confidence: float = 0.5):
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE project_id=? AND status='ready' ORDER BY rowid DESC LIMIT 1", (project_id,)).fetchone()
    if not model or not model["weights_path"]:
        raise HTTPException(400, "No trained model is ready")
    temp = DATA / f"infer-{uid()}{Path(file.filename or '.jpg').suffix}"
    temp.write_bytes(await file.read())
    try:
        from ultralytics import YOLO
        result = YOLO(model["weights_path"])(str(temp), conf=confidence, verbose=False)[0]
        names = result.names
        predictions = []
        if result.probs is not None:
            for class_index in result.probs.top5:
                score = float(result.probs.data[class_index])
                if score >= confidence:
                    predictions.append({"x1": 0, "y1": 0, "x2": result.orig_shape[1], "y2": result.orig_shape[0], "confidence": score, "class": names[int(class_index)], "type": "classification"})
            return {"predictions": predictions, "image": {"width": result.orig_shape[1], "height": result.orig_shape[0]}}
        mask_points = result.masks.xy if result.masks is not None else []
        detection = result.obb if result.obb is not None else result.boxes
        pose_points = result.keypoints.xy.tolist() if result.keypoints is not None else []
        oriented_points = result.obb.xyxyxyxy.tolist() if result.obb is not None else []
        if detection is not None:
            for index, (xyxy, conf, cls) in enumerate(zip(detection.xyxy.tolist(), detection.conf.tolist(), detection.cls.tolist())):
                polygon = [{"x": float(point[0]), "y": float(point[1])} for point in mask_points[index]] if index < len(mask_points) else None
                if index < len(oriented_points):
                    polygon = [{"x": float(point[0]), "y": float(point[1])} for point in oriented_points[index]]
                if index < len(pose_points):
                    polygon = [{"x": float(point[0]), "y": float(point[1])} for point in pose_points[index]]
                predictions.append({"x1":xyxy[0], "y1":xyxy[1], "x2":xyxy[2], "y2":xyxy[3], "confidence":conf, "class":names[int(cls)], "points": polygon})
        return {"predictions": predictions, "image": {"width": result.orig_shape[1], "height": result.orig_shape[0]}}
    finally:
        temp.unlink(missing_ok=True)


@app.post("/api/deploy/{project_id}/infer")
async def secure_infer(project_id: str, file: UploadFile = File(...), confidence: float = 0.5, x_api_key: str | None = Header(default=None)):
    started = time.perf_counter()
    with db() as con:
        keys = con.execute("SELECT * FROM api_keys WHERE project_id=? AND revoked=0", (project_id,)).fetchall()
        supplied_hash = hashlib.sha256((x_api_key or "").encode()).hexdigest()
        valid = next((row for row in keys if secrets.compare_digest(row["key_hash"], supplied_hash)), None)
        if not valid:
            raise HTTPException(401, "A valid X-API-Key header is required")
        con.execute("UPDATE api_keys SET last_used=? WHERE id=?", (now(), valid["id"]))
        model = con.execute("SELECT id FROM models WHERE project_id=? AND status='ready' ORDER BY rowid DESC LIMIT 1", (project_id,)).fetchone()
    try:
        result = await infer(project_id, file, confidence)
        with db() as con:
            con.execute("INSERT INTO inference_logs (id,project_id,model_id,created_at,latency_ms,predictions,status,secure) VALUES (?,?,?,?,?,?,?,1)", (uid(), project_id, model["id"] if model else None, now(), round((time.perf_counter()-started)*1000, 2), len(result["predictions"]), "ok"))
        return result
    except Exception:
        with db() as con:
            con.execute("INSERT INTO inference_logs (id,project_id,model_id,created_at,latency_ms,predictions,status,secure) VALUES (?,?,?,?,?,?,?,1)", (uid(), project_id, model["id"] if model else None, now(), round((time.perf_counter()-started)*1000, 2), 0, "error"))
        raise


@app.post("/api/projects/{project_id}/auto-label")
def auto_label(project_id: str, payload: AutoLabelPayload):
    from ultralytics import YOLO
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        if payload.model_id:
            model_row = con.execute("SELECT * FROM models WHERE id=? AND project_id=? AND status='ready'", (payload.model_id, project_id)).fetchone()
        else:
            model_row = con.execute("SELECT * FROM models WHERE project_id=? AND status='ready' ORDER BY rowid DESC LIMIT 1", (project_id,)).fetchone()
        weights = model_row["weights_path"] if model_row and model_row["weights_path"] else ("yolo11n-seg.pt" if project["type"] == "Instance Segmentation" else "yolo11n.pt")
        assets = list(con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid LIMIT ?", (project_id, payload.limit)))
        if not payload.overwrite:
            assets = [asset for asset in assets if not json.loads(asset["boxes"])]
        if not assets:
            return project_dict(con, project)
        detector = YOLO(weights)
        outputs = detector.predict([asset["path"] for asset in assets], conf=payload.confidence, verbose=False, stream=False)
        classes = json.loads(project["classes"])
        colors = json.loads(project["colors"] or "{}")
        palette = ["#ffcf4a", "#7a62ed", "#24c7bd", "#f06b9d", "#f0943f", "#4b9cff", "#54c17a"]
        for asset, output in zip(assets, outputs):
            width, height = output.orig_shape[1], output.orig_shape[0]
            masks = output.masks.xy if output.masks is not None else []
            boxes = []
            for index, (xyxy, cls) in enumerate(zip(output.boxes.xyxy.tolist(), output.boxes.cls.tolist())):
                name = str(output.names[int(cls)])
                if name not in classes:
                    classes.append(name)
                    colors[name] = palette[(len(classes)-1) % len(palette)]
                x1, y1, x2, y2 = xyxy
                annotation: dict[str, Any] = {"id": uid(), "label": name, "x": x1/width*100, "y": y1/height*100, "w": (x2-x1)/width*100, "h": (y2-y1)/height*100, "type": "box"}
                if index < len(masks) and len(masks[index]) >= 3:
                    annotation["type"] = "polygon"
                    annotation["points"] = [{"x": float(point[0])/width*100, "y": float(point[1])/height*100} for point in masks[index]]
                boxes.append(annotation)
            con.execute("UPDATE assets SET boxes=?,status=? WHERE id=?", (json.dumps(boxes), "annotated" if boxes else "unannotated", asset["id"]))
        con.execute("UPDATE projects SET classes=?,colors=? WHERE id=?", (json.dumps(classes), json.dumps(colors), project_id))
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.post("/api/projects/{project_id}/assets/{asset_id}/smart-mask")
def smart_mask(project_id: str, asset_id: str, payload: SmartMaskPayload):
    """Create an editable polygon with local GrabCut; no cloud or API key required."""
    import cv2
    import numpy as np

    with db() as con:
        asset = con.execute("SELECT a.*,p.classes FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.project_id=?", (asset_id, project_id)).fetchone()
    if not asset:
        raise HTTPException(404, "Image not found")
    if payload.label not in json.loads(asset["classes"]):
        raise HTTPException(400, "Unknown class label")
    image = cv2.imread(asset["path"])
    if image is None:
        raise HTTPException(400, "Image cannot be decoded")
    height, width = image.shape[:2]
    center_x, center_y = round(payload.x / 100 * width), round(payload.y / 100 * height)
    box_w, box_h = max(4, round(width * payload.size / 100)), max(4, round(height * payload.size / 100))
    left, top = max(0, center_x - box_w // 2), max(0, center_y - box_h // 2)
    right, bottom = min(width - 1, center_x + box_w // 2), min(height - 1, center_y + box_h // 2)
    if right - left < 3 or bottom - top < 3:
        raise HTTPException(400, "Smart-mask region is too small")
    mask = np.zeros((height, width), np.uint8)
    background, foreground = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(image, mask, (left, top, right - left, bottom - top), background, foreground, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error as exc:
        raise HTTPException(422, "Smart mask could not separate the selected region") from exc
    binary = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = [contour for contour in contours if cv2.contourArea(contour) >= 16]
    if not candidates:
        raise HTTPException(422, "No foreground contour found; click nearer the object center")
    containing = [contour for contour in candidates if cv2.pointPolygonTest(contour, (center_x, center_y), False) >= 0]
    contour = max(containing or candidates, key=cv2.contourArea)
    epsilon = max(1.0, cv2.arcLength(contour, True) * 0.008)
    polygon = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    if len(polygon) < 3:
        raise HTTPException(422, "Generated contour is too small")
    points = [{"x": round(float(x) / width * 100, 4), "y": round(float(y) / height * 100, 4)} for x, y in polygon]
    xs, ys = [point["x"] for point in points], [point["y"] for point in points]
    return {"id": uid(), "type": "polygon", "label": payload.label, "points": points, "x": min(xs), "y": min(ys), "w": max(xs) - min(xs), "h": max(ys) - min(ys)}


@app.get("/api/workflows")
def list_workflows():
    with db() as con:
        rows = con.execute("SELECT * FROM workflows ORDER BY updated_at DESC").fetchall()
    return [{"id": row["id"], "name": row["name"], "nodes": json.loads(row["nodes"]), "edges": json.loads(row["edges"]), "updatedAt": row["updated_at"]} for row in rows]


@app.post("/api/workflows")
def save_workflow(payload: WorkflowPayload):
    workflow_id = payload.id or uid()
    for node in payload.nodes:
        if node.get("type") == "webhook" and (node.get("config") or {}).get("url"):
            validate_webhook_url(str(node["config"]["url"]))
    with db() as con:
        con.execute(
            "INSERT INTO workflows (id,name,nodes,edges,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nodes=excluded.nodes,edges=excluded.edges,updated_at=excluded.updated_at",
            (workflow_id, payload.name, json.dumps(payload.nodes), json.dumps(payload.edges), now()),
        )
    return {"id": workflow_id, "name": payload.name, "nodes": payload.nodes, "edges": payload.edges, "updatedAt": now()}


@app.delete("/api/workflows/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str):
    with db() as con:
        result = con.execute("DELETE FROM workflows WHERE id=?", (workflow_id,))
        if not result.rowcount:
            raise HTTPException(404, "Workflow not found")


@app.post("/api/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, file: UploadFile = File(...), confidence: float = 0.5):
    with db() as con:
        workflow = con.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
        if not workflow:
            raise HTTPException(404, "Workflow not found")
        nodes = json.loads(workflow["nodes"])
        model_node = next((node for node in nodes if node.get("type") == "model"), None)
        requested_project = (model_node or {}).get("projectId")
        if requested_project:
            model = con.execute("SELECT * FROM models WHERE project_id=? AND status='ready' ORDER BY rowid DESC LIMIT 1", (requested_project,)).fetchone()
        else:
            model = con.execute("SELECT * FROM models WHERE status='ready' ORDER BY rowid DESC LIMIT 1").fetchone()
    if not model or not model["weights_path"]:
        raise HTTPException(400, "Workflow requires a ready model")
    temp = DATA / f"workflow-{uid()}{Path(file.filename or '.jpg').suffix}"
    temp.write_bytes(await file.read())
    try:
        from ultralytics import YOLO
        output = YOLO(model["weights_path"])(str(temp), conf=confidence, verbose=False)[0]
        predictions = []
        counts: dict[str, int] = {}
        filter_node = next((node for node in nodes if node.get("type") == "filter"), None)
        filter_config = (filter_node or {}).get("config") or {}
        minimum = float(filter_config.get("confidence", confidence))
        allowed_class = str(filter_config.get("class", "")).strip()
        raw_predictions: list[dict[str, Any]] = []
        if output.probs is not None:
            raw_predictions = [{"x1": 0, "y1": 0, "x2": output.orig_shape[1], "y2": output.orig_shape[0], "confidence": float(output.probs.data[index]), "class": output.names[int(index)], "type": "classification"} for index in output.probs.top5]
        else:
            detection = output.obb if output.obb is not None else output.boxes
            masks = output.masks.xy if output.masks is not None else []
            poses = output.keypoints.xy.tolist() if output.keypoints is not None else []
            oriented = output.obb.xyxyxyxy.tolist() if output.obb is not None else []
            if detection is not None:
                for index, (xyxy, score, cls) in enumerate(zip(detection.xyxy.tolist(), detection.conf.tolist(), detection.cls.tolist())):
                    points = masks[index].tolist() if index < len(masks) else oriented[index] if index < len(oriented) else poses[index] if index < len(poses) else None
                    raw_predictions.append({"x1": xyxy[0], "y1": xyxy[1], "x2": xyxy[2], "y2": xyxy[3], "confidence": score, "class": output.names[int(cls)], "points": points})
        for prediction in raw_predictions:
            if prediction["confidence"] < minimum or allowed_class and prediction["class"] != allowed_class:
                continue
            predictions.append(prediction)
            counts[prediction["class"]] = counts.get(prediction["class"], 0) + 1
        payload = {"workflowId": workflow_id, "status": "completed", "predictions": predictions, "counts": counts, "image": {"width": output.orig_shape[1], "height": output.orig_shape[0]}}
        actions = []
        for node in nodes:
            if node.get("type") == "branch":
                config = node.get("config") or {}
                class_name = str(config.get("class", ""))
                threshold = int(config.get("count", 1))
                actions.append({"nodeId": node.get("id"), "type": "branch", "status": "true" if counts.get(class_name, sum(counts.values()) if not class_name else 0) >= threshold else "false", "observed": counts.get(class_name, sum(counts.values()) if not class_name else 0)})
                continue
            if node.get("type") != "webhook" or not (node.get("config") or {}).get("url"):
                continue
            url = validate_webhook_url(str(node["config"]["url"]))
            try:
                request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(request, timeout=10) as response:
                    actions.append({"nodeId": node.get("id"), "type": "webhook", "status": "sent", "httpStatus": response.status})
            except Exception as exc:
                actions.append({"nodeId": node.get("id"), "type": "webhook", "status": "failed", "error": str(exc)[:300]})
        payload["actions"] = actions
        return payload
    finally:
        temp.unlink(missing_ok=True)


@app.get("/")
def root():
    frontend = ROOT / "dist" / "index.html"
    if frontend.is_file():
        return FileResponse(frontend)
    return {"name": "Roboflow Local API", "docs": "/docs", "health": "/api/health"}


if (ROOT / "dist" / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=ROOT / "dist" / "assets"), name="frontend-assets")
