#!/usr/bin/env bash
# Build the AppImage inside a container instead of on the host, so no
# machine-specific Node 16 toolchain is needed - just a container runtime.
# Produces out/*.AppImage the same as build-and-deploy.sh's native path;
# run build-and-deploy.sh --docker to also deploy it afterwards.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

RUNTIME="$(command -v podman || command -v docker || true)"
if [ -z "$RUNTIME" ]; then
  echo "No container runtime found (looked for podman, docker)." >&2
  exit 1
fi

IMAGE="bpa-builder"
echo "==> building image with $RUNTIME"
"$RUNTIME" build -t "$IMAGE" -f Dockerfile.build .

echo "==> running build inside container"
"$RUNTIME" run --rm \
  -v "$REPO_DIR:/app:Z" \
  -w /app \
  "$IMAGE" \
  bash -c '
    set -euo pipefail
    echo "==> node $(node --version) / npm $(npm --version)"
    [ -d node_modules ] || npm install
    echo "==> webpack build"
    npm run webpack:build
    echo "==> electron-builder (AppImage)"
    npx electron-builder build --linux AppImage
  '

echo "==> done, output in ./out"
