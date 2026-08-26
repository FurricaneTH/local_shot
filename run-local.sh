#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

# Codex Desktop ships an isolated Node/pnpm runtime that is not normally on
# the user's Terminal PATH. Reuse it when available, while keeping standard
# system installations as the first choice.
CODEX_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if [ -x "/opt/homebrew/opt/node@22/bin/node" ]; then
  PATH="/opt/homebrew/opt/node@22/bin:$CODEX_RUNTIME/bin/fallback:$PATH"
elif ! command -v node >/dev/null 2>&1 && [ -x "$CODEX_RUNTIME/node/bin/node" ]; then
  PATH="$CODEX_RUNTIME/node/bin:$CODEX_RUNTIME/bin/fallback:$PATH"
fi
if ! command -v cargo >/dev/null 2>&1 && [ -x "$HOME/.cargo/bin/cargo" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v ffmpeg >/dev/null 2>&1 && [ -x "/opt/homebrew/bin/ffmpeg" ]; then
  PATH="/opt/homebrew/bin:$PATH"
fi
export PATH

APP_DIR="$SCRIPT_DIR/src-tauri/target/debug/bundle/macos/LocalCut.app"
if [ "$(uname -s)" = "Darwin" ] && [ -x "$APP_DIR/Contents/MacOS/localcut" ] && [ "${LOCALCUT_REBUILD:-0}" != "1" ]; then
  exec /usr/bin/open "$APP_DIR"
fi

for command in node pnpm cargo ffmpeg; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Eksik önkoşul: $command. README.md içindeki Kurulum bölümüne bakın." >&2
    exit 1
  fi
done

if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile=false
fi

# Build the frontend first so the desktop window never depends on a dev server.
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol

if [ "$(uname -s)" = "Darwin" ]; then
  CONTENTS_DIR="$APP_DIR/Contents"

  mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
  cp "$SCRIPT_DIR/src-tauri/target/debug/localcut" "$CONTENTS_DIR/MacOS/localcut"
  cp "$SCRIPT_DIR/src-tauri/Info.plist" "$CONTENTS_DIR/Info.plist"

  # A stable application bundle identity is required for macOS Screen
  # Recording and Microphone permissions to remain associated with LocalCut.
  /usr/bin/xattr -cr "$APP_DIR"
  /usr/bin/codesign --force --deep --sign - --identifier app.localcut.desktop "$APP_DIR"
  exec /usr/bin/open "$APP_DIR"
fi

exec "$SCRIPT_DIR/src-tauri/target/debug/localcut"
