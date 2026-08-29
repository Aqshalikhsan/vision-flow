from __future__ import annotations

import base64
import asyncio
from collections import defaultdict, deque
import hmac
import hashlib
import io
import importlib.util
import ipaddress
import json
import logging
import os
import random
import re
import secrets
import shutil
import smtplib
import socket
import sqlite3
import subprocess
import threading
import time
import uuid
import zipfile
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth
except ImportError:  # optional until Firebase credentials are configured
    firebase_admin = None
    firebase_auth = None
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv("VISIONFLOW_DATA_DIR", str(ROOT / "local_data"))).resolve()
UPLOADS = DATA / "uploads"
VERSIONS = DATA / "versions"
RUNS = DATA / "runs"
EXPORTS = DATA / "exports"
AVATARS = DATA / "avatars"
DB_PATH = DATA / "visionflow.db"
LOGGER = logging.getLogger("visionflow")
TRAIN_CANCEL: dict[str, threading.Event] = {}
TRAIN_SCHEDULER_LOCK = threading.Lock()
VERSION_GENERATION_PROGRESS: dict[str, dict[str, Any]] = {}
VERSION_GENERATION_LOCK = threading.Lock()
VERSION_EXPORT_LOCK = threading.Lock()
ACTIVE_LEARNING_SCANS: set[str] = set()
ACTIVE_LEARNING_PROGRESS: dict[str, dict[str, Any]] = {}
DATASET_HEALTH_PROGRESS: dict[str, dict[str, Any]] = {}
DATASET_HEALTH_PROGRESS_LOCK = threading.Lock()
WORKFLOW_SCHEDULER_STARTED = False
DEPLOY_RATE_LIMIT = max(1, int(os.getenv("VISIONFLOW_RATE_LIMIT", "120")))
DEPLOY_REQUESTS: dict[str, deque[float]] = defaultdict(deque)
REMOTE_QUEUE_TTL_MINUTES = max(
    5, int(os.getenv("VISIONFLOW_REMOTE_QUEUE_TTL_MINUTES", "120"))
)
for folder in (DATA, UPLOADS, VERSIONS, RUNS, EXPORTS, AVATARS):
    folder.mkdir(parents=True, exist_ok=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex[:12]


def set_version_generation_progress(
    project_id: str,
    progress: int,
    stage: str,
    status: str = "running",
    error: str | None = None,
    processed: int | None = None,
    total: int | None = None,
) -> None:
    with VERSION_GENERATION_LOCK:
        current = VERSION_GENERATION_PROGRESS.get(project_id, {})
        resolved_total = max(0, int(total if total is not None else current.get("total", 0)))
        resolved_processed = max(
            0,
            int(processed if processed is not None else current.get("processed", 0)),
        )
        if status == "completed" and resolved_total:
            resolved_processed = resolved_total
        VERSION_GENERATION_PROGRESS[project_id] = {
            "status": status,
            "progress": max(0, min(100, int(progress))),
            "stage": stage,
            "error": error,
            "processed": min(resolved_processed, resolved_total) if resolved_total else resolved_processed,
            "total": resolved_total,
            "updatedAt": now(),
        }


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def log_activity(con: sqlite3.Connection, action: str, detail: str = "", project_id: str | None = None, actor: str = "Local Owner") -> None:
    con.execute(
        "INSERT INTO activity_logs (id,project_id,action,detail,actor,created_at) VALUES (?,?,?,?,?,?)",
        (uid(), project_id, action, detail[:1000], actor[:100], now()),
    )


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
            CREATE TABLE IF NOT EXISTS activity_logs (
              id TEXT PRIMARY KEY, project_id TEXT, action TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'Local Owner',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_runs (
              id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
              status TEXT NOT NULL, predictions INTEGER NOT NULL DEFAULT 0,
              counts TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL,
              duration_ms REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
              token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL, expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_otp_challenges (
              id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS annotation_jobs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL, assignee_id TEXT REFERENCES workspace_members(id) ON DELETE SET NULL,
              asset_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_learning_queue (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
              model_id TEXT REFERENCES models(id) ON DELETE SET NULL, score REAL NOT NULL,
              reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
              UNIQUE(project_id,asset_id)
            );
            CREATE TABLE IF NOT EXISTS workflow_schedules (
              id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
              enabled INTEGER NOT NULL DEFAULT 1, interval_minutes INTEGER NOT NULL,
              next_run TEXT NOT NULL, last_run TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS annotation_revisions (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
              boxes TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS annotation_comments (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
              member_id TEXT REFERENCES workspace_members(id) ON DELETE SET NULL,
              actor TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS training_workers (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
              prefix TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL DEFAULT 'offline', current_model_id TEXT,
              last_seen TEXT, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS project_invites (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              code TEXT NOT NULL UNIQUE, created_by TEXT REFERENCES workspace_members(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS project_join_requests (
              id TEXT PRIMARY KEY, invite_id TEXT REFERENCES project_invites(id) ON DELETE SET NULL,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
              status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
              reviewed_at TEXT, reviewed_by TEXT REFERENCES workspace_members(id) ON DELETE SET NULL
            );
            CREATE TABLE IF NOT EXISTS project_collaborators (
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              member_id TEXT NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
              added_at TEXT NOT NULL, added_by TEXT REFERENCES workspace_members(id) ON DELETE SET NULL,
              PRIMARY KEY(project_id,member_id)
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
        if "training_detail" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN training_detail TEXT NOT NULL DEFAULT '{}'")
        asset_columns = {row["name"] for row in con.execute("PRAGMA table_info(assets)")}
        if "review_status" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'")
        if "split_locked" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN split_locked INTEGER NOT NULL DEFAULT 0")
        if "tags" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        if "metadata" not in asset_columns:
            con.execute("ALTER TABLE assets ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")
        if "archived" not in columns:
            con.execute("ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
        if "updated_at" not in columns:
            con.execute("ALTER TABLE projects ADD COLUMN updated_at TEXT")
        if "name" not in version_columns:
            con.execute("ALTER TABLE versions ADD COLUMN name TEXT")
        if "notes" not in version_columns:
            con.execute("ALTER TABLE versions ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
        if "tags" not in version_columns:
            con.execute("ALTER TABLE versions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        if "alias" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN alias TEXT")
        if "stage" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN stage TEXT NOT NULL DEFAULT 'development'")
        if "worker_id" not in model_columns:
            con.execute("ALTER TABLE models ADD COLUMN worker_id TEXT")
        worker_columns = {row["name"] for row in con.execute("PRAGMA table_info(training_workers)")}
        # Early development builds created the worker registry before token
        # authentication was added. Keep those databases upgradeable in place.
        if "token_hash" not in worker_columns:
            con.execute("ALTER TABLE training_workers ADD COLUMN token_hash TEXT")
        if "prefix" not in worker_columns:
            con.execute("ALTER TABLE training_workers ADD COLUMN prefix TEXT")
        if "revoked" not in worker_columns:
            con.execute("ALTER TABLE training_workers ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0")
        member_columns = {row["name"] for row in con.execute("PRAGMA table_info(workspace_members)")}
        if "password_hash" not in member_columns:
            con.execute("ALTER TABLE workspace_members ADD COLUMN password_hash TEXT")
        if "password_salt" not in member_columns:
            con.execute("ALTER TABLE workspace_members ADD COLUMN password_salt TEXT")
        if "email_verified" not in member_columns:
            con.execute("ALTER TABLE workspace_members ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
        if "onboarding_completed" not in member_columns:
            con.execute("ALTER TABLE workspace_members ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0")
        if "avatar_path" not in member_columns:
            con.execute("ALTER TABLE workspace_members ADD COLUMN avatar_path TEXT")
        # Salnova has one permission level. Upgrade accounts made by older
        # releases so annotator/admin metadata cannot block any operation.
        con.execute("UPDATE workspace_members SET role='owner' WHERE role IS NULL OR role!='owner'")
        # Jobs survive an application restart. The scheduler resumes from last.pt
        # when Ultralytics has already written a checkpoint for the run.
        for training in con.execute("SELECT id,config FROM models WHERE status='training'").fetchall():
            config = json.loads(training["config"] or "{}")
            if config.get("execution_target", "server") == "server":
                con.execute("UPDATE models SET status='queued', error='Queued for automatic resume after server restart' WHERE id=?", (training["id"],))
        if not con.execute("SELECT 1 FROM workspace_members LIMIT 1").fetchone():
            con.execute("INSERT INTO workspace_members (id,name,email,role,created_at) VALUES (?,?,?,?,?)", (uid(), "Local Owner", "owner@visionflow.local", "owner", now()))


def project_dict(con: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    assets = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (row["id"],)).fetchall()
    versions = con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY number", (row["id"],)).fetchall()
    models = con.execute("SELECT * FROM models WHERE project_id=? ORDER BY rowid", (row["id"],)).fetchall()
    return {
        "id": row["id"], "name": row["name"], "type": row["type"],
        "description": row["description"], "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "archived": bool(row["archived"]),
        "classes": json.loads(row["classes"]), "colors": json.loads(row["colors"] or "{}"),
        "assets": [{
            "id": a["id"], "name": a["name"], "src": f"/files/{a['id']}",
            "split": a["split"], "status": a["status"], "reviewStatus": a["review_status"], "boxes": json.loads(a["boxes"]),
            "tags": json.loads(a["tags"] or "[]"), "metadata": json.loads(a["metadata"] or "{}")
        } for a in assets],
        "versions": [{
            "id": v["id"], "number": v["number"], "createdAt": v["created_at"],
            "images": v["images"], "resize": v["resize"], "augment": bool(v["augment"]),
            "splits": json.loads(v["splits"]),
            "augmentations": json.loads(v["augmentations"] or "{}"),
            "generatedImages": v["generated_images"] or v["images"], "name": v["name"] or f"Version {v['number']}",
            "notes": v["notes"] or "", "tags": json.loads(v["tags"] or "[]")
        } for v in versions],
        "models": [{
            "id": m["id"], "name": m["name"], "version": m["version"],
            "status": m["status"], "progress": m["progress"], "map": m["map"],
            "precision": m["precision"], "recall": m["recall"], "error": m["error"]
            , "config": json.loads(m["config"] or "{}"), "createdAt": m["created_at"], "metricsHistory": json.loads(m["metrics_history"] or "[]"),
            "alias": m["alias"], "stage": m["stage"] or "development", "workerId": m["worker_id"],
            "trainingDetail": json.loads(m["training_detail"] or "{}"),
            "deployable": bool(m["weights_path"] and Path(m["weights_path"]).is_file()),
            "resumable": (RUNS / m["id"] / "weights" / "last.pt").is_file()
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


class ProjectArchivePayload(BaseModel):
    archived: bool = True


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


class AssetMetadataPayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tags: list[str] = Field(default_factory=list, max_length=30)
    metadata: dict[str, str] = Field(default_factory=dict)


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


class VersionUpdatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    notes: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list, max_length=30)


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
    execution_target: str = Field(default="server", pattern=r"^(server|remote-auto|remote-gpu|remote-cpu|colab-auto|colab-gpu|colab-cpu)$")
    worker_id: str | None = None
    base_model_id: str | None = None
    freeze_layers: int = Field(default=0, ge=0, le=100)
    weight_decay: float = Field(default=0.0005, ge=0, le=0.1)
    cos_lr: bool = False
    close_mosaic: int = Field(default=10, ge=0, le=50)
    amp: bool = True


class TrainingSweepPayload(BaseModel):
    base: TrainPayload
    learning_rates: list[float] = Field(default_factory=lambda: [0.01], min_length=1, max_length=4)
    optimizers: list[str] = Field(default_factory=lambda: ["auto"], min_length=1, max_length=4)


class TrainingWorkerPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class WorkerHeartbeatPayload(BaseModel):
    capabilities: dict[str, Any] = Field(default_factory=dict)


class WorkerProgressPayload(BaseModel):
    progress: int = Field(ge=1, le=99)
    epoch: int | None = Field(default=None, ge=0)
    total_epochs: int | None = Field(default=None, ge=1)
    batch: int | None = Field(default=None, ge=0)
    total_batches: int | None = Field(default=None, ge=0)
    stage: str = Field(default="Training", max_length=120)
    loss: float | None = None
    metrics: dict[str, float] = Field(default_factory=dict)


class WorkerFailurePayload(BaseModel):
    error: str = Field(min_length=1, max_length=2000)


class ModelRenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ModelLifecyclePayload(BaseModel):
    alias: str | None = Field(default=None, max_length=60)
    stage: str = Field(default="development", pattern=r"^(development|staging|production|archived)$")


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
    password: str | None = Field(default=None, min_length=8, max_length=200)


class LoginPayload(BaseModel):
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=160)
    password: str = Field(min_length=1, max_length=200)


class FirebaseLoginPayload(BaseModel):
    id_token: str = Field(min_length=20, max_length=10000)


class AssistantMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AssistantChatPayload(BaseModel):
    messages: list[AssistantMessage] = Field(min_length=1, max_length=20)
    context: str | None = Field(default=None, max_length=1000)


class ProjectJoinPayload(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{8}$")


class ProjectJoinReviewPayload(BaseModel):
    action: str = Field(pattern=r"^(accept|reject)$")


class BootstrapPayload(LoginPayload):
    name: str = Field(default="Local Owner", min_length=1, max_length=80)


class OtpRequestPayload(BaseModel):
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=160)
    name: str | None = Field(default=None, min_length=1, max_length=80)


class OtpVerifyPayload(OtpRequestPayload):
    code: str = Field(pattern=r"^\d{6}$")


class AnnotationJobPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    assignee_id: str | None = None
    asset_ids: list[str] = Field(min_length=1, max_length=5000)


class JobStatusPayload(BaseModel):
    status: str = Field(pattern=r"^(open|in-progress|review|completed)$")


class ActiveLearningPayload(BaseModel):
    model_id: str | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    confidence: float = Field(default=0.5, ge=0.01, le=0.99)


class QueueStatusPayload(BaseModel):
    status: str = Field(pattern=r"^(pending|accepted|dismissed)$")


class WorkflowSchedulePayload(BaseModel):
    enabled: bool = True
    interval_minutes: int = Field(default=60, ge=1, le=10080)


class AnnotationCommentPayload(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


# Authentication is on by default. Set VISIONFLOW_REQUIRE_AUTH=0 only for
# explicitly isolated local development or automated fixtures.
AUTH_REQUIRED = os.getenv("VISIONFLOW_REQUIRE_AUTH", "1").lower() in {"1", "true", "yes"}
OTP_SECRET = os.getenv("VISIONFLOW_OTP_SECRET") or secrets.token_hex(32)
OTP_DEV_CODE = os.getenv("VISIONFLOW_OTP_DEV_CODE", "").strip()
AUTH_PUBLIC_PATHS = {
    "/",
    "/favicon.svg",
    "/api/health",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/logout",
    "/api/auth/bootstrap",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/api/auth/firebase",
    "/docs",
    "/openapi.json",
}


def password_digest(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return digest.hex(), salt.hex()


def otp_digest(email: str, code: str) -> str:
    return hmac.new(OTP_SECRET.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def account_name_from_email(email: str) -> str:
    """Use the verified account identifier as the canonical display name."""
    local = email.split("@", 1)[0].strip()
    return local or email


def send_login_otp(email: str, code: str) -> None:
    if OTP_DEV_CODE:
        LOGGER.warning("Development OTP for %s: %s", email, code)
        return
    username = os.getenv("VISIONFLOW_SMTP_USERNAME", "").strip()
    password = os.getenv("VISIONFLOW_SMTP_PASSWORD", "").replace(" ", "")
    sender = os.getenv("VISIONFLOW_SMTP_FROM", username).strip()
    if not username or not password or not sender:
        raise HTTPException(
            503,
            "Gmail OTP belum dikonfigurasi. Isi VISIONFLOW_SMTP_USERNAME dan VISIONFLOW_SMTP_PASSWORD (Google App Password).",
        )
    host = os.getenv("VISIONFLOW_SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("VISIONFLOW_SMTP_PORT", "587"))
    message = EmailMessage()
    message["Subject"] = f"{code} adalah kode login Salnova"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        "Gunakan kode berikut untuk login ke Salnova:\n\n"
        f"{code}\n\nKode berlaku selama 10 menit dan hanya dapat digunakan satu kali."
    )
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
                smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.starttls()
                smtp.login(username, password)
                smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        LOGGER.exception("Could not send login OTP to %s", email)
        raise HTTPException(502, "Gmail tidak dapat mengirim OTP. Periksa alamat Gmail dan App Password.") from exc


def create_member_session(member: sqlite3.Row) -> JSONResponse:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=30)
    with db() as con:
        con.execute("DELETE FROM auth_sessions WHERE expires_at<=?", (now(),))
        con.execute(
            "INSERT INTO auth_sessions (token_hash,member_id,created_at,expires_at) VALUES (?,?,?,?)",
            (hashlib.sha256(token.encode("utf-8")).hexdigest(), member["id"], now(), expires.isoformat()),
        )
    response = JSONResponse({"token": token, "member": member_json(member)})
    response.set_cookie("vf_session", token, max_age=30 * 86400, httponly=True, samesite="lax", secure=False)
    return response


def session_member(authorization: str | None, cookie_token: str | None = None) -> sqlite3.Row | None:
    raw_token = cookie_token
    if authorization and authorization.lower().startswith("bearer "):
        raw_token = authorization.split(" ", 1)[1]
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with db() as con:
        return con.execute(
            "SELECT m.* FROM auth_sessions s JOIN workspace_members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash, now()),
        ).fetchone()


app = FastAPI(title="Salnova API", version="0.3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def enforce_workspace_role(request: Request, call_next):
    """Authenticate production sessions and enforce workspace role boundaries."""
    member = session_member(request.headers.get("Authorization"), request.cookies.get("vf_session"))
    if request.url.path.startswith((
        "/api/training-workers/agent/",
        "/api/training-workers/setup/",
        "/api/deploy/",
    )):
        return await call_next(request)
    if AUTH_REQUIRED and not member and request.url.path not in AUTH_PUBLIC_PATHS and not request.url.path.startswith("/assets/"):
        return JSONResponse(status_code=401, content={"detail": "Login required"})
    if member:
        request.state.member_id = member["id"]
        request.state.actor = member["name"]
        role = member["role"]
    else:
        request.state.actor = "Local Owner"
        role = request.headers.get("X-Workspace-Role", "owner").lower()
    # Authentication still protects the workspace, but every signed-in or
    # local-mode account has full access to all Salnova capabilities.
    return await call_next(request)
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
    ml_ready = importlib.util.find_spec("ultralytics") is not None
    return {"status": "ok", "database": str(DB_PATH), "mlReady": ml_ready}


@app.post("/api/assistant/chat")
def assistant_chat(payload: AssistantChatPayload):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            503,
            "Gemini belum dikonfigurasi. Set GEMINI_API_KEY lalu restart Salnova.",
        )
    preferred_model = os.getenv("VISIONFLOW_GEMINI_MODEL", "gemini-3.6-flash").strip()
    model_candidates = list(
        dict.fromkeys(
            [
                preferred_model,
                "gemini-3.6-flash",
                "gemini-3.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3.1-flash-lite",
                "gemini-2.5-flash",
            ]
        )
    )
    system_prompt = (
        "Anda adalah asisten Salnova berbahasa Indonesia. Bantu pengguna memakai "
        "workspace computer vision lokal: project, dataset, annotation, version, training "
        "YOLO, registry, deployment, dan inference. Berikan jawaban praktis, singkat, dan "
        "jangan mengarang status proses atau data yang tidak diberikan."
    )
    if payload.context:
        system_prompt += f"\nKonteks halaman saat ini: {payload.context}"
    contents: list[dict[str, Any]] = [
        {"role": "user", "parts": [{"text": system_prompt}]},
        {
            "role": "model",
            "parts": [{"text": "Siap, saya akan membantu menggunakan Salnova."}],
        },
    ]
    contents.extend(
        {
            "role": "model" if message.role == "assistant" else "user",
            "parts": [{"text": message.content}],
        }
        for message in payload.messages
    )
    body = json.dumps(
        {
            "contents": contents,
            "generationConfig": {
                "temperature": 0.35,
                "maxOutputTokens": 900,
            },
        }
    ).encode("utf-8")
    result: dict[str, Any] | None = None
    selected_model = preferred_model
    last_detail = "Semua model Gemini sedang tidak tersedia"
    for model in model_candidates:
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{urllib.parse.quote(model, safe='')}:generateContent"
        )
        request = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                result = json.loads(response.read().decode("utf-8"))
            selected_model = model
            break
        except urllib.error.HTTPError as exc:
            detail = "Gemini API menolak permintaan"
            try:
                error_body = json.loads(exc.read().decode("utf-8"))
                detail = error_body.get("error", {}).get("message") or detail
            except Exception:
                pass
            last_detail = detail
            # Missing, throttled, overloaded, or temporarily unavailable:
            # immediately try the next fast stable model.
            if exc.code in {404, 429, 500, 502, 503, 504}:
                LOGGER.warning("Gemini model %s unavailable (%s); trying fallback", model, exc.code)
                continue
            raise HTTPException(502, detail) from exc
        except (OSError, TimeoutError, json.JSONDecodeError) as exc:
            raise HTTPException(502, "Gemini API tidak dapat dihubungi") from exc
    if result is None:
        raise HTTPException(503, f"Model Gemini sedang sibuk. Detail terakhir: {last_detail}")
    reply = "".join(
        part.get("text", "")
        for candidate in result.get("candidates", [])[:1]
        for part in candidate.get("content", {}).get("parts", [])
    ).strip()
    if not reply:
        raise HTTPException(502, "Gemini tidak mengembalikan jawaban")
    return {"reply": reply, "model": selected_model}


def member_json(row: sqlite3.Row) -> dict[str, Any]:
    avatar_url = None
    avatar_path = Path(row["avatar_path"]) if row["avatar_path"] else None
    if avatar_path and avatar_path.is_file():
        avatar_url = f"/api/auth/members/{row['id']}/avatar?v={avatar_path.stat().st_mtime_ns}"
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "createdAt": row["created_at"],
        "hasPassword": bool(row["password_hash"]),
        "emailVerified": bool(row["email_verified"]),
        "onboardingCompleted": bool(row["onboarding_completed"]),
        "avatarUrl": avatar_url,
    }


def request_member_id(request: Request, con: sqlite3.Connection) -> str | None:
    member_id = getattr(request.state, "member_id", None)
    if member_id or AUTH_REQUIRED:
        return member_id
    local_owner = con.execute(
        "SELECT id FROM workspace_members WHERE role='owner' ORDER BY rowid LIMIT 1"
    ).fetchone()
    return local_owner["id"] if local_owner else None


@app.get("/api/auth/status")
def auth_status(request: Request):
    member = session_member(request.headers.get("Authorization"), request.cookies.get("vf_session"))
    with db() as con:
        setup_required = not con.execute("SELECT 1 FROM workspace_members WHERE password_hash IS NOT NULL OR email_verified=1 LIMIT 1").fetchone()
    return {"required": AUTH_REQUIRED, "setupRequired": setup_required, "member": member_json(member) if member else None}


@app.post("/api/auth/bootstrap", status_code=201)
def bootstrap_auth(payload: BootstrapPayload):
    digest, salt = password_digest(payload.password)
    email = payload.email.strip().lower()
    display_name = payload.name.strip()
    with db() as con:
        if con.execute("SELECT 1 FROM workspace_members WHERE password_hash IS NOT NULL LIMIT 1").fetchone():
            raise HTTPException(409, "Workspace authentication is already configured")
        owner = con.execute("SELECT * FROM workspace_members WHERE role='owner' ORDER BY rowid LIMIT 1").fetchone()
        if owner:
            member_id = owner["id"]
            con.execute(
                "UPDATE workspace_members SET name=?,email=?,password_hash=?,password_salt=? WHERE id=?",
                (display_name, email, digest, salt, member_id),
            )
        else:
            member_id = uid()
            con.execute(
                "INSERT INTO workspace_members (id,name,email,role,created_at,password_hash,password_salt) VALUES (?,?,?,?,?,?,?)",
                (member_id, display_name, email, "owner", now(), digest, salt),
            )
    return {"status": "configured"}


@app.post("/api/auth/login")
def login(payload: LoginPayload):
    email = payload.email.strip().lower()
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE email=?", (email,)).fetchone()
        if not member or not member["password_hash"] or not member["password_salt"]:
            raise HTTPException(401, "Invalid email or password")
        digest, _ = password_digest(payload.password, member["password_salt"])
        if not hmac.compare_digest(digest, member["password_hash"]):
            raise HTTPException(401, "Invalid email or password")
        # Keep the authenticated identity canonical even for the password
        # fallback: the account name is the email username, not free text.
        con.execute("UPDATE workspace_members SET name=? WHERE id=?", (account_name_from_email(email), member["id"]))
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member["id"],)).fetchone()
    return create_member_session(member)


@app.post("/api/auth/register", status_code=201)
def register(payload: BootstrapPayload):
    email = payload.email.strip().lower()
    display_name = payload.name.strip()
    digest, salt = password_digest(payload.password)
    with db() as con:
        if con.execute("SELECT 1 FROM workspace_members WHERE email=?", (email,)).fetchone():
            raise HTTPException(409, "Email Gmail ini sudah terdaftar. Silakan Sign In.")
        if con.execute("SELECT 1 FROM workspace_members WHERE lower(name)=lower(?)", (display_name,)).fetchone():
            raise HTTPException(409, "Username sudah digunakan")
        member_id = uid()
        # Self-registration is intended for this personal/local workspace, so
        # registered users receive full workspace access. Restricted accounts
        # can still be created explicitly from member settings.
        role = "owner"
        con.execute(
            "INSERT INTO workspace_members (id,name,email,role,created_at,password_hash,password_salt,email_verified,onboarding_completed) VALUES (?,?,?,?,?,?,?,1,0)",
            (member_id, display_name, email, role, now(), digest, salt),
        )
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
    return create_member_session(member)


@app.post("/api/auth/firebase")
def firebase_login(payload: FirebaseLoginPayload):
    if firebase_admin is None:
        raise HTTPException(503, "Firebase Admin SDK belum terpasang")
    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        claims = firebase_auth.verify_id_token(payload.id_token)
    except Exception as exc:
        LOGGER.warning("Firebase token verification failed: %s", exc)
        raise HTTPException(401, "Token Firebase tidak valid atau kedaluwarsa") from exc
    email = str(claims.get("email") or "").strip().lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(403, "Email Firebase belum terverifikasi")
    display_name = str(claims.get("name") or account_name_from_email(email)).strip()
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE email=?", (email,)).fetchone()
        if not member:
            member_id = uid()
            con.execute(
                "INSERT INTO workspace_members (id,name,email,role,created_at,email_verified,onboarding_completed) VALUES (?,?,?,?,?,1,0)",
                (member_id, display_name, email, "owner", now()),
            )
            member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
        else:
            con.execute("UPDATE workspace_members SET name=?,email_verified=1 WHERE id=?", (display_name, member["id"]))
            member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member["id"],)).fetchone()
    return create_member_session(member)


@app.post("/api/auth/otp/request", status_code=202)
def request_login_otp(payload: OtpRequestPayload):
    email = payload.email.strip().lower()
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE email=?", (email,)).fetchone()
        setup_required = not con.execute(
            "SELECT 1 FROM workspace_members WHERE password_hash IS NOT NULL OR email_verified=1 LIMIT 1"
        ).fetchone()
        if not member and not setup_required:
            # Do not reveal which email addresses belong to the workspace.
            return {"status": "sent", "expiresIn": 600}
        latest = con.execute(
            "SELECT created_at FROM auth_otp_challenges WHERE email=? ORDER BY created_at DESC LIMIT 1",
            (email,),
        ).fetchone()
        if latest and datetime.fromisoformat(latest["created_at"]) > datetime.now(timezone.utc) - timedelta(seconds=60):
            raise HTTPException(429, "Tunggu 60 detik sebelum meminta OTP baru")
        code = OTP_DEV_CODE if re.fullmatch(r"\d{6}", OTP_DEV_CODE) else f"{secrets.randbelow(1_000_000):06d}"
        challenge_id = uid()
        created = now()
        expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        con.execute("DELETE FROM auth_otp_challenges WHERE email=? OR expires_at<=?", (email, created))
        con.execute(
            "INSERT INTO auth_otp_challenges (id,email,code_hash,created_at,expires_at) VALUES (?,?,?,?,?)",
            (challenge_id, email, otp_digest(email, code), created, expires),
        )
    try:
        send_login_otp(email, code)
    except Exception:
        with db() as con:
            con.execute("DELETE FROM auth_otp_challenges WHERE id=?", (challenge_id,))
        raise
    result: dict[str, Any] = {"status": "sent", "expiresIn": 600}
    if OTP_DEV_CODE:
        result["devCode"] = code
    return result


@app.post("/api/auth/otp/verify")
def verify_login_otp(payload: OtpVerifyPayload):
    email = payload.email.strip().lower()
    with db() as con:
        challenge = con.execute(
            "SELECT * FROM auth_otp_challenges WHERE email=? ORDER BY created_at DESC LIMIT 1",
            (email,),
        ).fetchone()
        if not challenge or challenge["expires_at"] <= now():
            raise HTTPException(401, "OTP tidak ditemukan atau sudah kedaluwarsa")
        if challenge["attempts"] >= 5:
            con.execute("DELETE FROM auth_otp_challenges WHERE id=?", (challenge["id"],))
            raise HTTPException(429, "Terlalu banyak percobaan OTP. Minta kode baru.")
        if not hmac.compare_digest(challenge["code_hash"], otp_digest(email, payload.code)):
            con.execute("UPDATE auth_otp_challenges SET attempts=attempts+1 WHERE id=?", (challenge["id"],))
            raise HTTPException(401, "Kode OTP salah")
        member = con.execute("SELECT * FROM workspace_members WHERE email=?", (email,)).fetchone()
        setup_required = not con.execute(
            "SELECT 1 FROM workspace_members WHERE password_hash IS NOT NULL OR email_verified=1 LIMIT 1"
        ).fetchone()
        if not member and setup_required:
            placeholder = con.execute(
                "SELECT * FROM workspace_members WHERE email='owner@visionflow.local' AND password_hash IS NULL ORDER BY rowid LIMIT 1"
            ).fetchone()
            display_name = account_name_from_email(email)
            if placeholder:
                con.execute(
                    "UPDATE workspace_members SET name=?,email=?,email_verified=1 WHERE id=?",
                    (display_name, email, placeholder["id"]),
                )
                member_id = placeholder["id"]
            else:
                member_id = uid()
                con.execute(
                    "INSERT INTO workspace_members (id,name,email,role,created_at,email_verified,onboarding_completed) VALUES (?,?,?,?,?,1,0)",
                    (member_id, display_name, email, "owner", now()),
                )
            member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
        elif member:
            con.execute(
                "UPDATE workspace_members SET name=?,email_verified=1 WHERE id=?",
                (account_name_from_email(email), member["id"]),
            )
            member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member["id"],)).fetchone()
        else:
            raise HTTPException(401, "Email ini belum terdaftar di workspace")
        con.execute("DELETE FROM auth_otp_challenges WHERE email=?", (email,))
    return create_member_session(member)


@app.post("/api/auth/onboarding/complete")
def complete_onboarding(request: Request):
    member = session_member(request.headers.get("Authorization"), request.cookies.get("vf_session"))
    if not member:
        raise HTTPException(401, "Login required")
    with db() as con:
        con.execute("UPDATE workspace_members SET onboarding_completed=1 WHERE id=?", (member["id"],))
        updated = con.execute("SELECT * FROM workspace_members WHERE id=?", (member["id"],)).fetchone()
    return member_json(updated)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request):
    token = request.cookies.get("vf_session")
    if token:
        with db() as con:
            con.execute("DELETE FROM auth_sessions WHERE token_hash=?", (hashlib.sha256(token.encode("utf-8")).hexdigest(),))
    response = Response(status_code=204)
    response.delete_cookie("vf_session")
    return response


@app.get("/api/auth/me")
def auth_me(request: Request):
    member = session_member(request.headers.get("Authorization"), request.cookies.get("vf_session"))
    if not member:
        raise HTTPException(401, "Login required")
    return member_json(member)


@app.post("/api/auth/profile/avatar")
async def upload_profile_avatar(request: Request, file: UploadFile = File(...)):
    with db() as con:
        member_id = request_member_id(request, con)
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone() if member_id else None
    if not member:
        raise HTTPException(401, "Login required")
    payload = await file.read(5 * 1024 * 1024 + 1)
    if len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, "Profile photo exceeds 5 MB")
    try:
        with Image.open(io.BytesIO(payload)) as source:
            if source.width * source.height > 25_000_000:
                raise HTTPException(400, "Profile photo dimensions are too large")
            image = ImageOps.exif_transpose(source).convert("RGB")
            side = min(image.size)
            left = (image.width - side) // 2
            top = (image.height - side) // 2
            image = image.crop((left, top, left + side, top + side))
            image = image.resize((512, 512), Image.Resampling.LANCZOS)
            target = (AVATARS / f"{member['id']}.jpg").resolve()
            if target.parent != AVATARS.resolve():
                raise HTTPException(400, "Invalid profile photo target")
            image.save(target, "JPEG", quality=88, optimize=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "Upload a valid JPG, PNG, or WEBP image") from exc
    with db() as con:
        con.execute("UPDATE workspace_members SET avatar_path=? WHERE id=?", (str(target), member["id"]))
        updated = con.execute("SELECT * FROM workspace_members WHERE id=?", (member["id"],)).fetchone()
    return member_json(updated)


@app.get("/api/auth/members/{member_id}/avatar")
def member_avatar(member_id: str):
    with db() as con:
        member = con.execute("SELECT avatar_path FROM workspace_members WHERE id=?", (member_id,)).fetchone()
    if not member or not member["avatar_path"]:
        raise HTTPException(404, "Profile photo not found")
    target = Path(member["avatar_path"]).resolve()
    if target.parent != AVATARS.resolve() or not target.is_file():
        raise HTTPException(404, "Profile photo not found")
    return FileResponse(target, media_type="image/jpeg")


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
        return [member_json(row) for row in con.execute("SELECT * FROM workspace_members ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'annotator' THEN 2 ELSE 3 END,rowid")]


@app.post("/api/members", status_code=201)
def create_member(payload: MemberPayload):
    member_id = uid()
    digest, salt = password_digest(payload.password) if payload.password else (None, None)
    try:
        with db() as con:
            con.execute("INSERT INTO workspace_members (id,name,email,role,created_at,password_hash,password_salt) VALUES (?,?,?,?,?,?,?)", (member_id, payload.name.strip(), payload.email.lower(), "owner", now(), digest, salt))
            row = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "A member with this email already exists") from exc
    return member_json(row)


@app.put("/api/members/{member_id}")
def update_member(member_id: str, payload: MemberPayload):
    with db() as con:
        member = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
        if not member:
            raise HTTPException(404, "Member not found")
        try:
            if payload.password:
                digest, salt = password_digest(payload.password)
                con.execute("UPDATE workspace_members SET name=?,email=?,role='owner',password_hash=?,password_salt=? WHERE id=?", (payload.name.strip(), payload.email.lower(), digest, salt, member_id))
            else:
                con.execute("UPDATE workspace_members SET name=?,email=?,role='owner' WHERE id=?", (payload.name.strip(), payload.email.lower(), member_id))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "A member with this email already exists") from exc
        updated = con.execute("SELECT * FROM workspace_members WHERE id=?", (member_id,)).fetchone()
    return member_json(updated)


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
        raise HTTPException(400, "Not a Salnova backup")
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
        con.execute("INSERT INTO projects (id,name,type,description,created_at,classes,colors,updated_at) VALUES (?,?,?,?,?,?,?,?)", (project_id, payload.name, payload.type, payload.description, now()[:10], json.dumps(cleaned_classes), json.dumps(colors), now()))
        log_activity(con, "project.created", payload.name, project_id)
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        return project_dict(con, row)


@app.get("/api/projects/{project_id}/collaboration")
def project_collaboration(project_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        invites = con.execute(
            "SELECT id,code,created_at,expires_at FROM project_invites WHERE project_id=? AND revoked=0 AND expires_at>? ORDER BY created_at DESC",
            (project_id, now()),
        ).fetchall()
        requests = con.execute(
            "SELECT r.id,r.status,r.created_at,m.id member_id,m.name,m.email FROM project_join_requests r JOIN workspace_members m ON m.id=r.member_id WHERE r.project_id=? AND r.status='pending' ORDER BY r.created_at",
            (project_id,),
        ).fetchall()
        collaborators = con.execute(
            "SELECT m.id,m.name,m.email,c.added_at FROM project_collaborators c JOIN workspace_members m ON m.id=c.member_id WHERE c.project_id=? ORDER BY c.added_at",
            (project_id,),
        ).fetchall()
    return {
        "invites": [dict(item) for item in invites],
        "requests": [dict(item) for item in requests],
        "collaborators": [dict(item) for item in collaborators],
    }


@app.post("/api/projects/{project_id}/invites", status_code=201)
def create_project_invite(project_id: str, request: Request):
    with db() as con:
        member_id = request_member_id(request, con)
        if not member_id:
            raise HTTPException(401, "Login required")
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        code = secrets.token_hex(4).upper()
        invite_id = uid()
        created = now()
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        con.execute(
            "INSERT INTO project_invites (id,project_id,code,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)",
            (invite_id, project_id, code, member_id, created, expires),
        )
        log_activity(con, "project.invite.created", f"Invite {code} dibuat", project_id, request.state.actor)
    return {"id": invite_id, "code": code, "created_at": created, "expires_at": expires}


@app.post("/api/collaboration/join", status_code=202)
def request_project_join(payload: ProjectJoinPayload, request: Request):
    with db() as con:
        member_id = request_member_id(request, con)
        if not member_id:
            raise HTTPException(401, "Login required")
        invite = con.execute(
            "SELECT * FROM project_invites WHERE code=? AND revoked=0 AND expires_at>?",
            (payload.code.upper(), now()),
        ).fetchone()
        if not invite:
            raise HTTPException(404, "Kode undangan tidak ditemukan atau kedaluwarsa")
        if con.execute(
            "SELECT 1 FROM project_collaborators WHERE project_id=? AND member_id=?",
            (invite["project_id"], member_id),
        ).fetchone():
            return {"status": "accepted", "projectId": invite["project_id"]}
        existing = con.execute(
            "SELECT * FROM project_join_requests WHERE project_id=? AND member_id=? AND status='pending'",
            (invite["project_id"], member_id),
        ).fetchone()
        if existing:
            return {"status": "pending", "projectId": invite["project_id"]}
        request_id = uid()
        con.execute(
            "INSERT INTO project_join_requests (id,invite_id,project_id,member_id,status,created_at) VALUES (?,?,?,?,?,?)",
            (request_id, invite["id"], invite["project_id"], member_id, "pending", now()),
        )
        log_activity(con, "project.join.requested", "Permintaan kolaborasi baru", invite["project_id"], request.state.actor)
    return {"status": "pending", "projectId": invite["project_id"]}


@app.post("/api/projects/{project_id}/collaboration/requests/{request_id}")
def review_project_join(project_id: str, request_id: str, payload: ProjectJoinReviewPayload, request: Request):
    status = "accepted" if payload.action == "accept" else "rejected"
    with db() as con:
        reviewer_id = request_member_id(request, con)
        if not reviewer_id:
            raise HTTPException(401, "Login required")
        join_request = con.execute(
            "SELECT * FROM project_join_requests WHERE id=? AND project_id=? AND status='pending'",
            (request_id, project_id),
        ).fetchone()
        if not join_request:
            raise HTTPException(404, "Permintaan kolaborasi tidak ditemukan")
        con.execute(
            "UPDATE project_join_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?",
            (status, now(), reviewer_id, request_id),
        )
        if status == "accepted":
            con.execute(
                "INSERT OR IGNORE INTO project_collaborators (project_id,member_id,added_at,added_by) VALUES (?,?,?,?)",
                (project_id, join_request["member_id"], now(), reviewer_id),
            )
        log_activity(con, f"project.join.{status}", f"Permintaan {status}", project_id, request.state.actor)
    return {"status": status}


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdatePayload):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    with db() as con:
        result = con.execute(
            "UPDATE projects SET name=?,description=?,updated_at=? WHERE id=?",
            (name, payload.description.strip(), now(), project_id),
        )
        if not result.rowcount:
            raise HTTPException(404, "Project not found")
        log_activity(con, "project.updated", f"Updated project details for {name}", project_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.post("/api/projects/{project_id}/archive")
def archive_project(project_id: str, payload: ProjectArchivePayload):
    with db() as con:
        result = con.execute(
            "UPDATE projects SET archived=?,updated_at=? WHERE id=?",
            (int(payload.archived), now(), project_id),
        )
        if not result.rowcount:
            raise HTTPException(404, "Project not found")
        log_activity(con, "project.archived" if payload.archived else "project.restored", "", project_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.post("/api/projects/{project_id}/duplicate", status_code=201)
def duplicate_project(project_id: str):
    with db() as con:
        source = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not source:
            raise HTTPException(404, "Project not found")
        duplicate_id = "-".join("".join(c if c.isalnum() else " " for c in f"{source['name']} copy".lower()).split()) + "-" + uid()[:4]
        duplicate_name = f"{source['name']} Copy"
        con.execute(
            "INSERT INTO projects (id,name,type,description,created_at,classes,colors,archived,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (duplicate_id, duplicate_name, source["type"], source["description"], now()[:10], source["classes"], source["colors"], 0, now()),
        )
        target_dir = UPLOADS / duplicate_id
        target_dir.mkdir(parents=True, exist_ok=True)
        for asset in con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (project_id,)):
            asset_id = uid()
            source_file = Path(asset["path"])
            suffix = source_file.suffix.lower() or ".jpg"
            target_file = target_dir / f"{asset_id}{suffix}"
            if source_file.is_file():
                shutil.copy2(source_file, target_file)
            boxes = json.loads(asset["boxes"])
            for box in boxes:
                box["id"] = uid()
            con.execute(
                "INSERT INTO assets (id,project_id,name,path,split,status,boxes,split_locked,review_status,tags,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (asset_id, duplicate_id, asset["name"], str(target_file), asset["split"], asset["status"], json.dumps(boxes), asset["split_locked"], asset["review_status"], asset["tags"], asset["metadata"]),
            )
        log_activity(con, "project.duplicated", f"Duplicated from {source['name']}", duplicate_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (duplicate_id,)).fetchone())


@app.get("/api/activity")
def list_activity(project_id: str | None = None, limit: int = 100):
    limit = max(1, min(limit, 500))
    with db() as con:
        if project_id:
            rows = con.execute("SELECT * FROM activity_logs WHERE project_id=? ORDER BY created_at DESC LIMIT ?", (project_id, limit)).fetchall()
        else:
            rows = con.execute("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [{"id": row["id"], "projectId": row["project_id"], "action": row["action"], "detail": row["detail"], "actor": row["actor"], "createdAt": row["created_at"]} for row in rows]


@app.get("/api/projects/{project_id}/health")
def dataset_health(project_id: str):
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        assets = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (project_id,)).fetchall()
    started = time.monotonic()
    with DATASET_HEALTH_PROGRESS_LOCK:
        DATASET_HEALTH_PROGRESS[project_id] = {
            "scanning": True,
            "progress": 1,
            "processed": 0,
            "total": len(assets),
            "stage": "Preparing dataset scan",
            "startedMonotonic": started,
        }
    issues: list[dict[str, Any]] = []
    hashes: dict[str, list[str]] = {}
    class_counts: dict[str, int] = {name: 0 for name in json.loads(project["classes"])}
    split_counts = {"train": 0, "valid": 0, "test": 0}
    blur_scores: list[float] = []
    for index, asset in enumerate(assets, start=1):
        asset_issues: list[str] = []
        boxes = json.loads(asset["boxes"] or "[]")
        split_counts[asset["split"]] = split_counts.get(asset["split"], 0) + 1
        if not boxes:
            asset_issues.append("unlabeled")
        for box in boxes:
            class_counts[box.get("label", "unknown")] = class_counts.get(box.get("label", "unknown"), 0) + 1
            area = float(box.get("w", 0)) * float(box.get("h", 0)) / 10_000
            if area < 0.0005:
                asset_issues.append("tiny-annotation")
            elif area > 0.9:
                asset_issues.append("oversized-annotation")
        path = Path(asset["path"])
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            hashes.setdefault(digest, []).append(asset["id"])
            try:
                with Image.open(path) as image:
                    width, height = image.size
                if min(width, height) < 320:
                    asset_issues.append("low-resolution")
                import cv2
                grayscale = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
                if grayscale is not None:
                    blur = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
                    blur_scores.append(blur)
                    if blur < 60:
                        asset_issues.append("blurry")
            except Exception:
                asset_issues.append("unreadable")
        else:
            asset_issues.append("missing-file")
        if asset_issues:
            issues.append({"assetId": asset["id"], "name": asset["name"], "issues": sorted(set(asset_issues))})
        if index == len(assets) or index % 5 == 0:
            elapsed = max(0.001, time.monotonic() - started)
            remaining = max(0, len(assets) - index)
            eta_seconds = round((elapsed / index) * remaining)
            with DATASET_HEALTH_PROGRESS_LOCK:
                DATASET_HEALTH_PROGRESS[project_id] = {
                    "scanning": True,
                    "progress": min(97, max(2, round(index / max(1, len(assets)) * 97))),
                    "processed": index,
                    "total": len(assets),
                    "stage": f"Checking {asset['name']}",
                    "etaSeconds": eta_seconds,
                    "startedMonotonic": started,
                }
    duplicate_groups = [ids for ids in hashes.values() if len(ids) > 1]
    duplicate_ids = {asset_id for group in duplicate_groups for asset_id in group[1:]}
    for asset_id in duplicate_ids:
        item = next((entry for entry in issues if entry["assetId"] == asset_id), None)
        if item:
            item["issues"].append("duplicate")
        else:
            asset = next(row for row in assets if row["id"] == asset_id)
            issues.append({"assetId": asset_id, "name": asset["name"], "issues": ["duplicate"]})
    imbalance = 0
    nonzero = [value for value in class_counts.values() if value]
    if len(nonzero) > 1:
        imbalance = round(max(nonzero) / max(1, min(nonzero)), 2)
    score = max(0, round(100 - len({item["assetId"] for item in issues}) / max(1, len(assets)) * 100))
    result = {
        "score": score,
        "assets": len(assets),
        "issues": issues,
        "issueAssets": len({item["assetId"] for item in issues}),
        "duplicateGroups": duplicate_groups,
        "classCounts": class_counts,
        "splitCounts": split_counts,
        "imbalanceRatio": imbalance,
        "averageBlurScore": round(sum(blur_scores) / len(blur_scores), 1) if blur_scores else 0,
    }
    with DATASET_HEALTH_PROGRESS_LOCK:
        DATASET_HEALTH_PROGRESS[project_id] = {
            "scanning": False,
            "progress": 100,
            "processed": len(assets),
            "total": len(assets),
            "stage": "Dataset scan complete",
            "etaSeconds": 0,
            "startedMonotonic": started,
        }
    return result


@app.get("/api/projects/{project_id}/health/progress")
def dataset_health_progress(project_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
    with DATASET_HEALTH_PROGRESS_LOCK:
        progress = dict(DATASET_HEALTH_PROGRESS.get(project_id, {}))
    progress.pop("startedMonotonic", None)
    return progress or {
        "scanning": False,
        "progress": 0,
        "processed": 0,
        "total": 0,
        "stage": "Ready to scan",
        "etaSeconds": 0,
    }


@app.get("/api/projects/{project_id}/annotation-jobs")
def list_annotation_jobs(project_id: str):
    with db() as con:
        rows = con.execute(
            "SELECT j.*,m.name assignee_name FROM annotation_jobs j LEFT JOIN workspace_members m ON m.id=j.assignee_id WHERE j.project_id=? ORDER BY j.created_at DESC",
            (project_id,),
        ).fetchall()
        assets = {row["id"]: row for row in con.execute("SELECT id,status,review_status FROM assets WHERE project_id=?", (project_id,))}
    result = []
    for row in rows:
        ids = json.loads(row["asset_ids"] or "[]")
        completed = sum(1 for asset_id in ids if assets.get(asset_id) and assets[asset_id]["status"] == "annotated")
        approved = sum(1 for asset_id in ids if assets.get(asset_id) and assets[asset_id]["review_status"] == "approved")
        result.append({"id": row["id"], "name": row["name"], "assigneeId": row["assignee_id"], "assigneeName": row["assignee_name"], "assetIds": ids, "status": row["status"], "completed": completed, "approved": approved, "total": len(ids), "createdAt": row["created_at"], "updatedAt": row["updated_at"]})
    return result


@app.post("/api/projects/{project_id}/annotation-jobs", status_code=201)
def create_annotation_job(project_id: str, payload: AnnotationJobPayload):
    job_id = uid()
    unique_ids = list(dict.fromkeys(payload.asset_ids))
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        found = con.execute(f"SELECT COUNT(*) n FROM assets WHERE project_id=? AND id IN ({','.join('?' for _ in unique_ids)})", (project_id, *unique_ids)).fetchone()["n"]
        if found != len(unique_ids):
            raise HTTPException(404, "One or more assets were not found")
        if payload.assignee_id and not con.execute("SELECT 1 FROM workspace_members WHERE id=?", (payload.assignee_id,)).fetchone():
            raise HTTPException(404, "Assignee not found")
        con.execute("INSERT INTO annotation_jobs (id,project_id,name,assignee_id,asset_ids,status,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?)", (job_id, project_id, payload.name.strip(), payload.assignee_id, json.dumps(unique_ids), now(), now()))
        log_activity(con, "annotation-job.created", f"{payload.name} · {len(unique_ids)} assets", project_id)
    return {"id": job_id, "status": "open"}


@app.put("/api/projects/{project_id}/annotation-jobs/{job_id}")
def update_annotation_job(project_id: str, job_id: str, payload: JobStatusPayload):
    with db() as con:
        result = con.execute("UPDATE annotation_jobs SET status=?,updated_at=? WHERE id=? AND project_id=?", (payload.status, now(), job_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Annotation job not found")
    return {"id": job_id, "status": payload.status}


def run_active_learning_scan(project_id: str, model_id: str, limit: int, confidence: float) -> None:
    started = time.monotonic()
    try:
        from ultralytics import YOLO
        with db() as con:
            model = con.execute("SELECT * FROM models WHERE id=? AND project_id=? AND weights_path IS NOT NULL", (model_id, project_id)).fetchone()
            assets = con.execute("SELECT * FROM assets WHERE project_id=? AND status='unannotated' ORDER BY rowid LIMIT ?", (project_id, limit)).fetchall()
        if not model or not model["weights_path"] or not Path(model["weights_path"]).is_file():
            return
        ACTIVE_LEARNING_PROGRESS[project_id] = {
            "progress": 2,
            "processed": 0,
            "total": len(assets),
            "etaSeconds": 0,
            "stage": "Loading detection model",
        }
        detector = YOLO(model["weights_path"])
        for index, asset in enumerate(assets, start=1):
            try:
                output = detector(asset["path"], conf=max(0.01, confidence / 2), verbose=False)[0]
                confidences = output.boxes.conf.tolist() if output.boxes is not None else []
                nearest = min((abs(float(value) - confidence) for value in confidences), default=0.5)
                score = round(max(0, 1 - nearest * 2), 4) if confidences else 0.75
                reason = "No confident detections" if not confidences else f"Prediction near {confidence:.0%} threshold"
                with db() as con:
                    con.execute("INSERT INTO active_learning_queue (id,project_id,asset_id,model_id,score,reason,status,created_at) VALUES (?,?,?,?,?,?,'pending',?) ON CONFLICT(project_id,asset_id) DO UPDATE SET model_id=excluded.model_id,score=excluded.score,reason=excluded.reason,status='pending',created_at=excluded.created_at", (uid(), project_id, asset["id"], model_id, score, reason, now()))
            except Exception:
                pass
            elapsed = max(0.001, time.monotonic() - started)
            ACTIVE_LEARNING_PROGRESS[project_id] = {
                "progress": min(99, round(index / max(1, len(assets)) * 100)),
                "processed": index,
                "total": len(assets),
                "etaSeconds": round((elapsed / index) * max(0, len(assets) - index)),
                "stage": f"Running inference on {asset['name']}",
            }
    finally:
        ACTIVE_LEARNING_SCANS.discard(project_id)
        current = ACTIVE_LEARNING_PROGRESS.get(project_id, {})
        ACTIVE_LEARNING_PROGRESS[project_id] = {
            **current,
            "progress": 100,
            "etaSeconds": 0,
            "stage": "Active-learning scan complete",
        }


@app.get("/api/projects/{project_id}/active-learning")
def active_learning_queue(project_id: str):
    with db() as con:
        rows = con.execute("SELECT q.*,a.name FROM active_learning_queue q JOIN assets a ON a.id=q.asset_id WHERE q.project_id=? ORDER BY q.score DESC,q.created_at DESC", (project_id,)).fetchall()
    return {"scanning": project_id in ACTIVE_LEARNING_SCANS, "progress": ACTIVE_LEARNING_PROGRESS.get(project_id, {}), "items": [{"id": row["id"], "assetId": row["asset_id"], "name": row["name"], "modelId": row["model_id"], "score": row["score"], "reason": row["reason"], "status": row["status"], "createdAt": row["created_at"]} for row in rows]}


@app.post("/api/projects/{project_id}/active-learning", status_code=202)
def start_active_learning(project_id: str, payload: ActiveLearningPayload, background_tasks: BackgroundTasks):
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE project_id=? AND weights_path IS NOT NULL AND (? IS NULL OR id=?) ORDER BY CASE stage WHEN 'production' THEN 0 ELSE 1 END,rowid DESC LIMIT 1", (project_id, payload.model_id, payload.model_id)).fetchone()
        if not model:
            raise HTTPException(400, "A ready model is required for active learning")
    if project_id in ACTIVE_LEARNING_SCANS:
        raise HTTPException(409, "Active-learning scan is already running")
    ACTIVE_LEARNING_SCANS.add(project_id)
    ACTIVE_LEARNING_PROGRESS[project_id] = {"progress": 1, "processed": 0, "total": payload.limit, "etaSeconds": 0, "stage": "Preparing active-learning scan"}
    background_tasks.add_task(run_active_learning_scan, project_id, model["id"], payload.limit, payload.confidence)
    return {"status": "scanning", "modelId": model["id"]}


@app.put("/api/projects/{project_id}/active-learning/{queue_id}")
def update_active_learning_item(project_id: str, queue_id: str, payload: QueueStatusPayload):
    with db() as con:
        result = con.execute("UPDATE active_learning_queue SET status=? WHERE id=? AND project_id=?", (payload.status, queue_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Queue item not found")
    return {"id": queue_id, "status": payload.status}


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        model_ids = [row["id"] for row in con.execute("SELECT id FROM models WHERE project_id=?", (project_id,))]
        con.execute("DELETE FROM activity_logs WHERE project_id=?", (project_id,))
        con.execute("DELETE FROM projects WHERE id=?", (project_id,))
    for root in (UPLOADS, VERSIONS):
        target = (root / project_id).resolve()
        if target.parent == root.resolve() and target.is_dir():
            shutil.rmtree(target)
    for model_id in model_ids:
        target = (RUNS / model_id).resolve()
        if target.parent == RUNS.resolve() and target.is_dir():
            shutil.rmtree(target)
    for archive in EXPORTS.glob(f"{project_id}-*.zip"):
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
        log_activity(con, "assets.uploaded", f"{len(created)} image(s) added", project_id)
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.post("/api/projects/{project_id}/import/yolo", status_code=201)
@app.post("/api/projects/{project_id}/import/annotated", status_code=201)
async def import_annotated_dataset(project_id: str, file: UploadFile = File(...)):
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
    imported_count = 0
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
            imported_count += 1
        if not imported_count:
            raise HTTPException(400, "No readable images found in archive")
        log_activity(con, "dataset.annotated-imported", f"{imported_count} image(s) imported from annotated ZIP", project_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.put("/api/projects/{project_id}/assets/{asset_id}/split")
def update_asset_split(project_id: str, asset_id: str, payload: SplitPayload):
    with db() as con:
        result = con.execute("UPDATE assets SET split=?,split_locked=1 WHERE id=? AND project_id=?", (payload.split, asset_id, project_id))
        if not result.rowcount:
            raise HTTPException(404, "Asset not found")
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.put("/api/projects/{project_id}/assets/{asset_id}/metadata")
def update_asset_metadata(project_id: str, asset_id: str, payload: AssetMetadataPayload):
    tags = list(dict.fromkeys(tag.strip() for tag in payload.tags if tag.strip()))[:30]
    metadata = {key.strip(): value.strip() for key, value in payload.metadata.items() if key.strip() and value.strip()}
    if len(metadata) > 50:
        raise HTTPException(400, "Asset metadata supports up to 50 fields")
    with db() as con:
        result = con.execute(
            "UPDATE assets SET name=?,tags=?,metadata=? WHERE id=? AND project_id=?",
            (payload.name.strip(), json.dumps(tags), json.dumps(metadata), asset_id, project_id),
        )
        if not result.rowcount:
            raise HTTPException(404, "Asset not found")
        log_activity(con, "asset.updated", payload.name.strip(), project_id)
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
        log_activity(con, f"assets.{payload.action}", f"{len(unique_ids)} image(s){' → ' + payload.value if payload.value else ''}", project_id)
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
def save_annotations(project_id: str, asset_id: str, payload: AnnotationPayload, request: Request):
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
        con.execute(
            "INSERT INTO annotation_revisions (id,project_id,asset_id,boxes,actor,created_at) VALUES (?,?,?,?,?,?)",
            (uid(), project_id, asset_id, json.dumps(boxes), getattr(request.state, "actor", "Local Owner"), now()),
        )
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return project_dict(con, row)


@app.get("/api/projects/{project_id}/assets/{asset_id}/collaboration")
def asset_collaboration(project_id: str, asset_id: str):
    with db() as con:
        if not con.execute("SELECT 1 FROM assets WHERE id=? AND project_id=?", (asset_id, project_id)).fetchone():
            raise HTTPException(404, "Asset not found")
        revisions = con.execute("SELECT id,actor,created_at,boxes FROM annotation_revisions WHERE asset_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50", (asset_id, project_id)).fetchall()
        comments = con.execute("SELECT id,actor,body,created_at FROM annotation_comments WHERE asset_id=? AND project_id=? ORDER BY created_at", (asset_id, project_id)).fetchall()
    return {
        "revisions": [{"id": row["id"], "actor": row["actor"], "createdAt": row["created_at"], "annotations": len(json.loads(row["boxes"] or "[]"))} for row in revisions],
        "comments": [{"id": row["id"], "actor": row["actor"], "body": row["body"], "createdAt": row["created_at"]} for row in comments],
    }


@app.post("/api/projects/{project_id}/assets/{asset_id}/comments", status_code=201)
def add_asset_comment(project_id: str, asset_id: str, payload: AnnotationCommentPayload, request: Request):
    comment_id = uid()
    with db() as con:
        if not con.execute("SELECT 1 FROM assets WHERE id=? AND project_id=?", (asset_id, project_id)).fetchone():
            raise HTTPException(404, "Asset not found")
        con.execute("INSERT INTO annotation_comments (id,project_id,asset_id,member_id,actor,body,created_at) VALUES (?,?,?,?,?,?,?)", (comment_id, project_id, asset_id, getattr(request.state, "member_id", None), getattr(request.state, "actor", "Local Owner"), payload.body.strip(), now()))
        log_activity(con, "annotation.comment", payload.body.strip()[:120], project_id, getattr(request.state, "actor", "Local Owner"))
    return {"id": comment_id, "actor": getattr(request.state, "actor", "Local Owner"), "body": payload.body.strip(), "createdAt": now()}


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


def make_yolo_version(
    con: sqlite3.Connection,
    project_id: str,
    version_no: int,
    payload: VersionPayload,
    progress_callback: Callable[[int, str, int, int], None] | None = None,
) -> tuple[Path, int]:
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
    augmentation_count = payload.augmentation_copies if payload.augmentations else 2
    total_work = len(assets) + sum(
        augmentation_count
        for asset in assets
        if payload.augment and assigned_splits[asset["id"]] == "train"
    )
    processed_work = 0
    if progress_callback:
        progress_callback(2, "Menyiapkan file dataset", 0, total_work)

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
        nonlocal processed_work
        image_path = target / "images" / split / f"{stem}.jpg"
        label_path = target / "labels" / split / f"{stem}.txt"
        image.save(image_path, "JPEG", quality=92)
        label_path.write_text(label_lines(boxes), encoding="utf-8")
        written[split].append((image_path, label_path))
        processed_work += 1
        if progress_callback:
            progress_callback(
                min(95, 5 + round((processed_work / max(1, total_work)) * 90)),
                "Membentuk file dataset",
                processed_work,
                total_work,
            )

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
        if keypoint_count == 17 and classes == ["person"]:
            yaml_text += "flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]\n"
    (target / "data.yaml").write_text(yaml_text, encoding="utf-8")
    return target, sum(len(items) for items in written.values())


def make_classification_version(
    con: sqlite3.Connection,
    project_id: str,
    version_no: int,
    payload: VersionPayload,
    progress_callback: Callable[[int, str, int, int], None] | None = None,
) -> tuple[Path, int]:
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
    if progress_callback:
        progress_callback(2, "Menyiapkan file dataset", 0, len(assets))
    for asset_index, asset in enumerate(assets):
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
        if progress_callback:
            progress_callback(
                min(95, 5 + round(((asset_index + 1) / max(1, len(assets))) * 90)),
                "Membentuk file dataset",
                asset_index + 1,
                len(assets),
            )
    (target / "classification.json").write_text(json.dumps({"task": project["type"], "classes": classes, "splits": payload.splits}, indent=2), encoding="utf-8")
    return target, written


@app.get("/api/projects/{project_id}/versions/progress")
def version_generation_progress(project_id: str):
    with VERSION_GENERATION_LOCK:
        return VERSION_GENERATION_PROGRESS.get(
            project_id,
            {
                "status": "idle",
                "progress": 0,
                "stage": "Belum ada proses generate",
                "error": None,
                "processed": 0,
                "total": 0,
                "updatedAt": now(),
            },
        ).copy()


@app.post("/api/projects/{project_id}/versions", status_code=201)
def generate_version(project_id: str, payload: VersionPayload):
    with VERSION_GENERATION_LOCK:
        current = VERSION_GENERATION_PROGRESS.get(project_id)
        if current and current.get("status") == "running":
            raise HTTPException(409, "Immutable dataset version is already being generated")
        VERSION_GENERATION_PROGRESS[project_id] = {
            "status": "running",
            "progress": 1,
            "stage": "Menyiapkan dataset",
            "error": None,
            "processed": 0,
            "total": 0,
            "updatedAt": now(),
        }
    try:
        return build_version(project_id, payload)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        set_version_generation_progress(
            project_id,
            0,
            "Generate gagal",
            status="failed",
            error=str(detail),
        )
        raise


def build_version(project_id: str, payload: VersionPayload):
    set_version_generation_progress(project_id, 1, "Menyiapkan dataset")
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        count = con.execute("SELECT COUNT(*) n FROM assets WHERE project_id=?", (project_id,)).fetchone()["n"]
        if not count:
            raise HTTPException(400, "Upload at least one image first")
        set_version_generation_progress(
            project_id,
            1,
            "Menyiapkan dataset",
            processed=0,
            total=count,
        )
        version_no = con.execute("SELECT COALESCE(MAX(number),0)+1 n FROM versions WHERE project_id=?", (project_id,)).fetchone()["n"]
        update_progress = lambda progress, stage, processed, total: set_version_generation_progress(
            project_id,
            progress,
            stage,
            processed=processed,
            total=total,
        )
        if project["type"] in {"Single-Label Classification", "Multi-Label Classification"}:
            target, generated_images = make_classification_version(con, project_id, version_no, payload, update_progress)
        else:
            target, generated_images = make_yolo_version(con, project_id, version_no, payload, update_progress)
        set_version_generation_progress(project_id, 97, "Menyimpan immutable snapshot")
        snapshot_assets = [
            {
                "id": asset["id"],
                "name": asset["name"],
                "split": asset["split"],
                "boxes": json.loads(asset["boxes"] or "[]"),
                "tags": json.loads(asset["tags"] or "[]"),
                "metadata": json.loads(asset["metadata"] or "{}"),
            }
            for asset in con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (project_id,))
        ]
        (target / "snapshot.json").write_text(
            json.dumps({"projectId": project_id, "version": version_no, "assets": snapshot_assets}, indent=2),
            encoding="utf-8",
        )
        version_id = uid()
        con.execute("INSERT INTO versions (id,project_id,number,created_at,images,resize,augment,splits,path,augmentations,generated_images) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (version_id, project_id, version_no, now()[:10], count, payload.resize, int(payload.augment), json.dumps(payload.splits), str(target), json.dumps({"copies": payload.augmentation_copies, "transforms": payload.augmentations}), generated_images))
        log_activity(con, "version.generated", f"Version {version_no} · {generated_images} generated images", project_id)
        saved = project_dict(con, project)
        set_version_generation_progress(project_id, 100, "Immutable version selesai", "completed")
        return saved


@app.put("/api/projects/{project_id}/versions/{version_id}")
def update_version(project_id: str, version_id: str, payload: VersionUpdatePayload):
    tags = list(dict.fromkeys(tag.strip() for tag in payload.tags if tag.strip()))[:30]
    with db() as con:
        result = con.execute(
            "UPDATE versions SET name=?,notes=?,tags=? WHERE id=? AND project_id=?",
            (payload.name.strip(), payload.notes.strip(), json.dumps(tags), version_id, project_id),
        )
        if not result.rowcount:
            raise HTTPException(404, "Dataset version not found")
        log_activity(con, "version.updated", payload.name.strip(), project_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


def load_version_snapshot(version: sqlite3.Row) -> dict[str, Any]:
    snapshot = Path(version["path"]) / "snapshot.json"
    if not snapshot.is_file():
        raise HTTPException(409, "This legacy version has no rollback snapshot")
    try:
        return json.loads(snapshot.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, "Version snapshot is unreadable") from exc


@app.get("/api/projects/{project_id}/versions/{version_id}/diff")
def version_diff(project_id: str, version_id: str):
    with db() as con:
        version = con.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (version_id, project_id)).fetchone()
        if not version:
            raise HTTPException(404, "Dataset version not found")
        current = {row["id"]: row for row in con.execute("SELECT * FROM assets WHERE project_id=?", (project_id,))}
    snapshot = load_version_snapshot(version)
    previous = {asset["id"]: asset for asset in snapshot.get("assets", [])}
    added = [asset_id for asset_id in current if asset_id not in previous]
    removed = [asset_id for asset_id in previous if asset_id not in current]
    changed = []
    for asset_id in current.keys() & previous.keys():
        row = current[asset_id]
        old = previous[asset_id]
        if json.loads(row["boxes"] or "[]") != old.get("boxes", []) or row["split"] != old.get("split"):
            changed.append(asset_id)
    return {"versionId": version_id, "added": added, "removed": removed, "changed": changed, "unchanged": len(current.keys() & previous.keys()) - len(changed)}


@app.post("/api/projects/{project_id}/versions/{version_id}/rollback")
def rollback_version(project_id: str, version_id: str):
    with db() as con:
        version = con.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (version_id, project_id)).fetchone()
        if not version:
            raise HTTPException(404, "Dataset version not found")
        snapshot = load_version_snapshot(version)
        restored = 0
        for asset in snapshot.get("assets", []):
            boxes = asset.get("boxes", [])
            result = con.execute(
                "UPDATE assets SET split=?,boxes=?,status=?,review_status='pending',tags=?,metadata=? WHERE id=? AND project_id=?",
                (asset.get("split", "train"), json.dumps(boxes), "annotated" if boxes else "unannotated", json.dumps(asset.get("tags", [])), json.dumps(asset.get("metadata", {})), asset["id"], project_id),
            )
            restored += result.rowcount
        log_activity(con, "version.rolled-back", f"Restored {restored} assets from version {version['number']}", project_id)
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
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


@app.get("/api/projects/{project_id}/export")
def export_annotated_dataset(project_id: str, format: str = "yolo"):
    export_format = format.lower()
    if export_format not in {"yolo", "coco", "voc", "labelme", "masks"}:
        raise HTTPException(400, "Supported formats: yolo, coco, voc, labelme, masks")
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        assets = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid", (project_id,)).fetchall()
    classes = json.loads(project["classes"] or "[]")
    class_index = {name: index for index, name in enumerate(classes)}
    archive = EXPORTS / f"{project_id}-annotated-{export_format}-{int(time.time())}.zip"
    coco: dict[str, Any] = {"images": [], "annotations": [], "categories": [{"id": index + 1, "name": name} for index, name in enumerate(classes)]}
    annotation_id = 1
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        if export_format == "yolo":
            bundle.writestr("data.yaml", "path: .\ntrain: images/train\nval: images/valid\ntest: images/test\nnames:\n" + "".join(f"  {index}: {json.dumps(name)}\n" for index, name in enumerate(classes)))
        if export_format == "masks":
            bundle.writestr("classes.json", json.dumps({index + 1: name for index, name in enumerate(classes)}, indent=2))
        for image_id, asset in enumerate(assets, 1):
            path = Path(asset["path"])
            if not path.is_file():
                continue
            suffix = path.suffix.lower() or ".jpg"
            stem = asset["id"]
            image_name = f"{stem}{suffix}"
            split = asset["split"]
            boxes = json.loads(asset["boxes"] or "[]")
            with Image.open(path) as raw:
                image = ImageOps.exif_transpose(raw).convert("RGB")
                width, height = image.size
                if export_format == "masks":
                    mask = Image.new("L", image.size, 0)
                    draw = ImageDraw.Draw(mask)
                    for box in boxes:
                        value = class_index.get(box.get("label"), -1) + 1
                        if value <= 0:
                            continue
                        points = box.get("points") or []
                        if len(points) >= 3:
                            draw.polygon([(point["x"] / 100 * width, point["y"] / 100 * height) for point in points], fill=value)
                        else:
                            draw.rectangle((box["x"] / 100 * width, box["y"] / 100 * height, (box["x"] + box["w"]) / 100 * width, (box["y"] + box["h"]) / 100 * height), fill=value)
                    output = io.BytesIO()
                    mask.save(output, "PNG")
                    bundle.writestr(f"masks/{split}/{stem}.png", output.getvalue())
            bundle.write(path, f"images/{split}/{image_name}")
            if export_format == "yolo":
                lines = []
                for box in boxes:
                    index = class_index.get(box.get("label"))
                    if index is None:
                        continue
                    points = box.get("points") or []
                    if len(points) >= 3:
                        lines.append(" ".join([str(index), *[f"{coordinate:.6f}" for point in points for coordinate in (point["x"] / 100, point["y"] / 100)]]))
                    else:
                        lines.append(f"{index} {(box['x'] + box['w'] / 2) / 100:.6f} {(box['y'] + box['h'] / 2) / 100:.6f} {box['w'] / 100:.6f} {box['h'] / 100:.6f}")
                bundle.writestr(f"labels/{split}/{stem}.txt", "\n".join(lines))
            elif export_format == "coco":
                coco["images"].append({"id": image_id, "file_name": f"images/{split}/{image_name}", "width": width, "height": height})
                for box in boxes:
                    index = class_index.get(box.get("label"))
                    if index is None:
                        continue
                    x, y, w, h = box["x"] / 100 * width, box["y"] / 100 * height, box["w"] / 100 * width, box["h"] / 100 * height
                    points = box.get("points") or []
                    coco["annotations"].append({"id": annotation_id, "image_id": image_id, "category_id": index + 1, "bbox": [x, y, w, h], "area": w * h, "iscrowd": 0, **({"segmentation": [[coordinate for point in points for coordinate in (point["x"] / 100 * width, point["y"] / 100 * height)]]} if len(points) >= 3 else {})})
                    annotation_id += 1
            elif export_format == "voc":
                root = ET.Element("annotation")
                ET.SubElement(root, "filename").text = image_name
                size = ET.SubElement(root, "size")
                ET.SubElement(size, "width").text, ET.SubElement(size, "height").text, ET.SubElement(size, "depth").text = str(width), str(height), "3"
                for box in boxes:
                    obj = ET.SubElement(root, "object")
                    ET.SubElement(obj, "name").text = box.get("label", "object")
                    bounds = ET.SubElement(obj, "bndbox")
                    for key, value in (("xmin", box["x"] / 100 * width), ("ymin", box["y"] / 100 * height), ("xmax", (box["x"] + box["w"]) / 100 * width), ("ymax", (box["y"] + box["h"]) / 100 * height)):
                        ET.SubElement(bounds, key).text = str(round(value))
                bundle.writestr(f"annotations/{stem}.xml", ET.tostring(root, encoding="unicode"))
            elif export_format == "labelme":
                shapes = []
                for box in boxes:
                    points = box.get("points") or []
                    if len(points) >= 3:
                        pixel_points = [[point["x"] / 100 * width, point["y"] / 100 * height] for point in points]
                        shape_type = "polygon"
                    else:
                        pixel_points = [[box["x"] / 100 * width, box["y"] / 100 * height], [(box["x"] + box["w"]) / 100 * width, (box["y"] + box["h"]) / 100 * height]]
                        shape_type = "rectangle"
                    shapes.append({"label": box.get("label", "object"), "points": pixel_points, "shape_type": shape_type, "flags": {}})
                bundle.writestr(f"annotations/{stem}.json", json.dumps({"version": "5.0.1", "flags": {}, "shapes": shapes, "imagePath": f"../images/{split}/{image_name}", "imageHeight": height, "imageWidth": width}, indent=2))
        if export_format == "coco":
            bundle.writestr("annotations.json", json.dumps(coco, indent=2))
    return FileResponse(archive, media_type="application/zip", filename=archive.name)


def cached_version_archive(
    source: Path,
    archive: Path,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> Path:
    """Build an immutable dataset archive once, without exposing partial ZIPs."""

    def report(**detail: Any) -> None:
        if progress_callback:
            progress_callback(detail)

    def valid(candidate: Path) -> bool:
        if not candidate.is_file():
            return False
        try:
            with zipfile.ZipFile(candidate) as bundle:
                bundle.infolist()
            return True
        except (OSError, zipfile.BadZipFile):
            return False

    if valid(archive):
        report(stage="Dataset archive ready", archivePercent=100)
        return archive
    with VERSION_EXPORT_LOCK:
        if valid(archive):
            report(stage="Dataset archive ready", archivePercent=100)
            return archive
        temporary = archive.with_name(f".{archive.name}.{uid()}.building")
        try:
            # Generated images are already compressed. ZIP_STORED avoids spending
            # many minutes recompressing multi-gigabyte immutable versions.
            with zipfile.ZipFile(
                temporary,
                "w",
                compression=zipfile.ZIP_STORED,
                allowZip64=True,
            ) as bundle:
                report(stage="Scanning dataset files", archivePercent=0)
                paths = sorted(path for path in source.rglob("*") if path.is_file())
                total_files = len(paths)
                total_bytes = sum(path.stat().st_size for path in paths)
                written_bytes = 0
                report(
                    stage="Packaging dataset for laptop",
                    archivePercent=0,
                    processedFiles=0,
                    totalFiles=total_files,
                    processedBytes=0,
                    totalBytes=total_bytes,
                )
                report_every = max(1, total_files // 200)
                for index, path in enumerate(paths, 1):
                    bundle.write(path, path.relative_to(source).as_posix())
                    written_bytes += path.stat().st_size
                    if index == total_files or index % report_every == 0:
                        report(
                            stage="Packaging dataset for laptop",
                            archivePercent=round(index / max(1, total_files) * 100),
                            processedFiles=index,
                            totalFiles=total_files,
                            processedBytes=written_bytes,
                            totalBytes=total_bytes,
                        )
            temporary.replace(archive)
            report(
                stage="Dataset archive ready",
                archivePercent=100,
                processedFiles=total_files,
                totalFiles=total_files,
                processedBytes=total_bytes,
                totalBytes=total_bytes,
            )
        except Exception:
            report(stage="Dataset packaging failed", archivePercent=0)
            raise
        finally:
            temporary.unlink(missing_ok=True)
    return archive


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
        archive = cached_version_archive(
            source,
            EXPORTS / f"{project_id}-v{version['number']}-classification.zip",
        )
        return FileResponse(archive, media_type="application/zip", filename=archive.name)
    archive_base = EXPORTS / f"{project_id}-v{version['number']}-{format.lower()}"
    if format.lower() == "yolo":
        archive = cached_version_archive(source, archive_base.with_suffix(".zip"))
    else:
        import yaml
        config = yaml.safe_load((source / "data.yaml").read_text(encoding="utf-8"))
        names_raw = config.get("names", {})
        names = [names_raw[key] for key in sorted(names_raw)] if isinstance(names_raw, dict) else list(names_raw)
        coco: dict[str, Any] = {
            "info": {"description": f"Salnova {project_id} dataset v{version['number']}", "version": str(version["number"])},
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


def worker_from_request(request: Request) -> sqlite3.Row:
    authorization = request.headers.get("Authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Worker token required")
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with db() as con:
        worker = con.execute(
            "SELECT * FROM training_workers WHERE token_hash=? AND revoked=0",
            (token_hash,),
        ).fetchone()
    if not worker:
        raise HTTPException(401, "Invalid or revoked worker token")
    return worker


def worker_json(row: sqlite3.Row) -> dict[str, Any]:
    last_seen = row["last_seen"]
    online = False
    if last_seen:
        try:
            online = datetime.fromisoformat(last_seen) > datetime.now(timezone.utc) - timedelta(seconds=90)
        except ValueError:
            pass
    return {
        "id": row["id"],
        "name": row["name"],
        "prefix": row["prefix"] or "legacy",
        "capabilities": json.loads(row["capabilities"] or "{}"),
        "status": "revoked" if row["revoked"] else (row["status"] if online else "offline"),
        "currentModelId": row["current_model_id"],
        "lastSeen": last_seen,
        "createdAt": row["created_at"],
        "revoked": bool(row["revoked"]),
    }


def remote_job_json(con: sqlite3.Connection, model: sqlite3.Row) -> dict[str, Any]:
    project = con.execute("SELECT name,type FROM projects WHERE id=?", (model["project_id"],)).fetchone()
    version = con.execute(
        "SELECT id,number FROM versions WHERE project_id=? AND number=?",
        (model["project_id"], model["version"]),
    ).fetchone()
    if not project or not version:
        raise HTTPException(409, "Training job dataset is unavailable")
    config = json.loads(model["config"] or "{}")
    base_weights_url = None
    base_model_id = config.get("base_model_id")
    if base_model_id:
        base_model = con.execute(
            "SELECT weights_path FROM models WHERE id=? AND project_id=?",
            (base_model_id, model["project_id"]),
        ).fetchone()
        if base_model and base_model["weights_path"] and Path(base_model["weights_path"]).is_file():
            base_weights_url = f"/api/training-workers/agent/jobs/{model['id']}/base-weights"
    last_checkpoint = RUNS / model["id"] / "weights" / "last.pt"
    recovery_checkpoint = Path(model["weights_path"]) if model["weights_path"] else None
    return {
        "id": model["id"],
        "projectId": model["project_id"],
        "projectName": project["name"],
        "projectType": project["type"],
        "version": version["number"],
        "config": config,
        "datasetUrl": f"/api/training-workers/agent/jobs/{model['id']}/dataset",
        "resumeUrl": f"/api/training-workers/agent/jobs/{model['id']}/checkpoint/last" if last_checkpoint.is_file() else None,
        "recoveryUrl": f"/api/training-workers/agent/jobs/{model['id']}/checkpoint/best" if not last_checkpoint.is_file() and recovery_checkpoint and recovery_checkpoint.is_file() else None,
        "baseWeightsUrl": base_weights_url,
    }


@app.get("/api/training-workers")
def list_training_workers():
    with db() as con:
        rows = con.execute("SELECT * FROM training_workers ORDER BY created_at DESC").fetchall()
    return [worker_json(row) for row in rows]


@app.get("/api/training-workers/setup/{filename}")
def training_worker_setup_file(filename: str):
    allowed = {
        "visionflow_worker.py": ROOT / "worker" / "visionflow_worker.py",
        "requirements.txt": ROOT / "worker" / "requirements.txt",
    }
    path = allowed.get(filename)
    if not path:
        raise HTTPException(404, "Worker setup file not found")
    return FileResponse(path)


@app.post("/api/training-workers", status_code=201)
def create_training_worker(payload: TrainingWorkerPayload):
    worker_name = payload.name.strip()
    if not worker_name:
        raise HTTPException(400, "Worker name is required")
    raw_token = "vfw_" + secrets.token_urlsafe(36)
    worker_id = uid()
    prefix = raw_token[:12]
    with db() as con:
        con.execute(
            "INSERT INTO training_workers (id,name,token_hash,prefix,capabilities,status,last_seen,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (
                worker_id,
                worker_name,
                hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                prefix,
                "{}",
                "offline",
                "1970-01-01T00:00:00+00:00",
                now(),
            ),
        )
        row = con.execute("SELECT * FROM training_workers WHERE id=?", (worker_id,)).fetchone()
        log_activity(con, "training-worker.created", worker_name)
    return {**worker_json(row), "token": raw_token}


@app.delete("/api/training-workers/{worker_id}", status_code=204)
def revoke_training_worker(worker_id: str):
    with db() as con:
        worker = con.execute("SELECT * FROM training_workers WHERE id=?", (worker_id,)).fetchone()
        if not worker:
            raise HTTPException(404, "Training worker not found")
        if worker["current_model_id"]:
            active = con.execute("SELECT status FROM models WHERE id=?", (worker["current_model_id"],)).fetchone()
            if active and active["status"] == "training":
                raise HTTPException(409, "Cancel the worker's active training job first")
        for queued in con.execute("SELECT id,config FROM models WHERE status='queued'").fetchall():
            config = json.loads(queued["config"] or "{}")
            if config.get("worker_id") == worker_id:
                config["worker_id"] = None
                con.execute("UPDATE models SET config=? WHERE id=?", (json.dumps(config), queued["id"]))
        con.execute("UPDATE training_workers SET revoked=1,status='offline',current_model_id=NULL WHERE id=?", (worker_id,))


@app.post("/api/training-workers/agent/heartbeat")
def training_worker_heartbeat(payload: WorkerHeartbeatPayload, request: Request):
    worker = worker_from_request(request)
    capabilities = {
        "cuda": bool(payload.capabilities.get("cuda")),
        "gpuName": str(payload.capabilities.get("gpuName", ""))[:160],
        "gpuCount": (
            max(0, min(32, int(payload.capabilities.get("gpuCount", 0) or 0)))
            if str(payload.capabilities.get("gpuCount", 0) or 0).isdigit()
            else 0
        ),
        "torchVersion": str(payload.capabilities.get("torchVersion", ""))[:80],
        "cudaVersion": str(payload.capabilities.get("cudaVersion", ""))[:80],
        "cpu": str(payload.capabilities.get("cpu", ""))[:160],
        "platform": str(payload.capabilities.get("platform", ""))[:160],
        "provider": str(payload.capabilities.get("provider", "local"))[:40],
    }
    with db() as con:
        con.execute(
            "UPDATE training_workers SET capabilities=?,last_seen=?,status=CASE WHEN current_model_id IS NULL THEN 'online' ELSE 'busy' END WHERE id=?",
            (json.dumps(capabilities), now(), worker["id"]),
        )
    return {"id": worker["id"], "status": "ok"}


@app.post("/api/training-workers/agent/claim")
def claim_training_job(request: Request):
    worker = worker_from_request(request)
    stale_before = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    with db() as con:
        stale_workers = con.execute(
            "SELECT * FROM training_workers WHERE current_model_id IS NOT NULL AND (revoked=1 OR last_seen IS NULL OR last_seen<?)",
            (stale_before,),
        ).fetchall()
        for stale in stale_workers:
            model = con.execute("SELECT status,config FROM models WHERE id=?", (stale["current_model_id"],)).fetchone()
            if model and model["status"] == "training" and json.loads(model["config"] or "{}").get("execution_target", "server") != "server":
                con.execute(
                    "UPDATE models SET status='paused',worker_id=NULL,error='Remote worker disconnected; press Resume training to continue',training_detail=? WHERE id=?",
                    (json.dumps({"stage": "Worker disconnected; waiting for user resume"}), stale["current_model_id"]),
                )
            con.execute("UPDATE training_workers SET current_model_id=NULL,status='offline' WHERE id=?", (stale["id"],))
        current = con.execute("SELECT * FROM models WHERE id=? AND worker_id=?", (worker["current_model_id"], worker["id"])).fetchone() if worker["current_model_id"] else None
        if current and current["status"] == "training":
            con.execute("UPDATE training_workers SET last_seen=?,status='busy' WHERE id=?", (now(), worker["id"]))
            return remote_job_json(con, current)
        if worker["current_model_id"]:
            con.execute("UPDATE training_workers SET current_model_id=NULL,status='online' WHERE id=?", (worker["id"],))
        capabilities = json.loads(worker["capabilities"] or "{}")
        selected = None
        candidates = con.execute("SELECT * FROM models WHERE status='queued' ORDER BY rowid").fetchall()
        candidates = sorted(
            candidates,
            key=lambda candidate: 0
            if json.loads(candidate["config"] or "{}").get("worker_id") == worker["id"]
            else 1,
        )
        for candidate in candidates:
            config = json.loads(candidate["config"] or "{}")
            target = config.get("execution_target", "server")
            if not str(target).startswith(("remote-", "colab-")):
                continue
            activated_at = config.get("queue_activated_at") or candidate["created_at"]
            try:
                queue_is_current = datetime.fromisoformat(activated_at) >= (
                    datetime.now(timezone.utc)
                    - timedelta(minutes=REMOTE_QUEUE_TTL_MINUTES)
                )
            except (TypeError, ValueError):
                queue_is_current = False
            if not queue_is_current:
                con.execute(
                    "UPDATE models SET status='paused',worker_id=NULL,error=?,training_detail=? WHERE id=? AND status='queued'",
                    (
                        "Worker queue expired; press Resume training to authorize this job again",
                        json.dumps({"stage": "Waiting for user to resume expired job"}),
                        candidate["id"],
                    ),
                )
                continue
            if config.get("worker_id") and config["worker_id"] != worker["id"]:
                continue
            if str(target).startswith("colab-") and capabilities.get("provider") != "google-colab":
                continue
            if target in {"remote-gpu", "colab-gpu"} and not capabilities.get("cuda"):
                continue
            selected = candidate
            break
        if not selected:
            con.execute("UPDATE training_workers SET last_seen=?,status='online' WHERE id=?", (now(), worker["id"]))
            return Response(status_code=204)
        updated = con.execute(
            "UPDATE models SET status='training',progress=2,error=NULL,worker_id=?,training_detail=? WHERE id=? AND status='queued'",
            (worker["id"], json.dumps({"stage": "Worker claimed job"}), selected["id"]),
        )
        if not updated.rowcount:
            return Response(status_code=204)
        con.execute("UPDATE training_workers SET current_model_id=?,last_seen=?,status='busy' WHERE id=?", (selected["id"], now(), worker["id"]))
        selected = con.execute("SELECT * FROM models WHERE id=?", (selected["id"],)).fetchone()
        return remote_job_json(con, selected)


def assigned_remote_model(con: sqlite3.Connection, worker_id: str, model_id: str) -> sqlite3.Row:
    model = con.execute("SELECT * FROM models WHERE id=? AND worker_id=?", (model_id, worker_id)).fetchone()
    if not model:
        raise HTTPException(404, "Assigned training job not found")
    return model


@app.get("/api/training-workers/agent/jobs/{model_id}")
def remote_training_status(model_id: str, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
    return {
        "id": model_id,
        "status": model["status"],
        "progress": model["progress"],
        "cancelled": model["status"] == "cancelled",
        "trainingDetail": json.loads(model["training_detail"] or "{}"),
    }


@app.get("/api/training-workers/agent/jobs/{model_id}/dataset")
def remote_training_dataset(model_id: str, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        version = con.execute("SELECT id,path FROM versions WHERE project_id=? AND number=?", (model["project_id"], model["version"])).fetchone()
    if model["status"] != "training" or not version:
        raise HTTPException(409, "Training dataset is no longer available for this job")
    source = Path(version["path"]).resolve()
    archive = EXPORTS / f"{model['project_id']}-v{model['version']}-yolo.zip"

    def update_archive_progress(detail: dict[str, Any]) -> None:
        with db() as progress_db:
            current = progress_db.execute(
                "SELECT status FROM models WHERE id=? AND worker_id=?",
                (model_id, worker["id"]),
            ).fetchone()
            if current and current["status"] == "training":
                progress_db.execute(
                    "UPDATE models SET progress=?,training_detail=? WHERE id=?",
                    (
                        5 if detail.get("archivePercent") == 100 else 3,
                        json.dumps(detail),
                        model_id,
                    ),
                )

    archive = cached_version_archive(source, archive, update_archive_progress)
    return FileResponse(archive, media_type="application/zip", filename=archive.name)


@app.get("/api/training-workers/agent/jobs/{model_id}/checkpoint/{kind}")
def remote_training_checkpoint(model_id: str, kind: str, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
    if kind == "last":
        checkpoint = RUNS / model_id / "weights" / "last.pt"
    elif kind == "best" and model["weights_path"]:
        checkpoint = Path(model["weights_path"])
    else:
        raise HTTPException(404, "Checkpoint is unavailable")
    if not checkpoint.is_file():
        raise HTTPException(404, "Checkpoint is unavailable")
    return FileResponse(checkpoint, media_type="application/octet-stream", filename=f"{kind}.pt")


@app.get("/api/training-workers/agent/jobs/{model_id}/base-weights")
def remote_training_base_weights(model_id: str, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        config = json.loads(model["config"] or "{}")
        source = con.execute(
            "SELECT weights_path FROM models WHERE id=? AND project_id=?",
            (config.get("base_model_id"), model["project_id"]),
        ).fetchone()
    if not source or not source["weights_path"] or not Path(source["weights_path"]).is_file():
        raise HTTPException(404, "Fine-tune base checkpoint is unavailable")
    return FileResponse(Path(source["weights_path"]), media_type="application/octet-stream", filename="base-best.pt")


@app.post("/api/training-workers/agent/jobs/{model_id}/checkpoint/{kind}")
async def upload_remote_training_checkpoint(model_id: str, kind: str, request: Request):
    if kind not in {"last", "best"}:
        raise HTTPException(400, "Checkpoint kind must be last or best")
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] not in {"training", "cancelled"}:
            raise HTTPException(409, f"Training job is {model['status']}")
    target = RUNS / model_id / "weights" / f"{kind}.pt"
    partial = target.with_suffix(".upload.pt")
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with partial.open("wb") as output:
            async for chunk in request.stream():
                if chunk:
                    size += len(chunk)
                    if size > 2 * 1024 * 1024 * 1024:
                        raise HTTPException(413, "Checkpoint exceeds 2 GB")
                    output.write(chunk)
        if size < 1024:
            raise HTTPException(400, "Checkpoint is empty or invalid")
        from ultralytics import YOLO
        YOLO(str(partial))
        partial.replace(target)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        LOGGER.exception("Remote %s checkpoint validation failed for model %s", kind, model_id)
        raise HTTPException(400, "Uploaded checkpoint could not be validated") from exc
    if kind == "best":
        with db() as con:
            con.execute("UPDATE models SET weights_path=? WHERE id=?", (str(target), model_id))
    return {"status": "saved", "kind": kind, "bytes": size}


@app.post("/api/training-workers/agent/jobs/{model_id}/paused")
def pause_remote_training(model_id: str, request: Request):
    worker = worker_from_request(request)
    last_checkpoint = RUNS / model_id / "weights" / "last.pt"
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        status = "paused" if last_checkpoint.is_file() else "cancelled"
        error = None if status == "paused" else "Paused before the first resumable epoch checkpoint was saved"
        con.execute(
            "UPDATE models SET status=?,error=?,training_detail=? WHERE id=?",
            (status, error, json.dumps({"stage": "Paused" if status == "paused" else "Cancelled without checkpoint"}), model_id),
        )
        con.execute("UPDATE training_workers SET current_model_id=NULL,last_seen=?,status='online' WHERE id=?", (now(), worker["id"]))
    return {"status": status, "modelId": model_id}


@app.post("/api/training-workers/agent/jobs/{model_id}/progress")
def remote_training_progress(model_id: str, payload: WorkerProgressPayload, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] != "training":
            raise HTTPException(409, f"Training job is {model['status']}")
        history = json.loads(model["metrics_history"] or "[]")
        if payload.metrics:
            history.append({"epoch": payload.epoch or len(history) + 1, **{key: round(float(value), 6) for key, value in payload.metrics.items()}})
        detail = {
            "stage": payload.stage,
            "epoch": payload.epoch,
            "totalEpochs": payload.total_epochs,
            "batch": payload.batch,
            "totalBatches": payload.total_batches,
            "loss": round(payload.loss, 6) if payload.loss is not None else None,
        }
        con.execute(
            "UPDATE models SET progress=?,metrics_history=?,training_detail=? WHERE id=?",
            (payload.progress, json.dumps(history[-500:]), json.dumps(detail), model_id),
        )
        con.execute("UPDATE training_workers SET last_seen=?,status='busy' WHERE id=?", (now(), worker["id"]))
    return {"status": "ok"}


def metric_percent(metrics: dict[str, Any], *keys: str) -> float:
    value = next((float(metrics[key]) for key in keys if key in metrics), 0.0)
    return round(value * 100 if abs(value) <= 1 else value, 1)


@app.post("/api/training-workers/agent/jobs/{model_id}/complete")
async def complete_remote_training(model_id: str, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] != "training":
            raise HTTPException(409, f"Training job is {model['status']}")
    target = RUNS / model_id / "weights" / "best.pt"
    partial = target.with_name("best.upload.pt")
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with partial.open("wb") as output:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > 2 * 1024 * 1024 * 1024:
                    raise HTTPException(413, "Checkpoint exceeds 2 GB")
                output.write(chunk)
        if size < 1024:
            raise HTTPException(400, "Checkpoint is empty or invalid")
        from ultralytics import YOLO
        YOLO(str(partial))
        parsed_metrics = json.loads(request.headers.get("X-VisionFlow-Metrics", "{}"))
        if not isinstance(parsed_metrics, dict):
            raise ValueError("metrics must be a JSON object")
    except Exception as exc:
        partial.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        LOGGER.exception("Remote checkpoint validation failed for model %s", model_id)
        raise HTTPException(400, "Uploaded checkpoint could not be validated") from exc
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] != "training":
            partial.unlink(missing_ok=True)
            raise HTTPException(409, f"Training job is {model['status']}")
        partial.replace(target)
        con.execute(
            "UPDATE models SET status='ready',progress=100,map=?,precision=?,recall=?,weights_path=?,error=NULL,training_detail=? WHERE id=?",
            (metric_percent(parsed_metrics, "metrics/accuracy_top1", "metrics/mAP50(B)", "metrics/mAP50(M)", "map50"), metric_percent(parsed_metrics, "metrics/precision(B)", "metrics/precision(M)", "precision"), metric_percent(parsed_metrics, "metrics/recall(B)", "metrics/recall(M)", "recall"), str(target), json.dumps({"stage": "Training complete"}), model_id),
        )
        con.execute("UPDATE training_workers SET current_model_id=NULL,last_seen=?,status='online' WHERE id=?", (now(), worker["id"]))
        log_activity(con, "training.remote-completed", f"{model['name']} by worker {worker['name']} · {size} bytes", model["project_id"], worker["name"])
    return {"status": "ready", "modelId": model_id, "bytes": size}


@app.post("/api/training-workers/agent/jobs/{model_id}/artifacts")
async def upload_remote_training_artifacts(model_id: str, request: Request):
    """Persist the safe, downloadable evaluation output produced by a remote worker."""
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] not in {"training", "ready"}:
            raise HTTPException(409, f"Training job is {model['status']}")
    run_dir = RUNS / model_id
    archive_path = run_dir / ".evaluation.upload.zip"
    run_dir.mkdir(parents=True, exist_ok=True)
    received = 0
    try:
        with archive_path.open("wb") as output:
            async for chunk in request.stream():
                if not chunk:
                    continue
                received += len(chunk)
                if received > 250 * 1024 * 1024:
                    raise HTTPException(413, "Evaluation artifacts exceed 250 MB")
                output.write(chunk)
        extracted = []
        with zipfile.ZipFile(archive_path) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if sum(member.file_size for member in members) > 250 * 1024 * 1024:
                raise HTTPException(413, "Expanded evaluation artifacts exceed 250 MB")
            for member in members:
                name = Path(member.filename).name
                if member.filename != name or not evaluation_artifact_label(name):
                    continue
                with archive.open(member) as source, (run_dir / name).open("wb") as output:
                    shutil.copyfileobj(source, output)
                extracted.append(name)
        if not extracted:
            raise HTTPException(400, "Archive contains no supported evaluation artifacts")
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "Evaluation artifact archive is invalid") from exc
    finally:
        archive_path.unlink(missing_ok=True)
    return {"status": "stored", "artifacts": sorted(extracted)}


@app.post("/api/training-workers/agent/jobs/{model_id}/failed")
def fail_remote_training(model_id: str, payload: WorkerFailurePayload, request: Request):
    worker = worker_from_request(request)
    with db() as con:
        model = assigned_remote_model(con, worker["id"], model_id)
        if model["status"] == "training":
            con.execute(
                "UPDATE models SET status='failed',error=?,training_detail=? WHERE id=?",
                (payload.error[:1000], json.dumps({"stage": "Training failed"}), model_id),
            )
        con.execute("UPDATE training_workers SET current_model_id=NULL,last_seen=?,status='online' WHERE id=?", (now(), worker["id"]))
    return {"status": "failed", "modelId": model_id}


def train_worker(model_id: str, version_path: Path, payload: TrainPayload):
    try:
        from ultralytics import YOLO
        with db() as con:
            con.execute(
                "UPDATE models SET progress=10,training_detail=? WHERE id=?",
                (json.dumps({"stage": "Loading model"}), model_id),
            )
        last_checkpoint = RUNS / model_id / "weights" / "last.pt"
        resume = last_checkpoint.is_file()
        initial_checkpoint = payload.architecture
        with db() as con:
            model_row = con.execute("SELECT project_id,weights_path FROM models WHERE id=?", (model_id,)).fetchone()
            if payload.base_model_id and model_row:
                source_model = con.execute(
                    "SELECT weights_path FROM models WHERE id=? AND project_id=?",
                    (payload.base_model_id, model_row["project_id"]),
                ).fetchone()
                if source_model and source_model["weights_path"] and Path(source_model["weights_path"]).is_file():
                    initial_checkpoint = source_model["weights_path"]
            elif model_row and model_row["weights_path"] and Path(model_row["weights_path"]).is_file():
                initial_checkpoint = model_row["weights_path"]
        model = YOLO(str(last_checkpoint) if resume else initial_checkpoint)
        cancel_event = TRAIN_CANCEL[model_id]
        current_batch = 0
        last_batch_update = 0.0

        def on_epoch_start(trainer):
            nonlocal current_batch
            current_batch = 0

        def on_batch_end(trainer):
            nonlocal current_batch, last_batch_update
            current_batch += 1
            timestamp = time.monotonic()
            total_batches = len(trainer.train_loader)
            if timestamp - last_batch_update < 2 and current_batch != total_batches:
                return
            epoch = int(trainer.epoch) + 1
            progress = 20 + round(
                (((epoch - 1) + current_batch / max(1, total_batches)) / payload.epochs) * 75
            )
            loss_value = getattr(trainer, "loss", None)
            try:
                loss = float(loss_value.detach().sum().cpu())
            except (AttributeError, TypeError, ValueError):
                loss = None
            detail = {
                "stage": "Training batches",
                "epoch": epoch,
                "totalEpochs": payload.epochs,
                "batch": current_batch,
                "totalBatches": total_batches,
                "loss": round(loss, 6) if loss is not None else None,
            }
            with db() as callback_db:
                callback_db.execute(
                    "UPDATE models SET progress=?,training_detail=? WHERE id=?",
                    (min(progress, 95), json.dumps(detail), model_id),
                )
            last_batch_update = timestamp
            if cancel_event.is_set():
                trainer.stop = True

        def on_epoch_end(trainer):
            progress = 20 + round(((trainer.epoch + 1) / payload.epochs) * 75)
            with db() as callback_db:
                model_row = callback_db.execute("SELECT metrics_history FROM models WHERE id=?", (model_id,)).fetchone()
                history = json.loads(model_row["metrics_history"] or "[]") if model_row else []
                epoch_metrics = {key: round(float(value), 6) for key, value in (getattr(trainer, "metrics", {}) or {}).items() if isinstance(value, (int, float))}
                history.append({"epoch": trainer.epoch + 1, **epoch_metrics})
                detail = {
                    "stage": "Validating epoch",
                    "epoch": trainer.epoch + 1,
                    "totalEpochs": payload.epochs,
                    "batch": current_batch,
                    "totalBatches": len(trainer.train_loader),
                }
                callback_db.execute(
                    "UPDATE models SET progress=?,metrics_history=?,training_detail=? WHERE id=?",
                    (min(progress, 95), json.dumps(history), json.dumps(detail), model_id),
                )
            if cancel_event.is_set():
                trainer.stop = True

        model.add_callback("on_train_epoch_start", on_epoch_start)
        model.add_callback("on_train_batch_end", on_batch_end)
        model.add_callback("on_train_epoch_end", on_epoch_end)
        with db() as con:
            con.execute(
                "UPDATE models SET progress=20,training_detail=? WHERE id=?",
                (json.dumps({"stage": "Starting training"}), model_id),
            )
        if resume:
            result = model.train(resume=True, device=None if payload.device == "auto" else payload.device, workers=0, plots=True)
        else:
            training_data = version_path if "-cls" in payload.architecture else version_path / "data.yaml"
            result = model.train(data=str(training_data), epochs=payload.epochs, imgsz=payload.image_size, batch=payload.batch_size, optimizer=payload.optimizer, lr0=payload.learning_rate, patience=payload.patience, weight_decay=payload.weight_decay, cos_lr=payload.cos_lr, close_mosaic=payload.close_mosaic, amp=payload.amp, freeze=payload.freeze_layers or None, save_period=1, device=None if payload.device == "auto" else payload.device, project=str(RUNS), name=model_id, exist_ok=True, verbose=False, workers=0, plots=True)
        if cancel_event.is_set():
            best_checkpoint = RUNS / model_id / "weights" / "best.pt"
            resumable = last_checkpoint.is_file()
            with db() as con:
                con.execute(
                    "UPDATE models SET status=?,weights_path=COALESCE(?,weights_path),error=?,training_detail=? WHERE id=?",
                    (
                        "paused" if resumable else "cancelled",
                        str(best_checkpoint) if best_checkpoint.is_file() else None,
                        None if resumable else "Stopped before the first resumable epoch checkpoint was saved",
                        json.dumps({"stage": "Paused" if resumable else "Cancelled without checkpoint"}),
                        model_id,
                    ),
                )
            return
        metrics = result.results_dict
        weights = RUNS / model_id / "weights" / "best.pt"
        with db() as con:
            con.execute(
                "UPDATE models SET status='ready',progress=100,map=?,precision=?,recall=?,weights_path=?,training_detail=? WHERE id=?",
                (round(float(metrics.get("metrics/accuracy_top1", metrics.get("metrics/mAP50(B)", metrics.get("metrics/mAP50(M)", 0))))*100, 1), round(float(metrics.get("metrics/precision(B)", metrics.get("metrics/precision(M)", 0)))*100, 1), round(float(metrics.get("metrics/recall(B)", metrics.get("metrics/recall(M)", 0)))*100, 1), str(weights), json.dumps({"stage": "Training complete"}), model_id)
            )
    except Exception as exc:
        LOGGER.exception("Local training failed for model %s", model_id)
        best_checkpoint = RUNS / model_id / "weights" / "best.pt"
        with db() as con:
            con.execute(
                "UPDATE models SET status='failed',error=?,weights_path=COALESCE(?,weights_path),training_detail=? WHERE id=?",
                (str(exc)[:1000], str(best_checkpoint) if best_checkpoint.is_file() else None, json.dumps({"stage": "Training failed; checkpoint retained"}), model_id),
            )
    finally:
        TRAIN_CANCEL.pop(model_id, None)
        schedule_training_jobs()


def schedule_training_jobs() -> None:
    """Start the oldest queued job, with one local training process at a time."""
    if not TRAIN_SCHEDULER_LOCK.acquire(blocking=False):
        return
    try:
        with db() as con:
            active_rows = con.execute("SELECT config FROM models WHERE status='training'").fetchall()
            if any(json.loads(row["config"] or "{}").get("execution_target", "server") == "server" for row in active_rows):
                return
            queued = next((row for row in con.execute(
                "SELECT m.*,v.path version_path FROM models m JOIN versions v ON v.project_id=m.project_id AND v.number=m.version WHERE m.status='queued' ORDER BY m.rowid"
            ).fetchall() if json.loads(row["config"] or "{}").get("execution_target", "server") == "server"), None)
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
    global WORKFLOW_SCHEDULER_STARTED
    schedule_training_jobs()
    if not WORKFLOW_SCHEDULER_STARTED:
        WORKFLOW_SCHEDULER_STARTED = True
        threading.Thread(target=workflow_scheduler_loop, daemon=True).start()


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
        source_model = None
        if payload.base_model_id:
            source_model = con.execute(
                "SELECT * FROM models WHERE id=? AND project_id=?",
                (payload.base_model_id, project_id),
            ).fetchone()
            if not source_model or not source_model["weights_path"] or not Path(source_model["weights_path"]).is_file():
                raise HTTPException(409, "Selected fine-tune model has no usable best.pt checkpoint")
        if payload.execution_target == "server" and payload.worker_id:
            raise HTTPException(400, "A laptop worker can only be selected for remote training")
        if payload.worker_id:
            worker = con.execute("SELECT * FROM training_workers WHERE id=? AND revoked=0", (payload.worker_id,)).fetchone()
            if not worker:
                raise HTTPException(404, "Selected laptop worker was not found")
            capabilities = json.loads(worker["capabilities"] or "{}")
            selected_worker_online = worker_json(worker)["status"] in {"online", "busy"}
            if payload.execution_target.startswith("colab-") and capabilities.get("provider") != "google-colab":
                raise HTTPException(400, "Selected worker is not running in Google Colab")
            if payload.execution_target in {"remote-gpu", "colab-gpu"} and selected_worker_online and not capabilities.get("cuda"):
                raise HTTPException(400, "Selected worker does not report a CUDA GPU")
        annotated = con.execute("SELECT boxes FROM assets WHERE project_id=?", (project_id,)).fetchall()
        if not any(json.loads(row["boxes"]) for row in annotated):
            raise HTTPException(400, "Annotate at least one object before training")
        model_id = uid()
        display = f"{source_model['name']} fine-tune" if source_model else payload.architecture.replace(".pt", "")
        saved_config = payload.model_dump()
        if payload.execution_target != "server":
            saved_config["queue_activated_at"] = now()
        con.execute("INSERT INTO models (id,project_id,name,version,status,progress,config,created_at,metrics_history) VALUES (?,?,?,?,?,?,?,?,?)", (model_id, project_id, display, version["number"], "queued", 0, json.dumps(saved_config), now(), "[]"))
        destination = "NAS/server" if payload.execution_target == "server" else payload.execution_target.replace("remote-", "worker ").replace("colab-", "Google Colab ")
        log_activity(con, "training.started", f"{display} on version {version['number']} · {destination}", project_id)
        result = project_dict(con, project)
    if payload.execution_target == "server":
        schedule_training_jobs()
    return result


@app.post("/api/projects/{project_id}/train/sweep", status_code=202)
def start_training_sweep(project_id: str, payload: TrainingSweepPayload):
    allowed_optimizers = {"auto", "SGD", "Adam", "AdamW", "NAdam", "RAdam", "RMSProp"}
    if any(optimizer not in allowed_optimizers for optimizer in payload.optimizers):
        raise HTTPException(400, "Sweep contains an unsupported optimizer")
    if any(rate <= 0 or rate > 1 for rate in payload.learning_rates):
        raise HTTPException(400, "Sweep learning rates must be greater than 0 and at most 1")
    combinations = [(optimizer, learning_rate) for optimizer in payload.optimizers for learning_rate in payload.learning_rates]
    if len(combinations) > 8:
        raise HTTPException(400, "A sweep supports up to 8 experiments")
    first_optimizer, first_rate = combinations[0]
    first = payload.base.model_copy(update={"optimizer": first_optimizer, "learning_rate": first_rate})
    start_training(project_id, first)
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        version = con.execute("SELECT * FROM versions WHERE id=? AND project_id=?", (payload.base.version_id, project_id)).fetchone() if payload.base.version_id else con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1", (project_id,)).fetchone()
        for optimizer, learning_rate in combinations[1:]:
            config = payload.base.model_copy(update={"optimizer": optimizer, "learning_rate": learning_rate})
            model_id = uid()
            display = f"{config.architecture.replace('.pt', '')} · {optimizer} · lr {learning_rate:g}"
            con.execute("INSERT INTO models (id,project_id,name,version,status,progress,config,created_at,metrics_history) VALUES (?,?,?,?,?,?,?,?,?)", (model_id, project_id, display, version["number"], "queued", 0, config.model_dump_json(), now(), "[]"))
        log_activity(con, "training.sweep", f"Queued {len(combinations)} experiments", project_id)
        return project_dict(con, project)


@app.post("/api/projects/{project_id}/models/{model_id}/cancel")
def cancel_training(project_id: str, model_id: str):
    event = TRAIN_CANCEL.get(model_id)
    with db() as con:
        model = con.execute("SELECT status,config FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
        if not model or model["status"] not in {"queued", "training"}:
            raise HTTPException(404, "Active training job not found")
        if model["status"] == "queued":
            con.execute("UPDATE models SET status='cancelled',error='Cancelled by user',training_detail=? WHERE id=?", (json.dumps({"stage": "Cancelled"}), model_id))
        elif json.loads(model["config"] or "{}").get("execution_target", "server") != "server":
            con.execute("UPDATE models SET status='cancelled',error='Cancelled by user',training_detail=? WHERE id=?", (json.dumps({"stage": "Cancelled"}), model_id))
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


@app.put("/api/projects/{project_id}/models/{model_id}/lifecycle")
def update_model_lifecycle(project_id: str, model_id: str, payload: ModelLifecyclePayload):
    alias = payload.alias.strip() if payload.alias else None
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
        if not model:
            raise HTTPException(404, "Model not found")
        if payload.stage in {"staging", "production"} and (not model["weights_path"] or not Path(model["weights_path"]).is_file()):
            raise HTTPException(409, "Only models with a usable best.pt can be promoted")
        if payload.stage == "production":
            con.execute("UPDATE models SET stage='staging' WHERE project_id=? AND stage='production' AND id<>?", (project_id, model_id))
        if alias:
            con.execute("UPDATE models SET alias=NULL WHERE project_id=? AND alias=? AND id<>?", (project_id, alias, model_id))
        con.execute("UPDATE models SET alias=?,stage=? WHERE id=?", (alias, payload.stage, model_id))
        log_activity(con, "model.promoted", f"{model['name']} → {payload.stage}{' · ' + alias if alias else ''}", project_id)
        return project_dict(con, con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())


@app.post("/api/projects/{project_id}/models/{model_id}/retry", status_code=202)
def retry_training(project_id: str, model_id: str):
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
        if not model:
            raise HTTPException(404, "Model not found")
        if model["status"] not in {"failed", "cancelled", "paused"}:
            raise HTTPException(409, "This training run cannot be retried yet")
        try:
            payload = TrainPayload.model_validate_json(model["config"] or "{}")
        except Exception as exc:
            raise HTTPException(400, "Saved training configuration is invalid") from exc
        if not con.execute("SELECT 1 FROM versions WHERE project_id=? AND number=?", (project_id, model["version"])).fetchone():
            raise HTTPException(409, "The dataset version used by this model no longer exists")
        saved_config = json.loads(model["config"] or "{}")
        if payload.execution_target != "server":
            saved_config["queue_activated_at"] = now()
        con.execute(
            "UPDATE models SET status='queued',progress=MIN(progress,95),error=NULL,worker_id=NULL,training_detail=?,config=? WHERE id=?",
            (
                json.dumps({"stage": "Waiting for worker"}),
                json.dumps(saved_config),
                model_id,
            ),
        )
        log_activity(con, "training.resumed", f"{model['name']} from saved checkpoint", project_id)
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        result = project_dict(con, project)
    if payload.execution_target == "server":
        schedule_training_jobs()
    return result


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


@app.get("/api/projects/{project_id}/models/{model_id}/weights")
def download_model_weights(project_id: str, model_id: str):
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE id=? AND project_id=?", (model_id, project_id)).fetchone()
    if not model or not model["weights_path"]:
        raise HTTPException(404, "best.pt weights are unavailable")
    weights = Path(model["weights_path"]).resolve()
    expected = (RUNS / model_id).resolve()
    if expected not in weights.parents or not weights.is_file():
        raise HTTPException(404, "best.pt file is unavailable")
    return FileResponse(weights, media_type="application/octet-stream", filename=f"{project_id}-{model_id}-best.pt")


@app.post("/api/projects/{project_id}/models/import", status_code=201)
async def import_model_weights(
    project_id: str,
    file: UploadFile = File(...),
    name: str = Form("Imported best.pt"),
    version_id: str | None = Form(None),
    map50: float = Form(0),
    precision: float = Form(0),
    recall: float = Form(0),
):
    if Path(file.filename or "").suffix.lower() != ".pt":
        raise HTTPException(400, "Upload an Ultralytics .pt checkpoint")
    with db() as con:
        project = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")
        version = con.execute("SELECT * FROM versions WHERE project_id=? AND (? IS NULL OR id=?) ORDER BY number DESC LIMIT 1", (project_id, version_id, version_id)).fetchone()
        if not version:
            raise HTTPException(400, "Create or select a dataset version first")
    model_id = uid()
    target = RUNS / model_id / "weights" / "best.pt"
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 2 * 1024 * 1024 * 1024:
                    raise HTTPException(413, "Checkpoint exceeds 2 GB")
                output.write(chunk)
        from ultralytics import YOLO
        YOLO(str(target))
    except Exception as exc:
        shutil.rmtree(target.parents[1], ignore_errors=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(400, "Checkpoint could not be loaded by Ultralytics YOLO") from exc
    with db() as con:
        con.execute("INSERT INTO models (id,project_id,name,version,status,progress,map,precision,recall,weights_path,config,created_at,metrics_history,stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (model_id, project_id, name.strip()[:100], version["number"], "ready", 100, map50, precision, recall, str(target), json.dumps({"source": "import", "filename": file.filename}), now(), "[]", "development"))
        log_activity(con, "model.imported", f"{name} · {size} bytes", project_id)
        return project_dict(con, project)


@app.post("/api/projects/{project_id}/models/{model_id}/export")
def export_model(project_id: str, model_id: str, payload: ModelExportPayload):
    with db() as con:
        model_row = con.execute("SELECT * FROM models WHERE id=? AND project_id=? AND weights_path IS NOT NULL", (model_id, project_id)).fetchone()
    if not model_row or not model_row["weights_path"] or not Path(model_row["weights_path"]).is_file():
        raise HTTPException(400, "A ready model with weights is required")
    from ultralytics import YOLO
    exported = Path(YOLO(model_row["weights_path"]).export(format=payload.format))
    if exported.is_dir():
        archive = Path(shutil.make_archive(str(EXPORTS / f"{project_id}-{model_id}-{payload.format}"), "zip", root_dir=exported))
        return FileResponse(archive, media_type="application/zip", filename=archive.name)
    return FileResponse(exported, filename=exported.name)


EVALUATION_ARTIFACTS = {
    "results.png": "Training metrics",
    "results.csv": "Metrics data (CSV)",
    "confusion_matrix.png": "Confusion matrix",
    "confusion_matrix_normalized.png": "Normalized confusion matrix",
    "F1_curve.png": "F1 confidence curve",
    "PR_curve.png": "Precision-recall curve",
    "P_curve.png": "Precision confidence curve",
    "R_curve.png": "Recall confidence curve",
    "labels.jpg": "Label distribution",
    "labels_correlogram.jpg": "Label correlogram",
    "args.yaml": "Training configuration",
}


def evaluation_artifact_label(name: str) -> str | None:
    if name in EVALUATION_ARTIFACTS:
        return EVALUATION_ARTIFACTS[name]
    match = re.fullmatch(r"(Box|Mask|Pose)(F1|PR|P|R)_curve\.png", name)
    if match:
        kind = {
            "Box": "bounding box",
            "Mask": "segmentation mask",
            "Pose": "keypoint pose",
        }[match.group(1)]
        metric = {"F1": "F1 confidence", "PR": "precision-recall", "P": "precision confidence", "R": "recall confidence"}[match.group(2)]
        return f"{kind.title()} {metric} curve"
    match = re.fullmatch(r"train_batch(\d+)\.jpg", name)
    if match:
        return f"Training batch {match.group(1)}"
    match = re.fullmatch(r"val_batch(\d+)_(labels|pred)\.jpg", name)
    if match:
        suffix = "ground truth" if match.group(2) == "labels" else "predictions"
        return f"Validation batch {match.group(1)} {suffix}"
    return None


@app.get("/api/projects/{project_id}/models/{model_id}/evaluation")
def list_model_evaluation_artifacts(project_id: str, model_id: str):
    with db() as con:
        model = con.execute("SELECT 1 FROM models WHERE id=? AND project_id=? AND weights_path IS NOT NULL", (model_id, project_id)).fetchone()
    run_dir = (RUNS / model_id).resolve()
    if not model or run_dir.parent != RUNS.resolve() or not run_dir.is_dir():
        return []
    artifacts = []
    for path in run_dir.iterdir():
        label = evaluation_artifact_label(path.name) if path.is_file() else None
        if not label:
            continue
        artifacts.append({
            "name": path.name,
            "label": label,
            "size": path.stat().st_size,
            "preview": path.suffix.lower() in {".png", ".jpg", ".jpeg"},
        })
    priority = {name: index for index, name in enumerate(EVALUATION_ARTIFACTS)}
    artifacts.sort(key=lambda item: (priority.get(item["name"], 100), item["name"]))
    return artifacts


@app.get("/api/projects/{project_id}/models/{model_id}/evaluation/{artifact}")
def model_evaluation_artifact(project_id: str, model_id: str, artifact: str):
    if not evaluation_artifact_label(artifact):
        raise HTTPException(400, "Unsupported evaluation artifact")
    with db() as con:
        model = con.execute("SELECT 1 FROM models WHERE id=? AND project_id=? AND weights_path IS NOT NULL", (model_id, project_id)).fetchone()
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
        model = con.execute("SELECT * FROM models WHERE project_id=? AND weights_path IS NOT NULL ORDER BY CASE stage WHEN 'production' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END,rowid DESC LIMIT 1", (project_id,)).fetchone()
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
        bucket = DEPLOY_REQUESTS[valid["id"]]
        cutoff = time.time() - 60
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= DEPLOY_RATE_LIMIT:
            raise HTTPException(429, f"Rate limit exceeded ({DEPLOY_RATE_LIMIT} requests/minute)")
        bucket.append(time.time())
        con.execute("UPDATE api_keys SET last_used=? WHERE id=?", (now(), valid["id"]))
        model = con.execute("SELECT id FROM models WHERE project_id=? AND weights_path IS NOT NULL ORDER BY CASE stage WHEN 'production' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END,rowid DESC LIMIT 1", (project_id,)).fetchone()
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
            model_row = con.execute("SELECT * FROM models WHERE id=? AND project_id=? AND weights_path IS NOT NULL", (payload.model_id, project_id)).fetchone()
        else:
            model_row = con.execute("SELECT * FROM models WHERE project_id=? AND weights_path IS NOT NULL ORDER BY CASE stage WHEN 'production' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END,rowid DESC LIMIT 1", (project_id,)).fetchone()
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


def validate_workflow_graph(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = [str(node.get("id", "")) for node in nodes]
    if not ids or any(not node_id for node_id in ids) or len(ids) != len(set(ids)):
        raise HTTPException(400, "Workflow node IDs must be present and unique")
    if not any(node.get("type") == "input" for node in nodes) or not any(node.get("type") == "model" for node in nodes) or not any(node.get("type") == "output" for node in nodes):
        raise HTTPException(400, "Workflow requires input, model, and output nodes")
    pairs: set[tuple[str, str]] = set()
    incoming = {node_id: 0 for node_id in ids}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in ids}
    for edge in edges:
        source, target = str(edge.get("from", "")), str(edge.get("to", ""))
        if source not in incoming or target not in incoming or source == target:
            raise HTTPException(400, "Workflow contains an invalid connection")
        if (source, target) in pairs:
            raise HTTPException(400, "Workflow contains a duplicate connection")
        pairs.add((source, target))
        incoming[target] += 1
        outgoing[source].append(target)
    queue = [node_id for node_id, degree in incoming.items() if degree == 0]
    ordered_ids: list[str] = []
    while queue:
        node_id = queue.pop(0)
        ordered_ids.append(node_id)
        for target in outgoing[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)
    if len(ordered_ids) != len(ids):
        raise HTTPException(400, "Workflow graph contains a cycle")
    by_id = {str(node["id"]): node for node in nodes}
    return [by_id[node_id] for node_id in ordered_ids]


@app.post("/api/workflows")
def save_workflow(payload: WorkflowPayload):
    ordered = validate_workflow_graph(payload.nodes, payload.edges)
    workflow_id = payload.id or uid()
    for node in ordered:
        if node.get("type") == "webhook" and (node.get("config") or {}).get("url"):
            validate_webhook_url(str(node["config"]["url"]))
    with db() as con:
        con.execute(
            "INSERT INTO workflows (id,name,nodes,edges,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,nodes=excluded.nodes,edges=excluded.edges,updated_at=excluded.updated_at",
            (workflow_id, payload.name, json.dumps(payload.nodes), json.dumps(payload.edges), now()),
        )
    return {"id": workflow_id, "name": payload.name, "nodes": payload.nodes, "edges": payload.edges, "updatedAt": now()}


@app.post("/api/workflows/{workflow_id}/duplicate", status_code=201)
def duplicate_workflow(workflow_id: str):
    with db() as con:
        row = con.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Workflow not found")
        new_id = uid()
        new_name = f"{row['name']} Copy"
        con.execute("INSERT INTO workflows (id,name,nodes,edges,updated_at) VALUES (?,?,?,?,?)", (new_id, new_name, row["nodes"], row["edges"], now()))
    return {"id": new_id, "name": new_name, "nodes": json.loads(row["nodes"]), "edges": json.loads(row["edges"]), "updatedAt": now()}


@app.get("/api/workflows/{workflow_id}/runs")
def workflow_run_history(workflow_id: str, limit: int = 50):
    with db() as con:
        if not con.execute("SELECT 1 FROM workflows WHERE id=?", (workflow_id,)).fetchone():
            raise HTTPException(404, "Workflow not found")
        rows = con.execute("SELECT * FROM workflow_runs WHERE workflow_id=? ORDER BY created_at DESC LIMIT ?", (workflow_id, max(1, min(limit, 200)))).fetchall()
    return [{"id": row["id"], "status": row["status"], "predictions": row["predictions"], "counts": json.loads(row["counts"] or "{}"), "error": row["error"], "createdAt": row["created_at"], "durationMs": round(row["duration_ms"], 1)} for row in rows]


@app.get("/api/workflows/{workflow_id}/schedule")
def get_workflow_schedule(workflow_id: str):
    with db() as con:
        row = con.execute("SELECT * FROM workflow_schedules WHERE workflow_id=?", (workflow_id,)).fetchone()
    if not row:
        return None
    return {"id": row["id"], "enabled": bool(row["enabled"]), "intervalMinutes": row["interval_minutes"], "nextRun": row["next_run"], "lastRun": row["last_run"]}


@app.put("/api/workflows/{workflow_id}/schedule")
def set_workflow_schedule(workflow_id: str, payload: WorkflowSchedulePayload):
    next_run = (datetime.now(timezone.utc) + timedelta(minutes=payload.interval_minutes)).isoformat()
    with db() as con:
        if not con.execute("SELECT 1 FROM workflows WHERE id=?", (workflow_id,)).fetchone():
            raise HTTPException(404, "Workflow not found")
        con.execute("INSERT INTO workflow_schedules (id,workflow_id,enabled,interval_minutes,next_run,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,next_run=excluded.next_run", (uid(), workflow_id, int(payload.enabled), payload.interval_minutes, next_run, now()))
    return {"enabled": payload.enabled, "intervalMinutes": payload.interval_minutes, "nextRun": next_run}


@app.delete("/api/workflows/{workflow_id}/schedule", status_code=204)
def delete_workflow_schedule(workflow_id: str):
    with db() as con:
        con.execute("DELETE FROM workflow_schedules WHERE workflow_id=?", (workflow_id,))


@app.delete("/api/workflows/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str):
    with db() as con:
        con.execute("DELETE FROM workflow_runs WHERE workflow_id=?", (workflow_id,))
        result = con.execute("DELETE FROM workflows WHERE id=?", (workflow_id,))
        if not result.rowcount:
            raise HTTPException(404, "Workflow not found")


@app.post("/api/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, file: UploadFile = File(...), confidence: float = 0.5):
    started = time.perf_counter()
    with db() as con:
        workflow = con.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
        if not workflow:
            raise HTTPException(404, "Workflow not found")
        edges = json.loads(workflow["edges"])
        nodes = validate_workflow_graph(json.loads(workflow["nodes"]), edges)
        model_node = next((node for node in nodes if node.get("type") == "model"), None)
        requested_project = (model_node or {}).get("projectId")
        if requested_project:
            model = con.execute("SELECT * FROM models WHERE project_id=? AND weights_path IS NOT NULL ORDER BY rowid DESC LIMIT 1", (requested_project,)).fetchone()
        else:
            model = con.execute("SELECT * FROM models WHERE weights_path IS NOT NULL ORDER BY rowid DESC LIMIT 1").fetchone()
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
        branch_results: dict[str, str] = {}
        for node in nodes:
            incoming_edges = [edge for edge in edges if edge.get("to") == node.get("id")]
            if any(edge.get("condition") in {"true", "false"} and branch_results.get(str(edge.get("from"))) != edge.get("condition") for edge in incoming_edges):
                actions.append({"nodeId": node.get("id"), "type": node.get("type"), "status": "skipped"})
                continue
            if node.get("type") == "branch":
                config = node.get("config") or {}
                class_name = str(config.get("class", ""))
                threshold = int(config.get("count", 1))
                observed = counts.get(class_name, sum(counts.values()) if not class_name else 0)
                branch_status = "true" if observed >= threshold else "false"
                branch_results[str(node.get("id"))] = branch_status
                actions.append({"nodeId": node.get("id"), "type": "branch", "status": branch_status, "observed": observed})
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
        with db() as con:
            con.execute(
                "INSERT INTO workflow_runs (id,workflow_id,status,predictions,counts,created_at,duration_ms) VALUES (?,?,?,?,?,?,?)",
                (uid(), workflow_id, "completed", len(predictions), json.dumps(counts), now(), (time.perf_counter() - started) * 1000),
            )
        return payload
    except Exception as exc:
        with db() as con:
            con.execute(
                "INSERT INTO workflow_runs (id,workflow_id,status,predictions,counts,error,created_at,duration_ms) VALUES (?,?,?,?,?,?,?,?)",
                (uid(), workflow_id, "failed", 0, "{}", str(exc)[:1000], now(), (time.perf_counter() - started) * 1000),
            )
        raise
    finally:
        temp.unlink(missing_ok=True)


@app.post("/api/projects/{project_id}/infer/video")
async def infer_video(project_id: str, file: UploadFile = File(...), confidence: float = 0.5, frame_interval: int = 1):
    if Path(file.filename or "").suffix.lower() not in {".mp4", ".mov", ".webm", ".avi"}:
        raise HTTPException(400, "Upload an MP4, MOV, WEBM, or AVI video")
    with db() as con:
        model = con.execute("SELECT * FROM models WHERE project_id=? AND weights_path IS NOT NULL ORDER BY CASE stage WHEN 'production' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END,rowid DESC LIMIT 1", (project_id,)).fetchone()
    if not model or not model["weights_path"]:
        raise HTTPException(400, "No trained model is ready")
    temp = DATA / f"video-infer-{uid()}{Path(file.filename or '.mp4').suffix}"
    size = 0
    with temp.open("wb") as output:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > 4 * 1024 * 1024 * 1024:
                temp.unlink(missing_ok=True)
                raise HTTPException(413, "Video exceeds 4 GB")
            output.write(chunk)
    capture = None
    writer = None
    working_output: Path | None = None
    final_output: Path | None = None
    try:
        import cv2
        from ultralytics import YOLO
        capture = cv2.VideoCapture(str(temp))
        fps = max(1, round(capture.get(cv2.CAP_PROP_FPS) or 1))
        width = max(1, round(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 1))
        height = max(1, round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1))
        stride = fps * max(1, frame_interval)
        output_id = uid()
        working_output = EXPORTS / f"{project_id}-detection-{output_id}.working.mp4"
        final_output = EXPORTS / f"{project_id}-detection-{output_id}.mp4"
        output_fps = float(fps)
        writer = cv2.VideoWriter(
            str(working_output),
            cv2.VideoWriter_fourcc(*"mp4v"),
            output_fps,
            (width, height),
        )
        if not writer.isOpened():
            raise HTTPException(500, "Could not create annotated video output")
        detector = YOLO(model["weights_path"])
        frame_index = 0
        sampled = 0
        latest_result = None
        timeline = []
        totals: dict[str, int] = {}
        while capture.isOpened() and sampled < 300:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % stride == 0:
                result = detector(frame, conf=confidence, verbose=False)[0]
                latest_result = result
                counts: dict[str, int] = {}
                detection = result.obb if result.obb is not None else result.boxes
                if result.probs is not None:
                    top = int(result.probs.top1)
                    counts[result.names[top]] = 1
                elif detection is not None:
                    for class_id in detection.cls.tolist():
                        name = result.names[int(class_id)]
                        counts[name] = counts.get(name, 0) + 1
                for name, count in counts.items():
                    totals[name] = totals.get(name, 0) + count
                timeline.append({"second": round(frame_index / fps, 2), "counts": counts})
                sampled += 1
            annotated_frame = latest_result.plot(img=frame.copy()) if latest_result is not None else frame
            if annotated_frame.shape[1] != width or annotated_frame.shape[0] != height:
                annotated_frame = cv2.resize(annotated_frame, (width, height))
            writer.write(annotated_frame)
            frame_index += 1
        capture.release()
        capture = None
        writer.release()
        writer = None
        if sampled == 0 or not working_output.is_file():
            raise HTTPException(400, "Video contains no readable frames")
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            converted = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(working_output),
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(final_output),
                ],
                capture_output=True,
                text=True,
                timeout=900,
            )
            if converted.returncode != 0:
                working_output.replace(final_output)
            else:
                working_output.unlink(missing_ok=True)
        else:
            working_output.replace(final_output)
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file.filename or "video").stem).strip("-.")[:80] or "video"
        return {
            "sampledFrames": sampled,
            "durationSeconds": round(frame_index / fps, 2),
            "frameInterval": max(1, frame_interval),
            "totals": totals,
            "timeline": timeline,
            "annotatedVideoUrl": f"/api/projects/{project_id}/infer/video/results/{output_id}",
            "annotatedVideoName": f"{safe_stem}-detected.mp4",
        }
    finally:
        if capture is not None:
            capture.release()
        if writer is not None:
            writer.release()
        if working_output is not None:
            working_output.unlink(missing_ok=True)
        temp.unlink(missing_ok=True)


@app.get("/api/projects/{project_id}/infer/video/results/{output_id}")
def inference_video_result(project_id: str, output_id: str, download: bool = False):
    if not re.fullmatch(r"[a-f0-9]{12}", output_id):
        raise HTTPException(400, "Invalid video result id")
    with db() as con:
        if not con.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
    target = (EXPORTS / f"{project_id}-detection-{output_id}.mp4").resolve()
    if target.parent != EXPORTS.resolve() or not target.is_file():
        raise HTTPException(404, "Annotated video result not found")
    return FileResponse(
        target,
        media_type="video/mp4",
        filename=f"{project_id}-detected.mp4" if download else None,
        content_disposition_type="attachment" if download else "inline",
    )


def workflow_scheduler_loop() -> None:
    """Run enabled workflows against the latest project asset at their interval."""
    while True:
        try:
            with db() as con:
                due = con.execute("SELECT s.*,w.nodes FROM workflow_schedules s JOIN workflows w ON w.id=s.workflow_id WHERE s.enabled=1 AND s.next_run<=?", (now(),)).fetchall()
            for schedule in due:
                nodes = json.loads(schedule["nodes"])
                model_node = next((node for node in nodes if node.get("type") == "model"), None)
                project_id = (model_node or {}).get("projectId")
                with db() as con:
                    asset = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY rowid DESC LIMIT 1", (project_id,)).fetchone() if project_id else con.execute("SELECT a.* FROM assets a JOIN models m ON m.project_id=a.project_id WHERE m.weights_path IS NOT NULL ORDER BY CASE m.stage WHEN 'production' THEN 0 ELSE 1 END,m.rowid DESC,a.rowid DESC LIMIT 1").fetchone()
                    next_run = (datetime.now(timezone.utc) + timedelta(minutes=schedule["interval_minutes"])).isoformat()
                    con.execute("UPDATE workflow_schedules SET next_run=?,last_run=? WHERE id=?", (next_run, now(), schedule["id"]))
                if not asset or not Path(asset["path"]).is_file():
                    continue
                with Path(asset["path"]).open("rb") as source:
                    upload = UploadFile(file=source, filename=asset["name"])
                    asyncio.run(run_workflow(schedule["workflow_id"], upload))
        except Exception:
            pass
        time.sleep(30)


@app.get("/")
def root():
    frontend = ROOT / "dist" / "index.html"
    if frontend.is_file():
        return FileResponse(frontend)
    return {"name": "Salnova API", "docs": "/docs", "health": "/api/health"}


if (ROOT / "dist" / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=ROOT / "dist" / "assets"), name="frontend-assets")
