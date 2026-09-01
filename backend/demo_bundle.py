"""Move finished projects between two Salnova installations.

The onboarding tour narrates seven completed projects - dataset imported, version
generated, model trained, model promoted. Those were produced by the `e2e_*.py`
scripts on a development machine, so a fresh server has nothing for the tour to
point at. Rebuilding them on the server would mean training seven models again.

This tool copies them instead:

    # on the machine that already has the projects
    python backend/demo_bundle.py export --out demo.zip --ids id-a id-b

    # on the server (inside the container, where the data dir is /app/local_data)
    python backend/demo_bundle.py import --bundle demo.zip --shared

Only rows that make a project renderable are copied. Deployment keys, invites,
collaborators, notifications, and activity logs are deliberately left behind:
they are either secrets belonging to the source install or noise that would
appear as somebody else's history on the destination.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import zipfile
from pathlib import Path

# Ordered so parents land before the rows that reference them.
COPIED_TABLES = ["projects", "assets", "versions", "models", "model_evaluations"]

# Columns holding a filesystem path, per table. Stored relative to the data dir
# inside the bundle so the destination can rebuild them under its own root.
PATH_COLUMNS = {
    "assets": ["path"],
    "versions": ["path"],
    "models": ["weights_path"],
}

# Where each data-dir subtree lives, used to sanity-check rewritten paths.
KNOWN_SUBDIRS = ("uploads", "versions", "runs", "exports", "models")


def data_dir() -> Path:
    default = Path(__file__).resolve().parent.parent / "local_data"
    return Path(os.getenv("VISIONFLOW_DATA_DIR", str(default))).resolve()


def connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def columns_of(con: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in con.execute(f"PRAGMA table_info({table})")]


def relativise(raw: str, root: Path) -> str | None:
    """Turn an absolute path from the source install into a data-dir-relative one."""
    if not raw:
        return None
    try:
        return Path(raw).resolve().relative_to(root).as_posix()
    except (ValueError, OSError):
        # Path escaped the data dir, or the drive is gone. Skip rather than guess.
        return None


def do_export(args: argparse.Namespace) -> int:
    root = data_dir()
    con = connect(root / "visionflow.db")
    ids = list(args.ids)
    placeholders = ",".join("?" * len(ids))

    present = {row["id"] for row in con.execute(f"SELECT id FROM projects WHERE id IN ({placeholders})", ids)}
    missing = [pid for pid in ids if pid not in present]
    if missing:
        print("Project tidak ditemukan di sumber:", ", ".join(missing), file=sys.stderr)
        return 1

    payload: dict[str, list[dict]] = {}
    files: dict[str, Path] = {}

    for table in COPIED_TABLES:
        key = "id" if table == "projects" else "project_id"
        if table == "model_evaluations":
            # Hangs off models, and older installs may not have project_id on it.
            available = columns_of(con, table)
            key = "project_id" if "project_id" in available else None
            if key is None:
                continue
        rows = [dict(r) for r in con.execute(f"SELECT * FROM {table} WHERE {key} IN ({placeholders})", ids)]
        for row in rows:
            for column in PATH_COLUMNS.get(table, []):
                relative = relativise(row.get(column) or "", root)
                row[column] = relative
                if relative:
                    source = root / relative
                    if source.is_file():
                        files[relative] = source
                    elif source.is_dir():
                        for child in source.rglob("*"):
                            if child.is_file():
                                files[child.relative_to(root).as_posix()] = child
        payload[table] = rows
        print(f"  {table:20} {len(rows):4} baris")

    out = Path(args.out).resolve()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("rows.json", json.dumps(payload, indent=1))
        for relative, source in files.items():
            bundle.write(source, f"files/{relative}")
    size = out.stat().st_size / 1024 / 1024
    print(f"\nBundle: {out} ({size:.1f} MB, {len(files)} file)")
    return 0


def do_import(args: argparse.Namespace) -> int:
    root = data_dir()
    db_path = root / "visionflow.db"
    if not db_path.is_file():
        print(f"Database tujuan tidak ada: {db_path}", file=sys.stderr)
        return 1

    bundle = zipfile.ZipFile(Path(args.bundle).resolve())
    payload = json.loads(bundle.read("rows.json"))
    con = connect(db_path)

    project_ids = [row["id"] for row in payload.get("projects", [])]
    existing = {r["id"] for r in con.execute(
        "SELECT id FROM projects WHERE id IN (%s)" % ",".join("?" * len(project_ids)), project_ids
    )} if project_ids else set()
    if existing and not args.replace:
        print("Sudah ada di tujuan:", ", ".join(sorted(existing)), file=sys.stderr)
        print("Pakai --replace untuk menimpa.", file=sys.stderr)
        return 1

    written = 0
    for name in bundle.namelist():
        if not name.startswith("files/"):
            continue
        relative = name[len("files/"):]
        if not relative or relative.startswith(("/", "..")) or ".." in Path(relative).parts:
            print(f"  lewati entri mencurigakan: {relative}", file=sys.stderr)
            continue
        if relative.split("/", 1)[0] not in KNOWN_SUBDIRS:
            print(f"  lewati di luar subdir yang dikenal: {relative}", file=sys.stderr)
            continue
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with bundle.open(name) as source, open(target, "wb") as sink:
            shutil.copyfileobj(source, sink)
        written += 1

    with con:
        if existing:
            # ON DELETE CASCADE clears the dependent rows for us.
            con.executemany("DELETE FROM projects WHERE id=?", [(pid,) for pid in existing])
        for table in COPIED_TABLES:
            rows = payload.get(table) or []
            if not rows:
                continue
            destination_columns = set(columns_of(con, table))
            inserted = 0
            for row in rows:
                record = {k: v for k, v in row.items() if k in destination_columns}
                for column in PATH_COLUMNS.get(table, []):
                    if record.get(column):
                        record[column] = str(root / record[column])
                if table == "projects":
                    if "demo_key" in destination_columns:
                        record["demo_key"] = record.get("id")
                    if "owner_id" in destination_columns:
                        # NULL owner means "visible to every account" in the
                        # isolation rules, which is what a shared tutorial needs.
                        record["owner_id"] = None if args.shared else args.owner
                names = ",".join(record)
                marks = ",".join("?" * len(record))
                con.execute(f"INSERT INTO {table} ({names}) VALUES ({marks})", list(record.values()))
                inserted += 1
            print(f"  {table:20} {inserted:4} baris")

    print(f"\n{written} file ditulis ke {root}")
    print("Project:", ", ".join(project_ids))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    exporter = sub.add_parser("export", help="Kemas project dari install ini ke sebuah bundle.")
    exporter.add_argument("--out", required=True)
    exporter.add_argument("--ids", nargs="+", required=True)
    exporter.set_defaults(func=do_export)

    importer = sub.add_parser("import", help="Masukkan bundle ke install ini.")
    importer.add_argument("--bundle", required=True)
    importer.add_argument("--shared", action="store_true",
                          help="Tanpa pemilik, sehingga terlihat oleh semua akun.")
    importer.add_argument("--owner", default=None, help="Member id pemilik kalau tidak --shared.")
    importer.add_argument("--replace", action="store_true", help="Timpa project dengan id sama.")
    importer.set_defaults(func=do_import)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
