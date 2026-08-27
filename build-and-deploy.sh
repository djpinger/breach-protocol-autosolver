#!/usr/bin/env bash
# Build breach-protocol-autosolver and deploy it to ~/Applications for GearLever.
# Pass --docker to build inside a podman/docker container (see
# build-in-docker.sh) instead of using a host-local Node 16 toolchain.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

if [ "${1:-}" = "--docker" ]; then
  echo "==> building via container (build-in-docker.sh)"
  "$REPO_DIR/build-in-docker.sh"
else
  if [ ! -x "$REPO_DIR/.toolchain/bin/node" ]; then
    echo "==> .toolchain missing (gitignored, not part of the clone) - fetching Node 16" >&2
    NODE_VER="$(curl -s https://nodejs.org/dist/latest-v16.x/ | grep -oP 'node-v16\.\d+\.\d+-linux-x64\.tar\.xz' | sort -V | tail -1)"
    mkdir -p "$REPO_DIR/.toolchain"
    curl -sL "https://nodejs.org/dist/latest-v16.x/$NODE_VER" -o /tmp/node16.tar.xz
    tar -xJf /tmp/node16.tar.xz -C "$REPO_DIR/.toolchain" --strip-components=1
  fi

  export PATH="$REPO_DIR/.toolchain/bin:$PATH"

  echo "==> node $(node --version) / npm $(npm --version)"

  if [ ! -d node_modules ]; then
    echo "==> node_modules missing, running npm install"
    npm install
  fi

  echo "==> webpack build"
  npm run webpack:build

  echo "==> electron-builder (AppImage)"
  npx electron-builder build --linux AppImage
fi

# Runtime deps (used via execFile, not npm-installed) that the built app
# needs at *run* time, not build time, regardless of how it was built.
# Warn now rather than have the app fail mysteriously on first use.
MISSING_RUNTIME_DEPS=()
command -v magick >/dev/null || MISSING_RUNTIME_DEPS+=("magick (ImageMagick)")
command -v xdotool >/dev/null || MISSING_RUNTIME_DEPS+=("xdotool")
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  case "${XDG_CURRENT_DESKTOP:-}" in
    *KDE*) command -v spectacle >/dev/null || MISSING_RUNTIME_DEPS+=("spectacle (KDE screenshot capture)") ;;
    *GNOME*) command -v gnome-screenshot >/dev/null || command -v grim >/dev/null || MISSING_RUNTIME_DEPS+=("gnome-screenshot or grim (screenshot capture)") ;;
    *) command -v grim >/dev/null || MISSING_RUNTIME_DEPS+=("grim (screenshot capture on non-KDE/GNOME Wayland)") ;;
  esac
fi
if [ "${#MISSING_RUNTIME_DEPS[@]}" -gt 0 ]; then
  echo "==> warning: missing runtime dependencies on this machine, the built app will not fully work until installed:" >&2
  printf '      - %s\n' "${MISSING_RUNTIME_DEPS[@]}" >&2
fi

BUILT="$(find out -maxdepth 1 -iname '*.AppImage' -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -z "$BUILT" ]; then
  echo "No AppImage found in out/ after build" >&2
  exit 1
fi

DEST="$HOME/Applications/breach_protocol_autosolver.appimage"
echo "==> deploying $BUILT -> $DEST"
cp "$BUILT" "$DEST"
chmod +x "$DEST"

rm -rf out/linux-unpacked

echo "==> done. GearLever's tracked file path is unchanged, so the existing desktop entry (icon, StartupWMClass) still applies."
