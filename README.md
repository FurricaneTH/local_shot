# LocalCut

LocalCut is a personal Tauri 2 application for capturing screenshots and microphone-enabled screen videos, editing them non-destructively, and rendering shareable local videos with ffmpeg. It has no accounts, telemetry, analytics, billing, cloud upload, or hosted control plane.

## First run with one command

Prerequisites: macOS 12+ (capture API support on Windows/Linux depends on the WebView), [Node.js 20+](https://nodejs.org/), pnpm 10+, [Rust 1.77.2+](https://rustup.rs/), and `ffmpeg`/`ffprobe` on your PATH. macOS also requires Xcode Command Line Tools.

From the repository root, run:

```sh
./run-local.sh
```

The script installs missing `node_modules`, validates the tools, builds the frontend locally, and opens a stable `LocalCut.app` bundle on macOS with the `app.localcut.desktop` identifier. The first screen or microphone capture will prompt for operating-system permissions.

For optional local configuration:

```sh
cp .env.example .env
```

`.env` is ignored by Git. No API key is required. If you use a local `whisper-cli`, put only its executable and model paths in `.env`; never commit models or credentials.

## Workflow

1. Choose video or screenshot, then select the screen, a window, or a percentage-based region. Microphone capture is optional for video.
2. Confirm the source in the operating-system capture picker. The recording timer stays visible, and **Stop Recording** is also available from the tray menu.
3. Add non-destructive crop, 1–4× zoom, click highlighting, and time-based text notes to the edit recipe.
4. Render locally as H.264/MP4 (`libx264`, CRF 20, AAC, `faststart`) or WebM (`libvpx-vp9`, CRF 30, Opus).
5. Copy the file path or reveal the file in its folder. No upload is required.

Each recording receives a poster frame, `.transcript.txt`, and `.summary.md` beside the media file. When `WHISPER_CLI` and `WHISPER_MODEL` are set, the transcript is filled by a fully local Whisper run; otherwise a clear local-configuration note is still written. If ffmpeg is unavailable, the raw capture and text sidecars are preserved and render/poster errors can be retried.

## Architecture

```text
React capture controls
  ├─ macOS: native screencapture screen/window/region picker + microphone
  ├─ Supported WebViews: MediaRecorder/getDisplayMedia + region canvas
  ├─ visible timer and tray stop action
  └─ Tauri invoke / tray stop event
       ├─ Rust validation + atomic local file writes
       ├─ SQLite: titles, paths, and non-destructive EditRecipe JSON
       ├─ ffmpeg: crop/zoom/drawbox/drawtext and H.264/WebM presets
       └─ poster + transcript + Markdown summary
```

- `src/App.tsx`: capture controls, library, all UI states, and the edit view.
- `src/lib/capture.ts`: `getDisplayMedia`, optional `getUserMedia`, region canvas, and MediaRecorder for supported WebViews.
- `src-tauri/src/lib.rs`: native macOS capture commands, Tauri commands, tray, file validation, and sidecars.
- `src-tauri/src/db.rs`: embedded SQLite schema and queries.
- `src-tauri/src/render.rs`: safe naming, transform validation, and the ffmpeg render graph.

Source media is never modified. Crop, zoom, and notes are stored in SQLite as an `EditRecipe`; export creates a new file. Text annotations are passed to ffmpeg through arguments and temporary text files, never through a shell command.

## Permissions and platform behavior

- macOS usage descriptions for screen recording and microphone access are defined in `src-tauri/Info.plist`. Grant LocalCut access under **System Settings → Privacy & Security → Screen & System Audio Recording / Microphone**.
- Tauri capabilities are limited to the main window and core events in `src-tauri/capabilities/default.json`.
- When the macOS Tauri WebView does not provide `getDisplayMedia`, the app falls back to `/usr/sbin/screencapture`; screenshots, video, and optional default microphone capture use this local path.
- If the capture API, MediaRecorder, microphone, or file manager is unavailable, the app shows a descriptive retryable error instead of crashing.
- The operating system makes the final screen/window/region selection. In the macOS video picker, a window recording is represented as the selected area surrounding that window.

## Data location and backups

All user data is stored in the Tauri application-data directory by default:

- macOS: `~/Library/Application Support/app.localcut.desktop/`
- Windows: `%APPDATA%\\app.localcut.desktop\\`
- Linux: `~/.local/share/app.localcut.desktop/`

The directory contains `localcut.sqlite3`, `captures/`, and `exports/`. Because SQLite uses WAL mode, the safe backup sequence is:

1. Stop any active recording and quit LocalCut.
2. Copy the complete `app.localcut.desktop` directory to an external drive or personal backup location.
3. Restore the complete directory to the same location while LocalCut is closed.

To move an exported video with its companion files, copy the four files sharing the same root name: the media file, poster, transcript, and Markdown summary.

## Test and quality commands

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm exec playwright install chromium   # only for the first E2E run
pnpm test:e2e
```

Focused unit tests cover safe filenames and crop/zoom bounds in the TypeScript and Rust layers. The Rust integration test uses real ffmpeg to render both H.264 and WebM plus poster, transcript, and Markdown sidecars. The Playwright scenario validates the local capture → add note → save recipe → H.264 export flow.

## Deliberately out of scope

Public cloud hosting/upload, viewer identity, interaction analytics, telemetry, accounts, billing, team or enterprise workspaces, SSO, and a hosted control plane are deliberately excluded. LocalCut remains personal and local-first.
