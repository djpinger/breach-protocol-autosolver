#!/usr/bin/env bash
# Build breach-protocol-autosolver and deploy it to ~/Applications for GearLever.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

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
