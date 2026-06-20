#!/usr/bin/env bash
# Recursively delete all node_modules and dist folders from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Cleaning node_modules and dist under: $ROOT"

# Prune so we don't descend into matched dirs (faster, avoids nested re-scan).
find "$ROOT" \
  -type d \( -name node_modules -o -name dist \) \
  -prune -print -exec rm -rf {} +

echo "Done."
