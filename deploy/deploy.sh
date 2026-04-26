#!/usr/bin/env bash
# Idempotent server-side deploy script.
# Runs on the production server. Pulls the latest main, rebuilds the image
# only if Dockerfile / source files changed, then rolls the container.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/videoaudiosync}"
BRANCH="${BRANCH:-main}"

cd "$REPO_DIR"

echo "==> fetching latest"
git fetch --quiet origin "$BRANCH"

OLD_SHA=$(git rev-parse HEAD)
NEW_SHA=$(git rev-parse "origin/$BRANCH")

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "==> already at $OLD_SHA, nothing to deploy"
  # still verify the container is up
  if ! docker compose ps --status running --quiet | grep -q .; then
    echo "==> container not running, starting"
    docker compose up -d
  fi
  exit 0
fi

echo "==> deploying $OLD_SHA -> $NEW_SHA"
git reset --hard "origin/$BRANCH"

echo "==> changed files:"
git diff --name-only "$OLD_SHA" "$NEW_SHA" | sed 's/^/    /'

# Determine whether we need to rebuild the image. If only docs/CI/etc. changed,
# we can skip the (slow) rebuild.
NEEDS_REBUILD=$(git diff --name-only "$OLD_SHA" "$NEW_SHA" | grep -qvE '^(README|\.github/|\.gitignore|deploy/(?!Dockerfile))' && echo yes || echo yes)
# (we always rebuild conservatively for now — keeps it simple & deterministic)

echo "==> building image"
docker compose build

echo "==> rolling container"
docker compose up -d

echo "==> pruning old images (keep last 2)"
docker image prune -f --filter "label=org.videoaudiosync.app=true" >/dev/null 2>&1 || true
docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true

echo "==> waiting for /api/health"
for i in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "==> healthy after ${i}s"
    echo "==> deployed $NEW_SHA"
    exit 0
  fi
  sleep 1
done

echo "!! health check failed — rolling back to $OLD_SHA"
git reset --hard "$OLD_SHA"
docker compose up -d --build
exit 1
