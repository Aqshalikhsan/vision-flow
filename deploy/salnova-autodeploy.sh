#!/bin/sh
# Pull the image GitHub Actions published and restart Salnova if it changed.
#
# The NAS has no inbound ports, so deployment is a pull rather than a push: this
# runs on a timer, asks the registry whether the tag moved, and only touches the
# running stack when it did. See deploy/README.md for installation.
#
# Deliberately /bin/sh and dependency-free: it has to survive a UGOS update that
# might not keep bash or any package manager around.

set -eu

PROJECT_DIR="${SALNOVA_DIR:-/volume1/docker/salnova}"
COMPOSE="docker compose -f compose.ugreen.yml -f compose.cloudflare.yml"
SERVICE=visionflow

log() { echo "$(date -Iseconds) $*"; }

cd "$PROJECT_DIR" || { log "FATAL project dir hilang: $PROJECT_DIR"; exit 1; }

# VISIONFLOW_IMAGE decides whether we run a registry image or a local build.
# Without it compose falls back to salnova:local, which this script must never
# try to pull.
IMAGE=$(grep -E '^VISIONFLOW_IMAGE=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
if [ -z "${IMAGE:-}" ]; then
    log "SKIP VISIONFLOW_IMAGE belum diset di .env; stack ini masih build lokal"
    exit 0
fi

before=$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo none)

if ! $COMPOSE pull "$SERVICE" >/dev/null 2>&1; then
    # A failed pull is routine: the NAS may be offline, or a build still running.
    # Leave the working container alone and try again on the next tick.
    log "WARN pull gagal, container yang berjalan dibiarkan"
    exit 0
fi

after=$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo none)

if [ "$before" = "$after" ]; then
    log "OK tidak ada image baru"
    exit 0
fi

log "BARU $before -> $after, menjalankan ulang $SERVICE"
# --no-build: the image comes from the registry, and rebuilding here would undo
# the point of moving the build to CI.
if $COMPOSE up -d --no-build "$SERVICE"; then
    log "OK $SERVICE dijalankan ulang"
else
    log "FATAL restart gagal; container lama mungkin masih melayani trafik"
    exit 1
fi

# Old layers accumulate on every deploy; keep only what is still referenced.
docker image prune -f >/dev/null 2>&1 || true
log "SELESAI"
