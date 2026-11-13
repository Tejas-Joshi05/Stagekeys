#!/usr/bin/env bash
# Builds Stagekeys, installs it to /Applications and puts a shortcut on the Desktop.
# Rerun after pulling changes to update the installed app. Usage: pnpm install-app
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

# VS Code terminals set this, and it stops Electron from behaving as an app.
unset ELECTRON_RUN_AS_NODE

APP_NAME="Stagekeys.app"
BUILT="release/mac-$(uname -m)/$APP_NAME"
TARGET="/Applications/$APP_NAME"
SHORTCUT="$HOME/Desktop/Stagekeys"

echo "→ Building and packaging…"
pnpm package >/dev/null

if [[ ! -d "$BUILT" ]]; then
  echo "Packaging did not produce $BUILT" >&2
  exit 1
fi

# Not signed with a developer certificate. An ad-hoc signature is enough for
# macOS to run an app built on this machine.
echo "→ Signing (ad-hoc)…"
codesign --force --deep --sign - "$BUILT"
codesign --verify --deep --strict "$BUILT"

if pgrep -f "$TARGET/Contents/MacOS/Stagekeys" >/dev/null; then
  echo "Stagekeys is running. Quit it first, then run this again." >&2
  exit 1
fi

echo "→ Installing to ${TARGET}…"
rm -rf "$TARGET"
ditto "$BUILT" "$TARGET"

if [[ -L "$SHORTCUT" || ! -e "$SHORTCUT" ]]; then
  ln -sfn "$TARGET" "$SHORTCUT"
  echo "→ Desktop shortcut: $SHORTCUT"
else
  echo "→ Skipped the Desktop shortcut: $SHORTCUT already exists and is not a shortcut."
fi

echo "Done. Version $(node -p "require('./package.json').version") is installed."
