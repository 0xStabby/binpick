#!/usr/bin/env bash
set -euo pipefail

SCOPE="user"

usage() {
  cat <<'EOF'
binpick release installer

Usage:
  bash scripts/release-install.sh [--system]

Installs prebuilt release files from an extracted binpick release archive.

Defaults:
  - App binaries: ~/.local/bin/binpick and ~/.local/bin/binpick-theme-selector

Options:
  --system  Install app binaries system-wide into /usr/local/bin.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system)
      SCOPE="system"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINPICK_SRC="$ROOT_DIR/bin/binpick"
THEME_SELECTOR_SRC="$ROOT_DIR/bin/binpick-theme-selector"

for binary in "$BINPICK_SRC" "$THEME_SELECTOR_SRC"; do
  if [[ ! -f "$binary" ]]; then
    echo "Missing binary: $binary" >&2
    echo "Run this script from an extracted binpick release archive." >&2
    exit 1
  fi
done

if [[ "$SCOPE" == "system" ]]; then
  echo "Installing binpick -> /usr/local/bin/binpick"
  sudo install -Dm755 "$BINPICK_SRC" /usr/local/bin/binpick
  echo "Installing binpick-theme-selector -> /usr/local/bin/binpick-theme-selector"
  sudo install -Dm755 "$THEME_SELECTOR_SRC" /usr/local/bin/binpick-theme-selector
else
  echo "Installing binpick -> $HOME/.local/bin/binpick"
  install -Dm755 "$BINPICK_SRC" "$HOME/.local/bin/binpick"
  echo "Installing binpick-theme-selector -> $HOME/.local/bin/binpick-theme-selector"
  install -Dm755 "$THEME_SELECTOR_SRC" "$HOME/.local/bin/binpick-theme-selector"
fi

cat <<'EOF'

Done.

Make sure ~/.local/bin is in PATH if you used the default user install.
EOF
