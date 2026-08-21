import { invoke } from "@tauri-apps/api/core";
import type { CaptureSource, EditRecipe, ExportFormat, ExportResult, MediaItem } from "../types";
import { DEFAULT_RECIPE } from "../types";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const demoMode = () => new URLSearchParams(window.location.search).has("demo");

const demoItem: MediaItem = {
  id: "demo-capture",
  title: "Tasarım incelemesi",
  kind: "video",
  source: "window",
  mediaPath: "/Users/local/LocalCut/captures/design-review.webm",
  posterPath: null,
  transcriptPath: "/Users/local/LocalCut/captures/design-review.transcript.txt",
  summaryPath: "/Users/local/LocalCut/captures/design-review.summary.md",
  durationMs: 82400,
  createdAt: new Date().toISOString(),
  recipe: DEFAULT_RECIPE
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  if (!demoMode()) {
    if (command === "list_media") return [] as T;
    throw new Error("Bu işlem masaüstü uygulamasında kullanılabilir.");
  }
  if (command === "list_media") return [demoItem] as T;
  if (command === "export_media") {
    return {
      mediaPath: "/Users/local/LocalCut/exports/design-review.mp4",
      posterPath: "/Users/local/LocalCut/exports/design-review.poster.jpg",
      transcriptPath: demoItem.transcriptPath,
      summaryPath: demoItem.summaryPath
    } as T;
  }
  return undefined as T;
}

export const backend = {
  listMedia: () => call<MediaItem[]>("list_media"),
  saveCapture: (payload: { bytes: number[]; extension: string; title: string; kind: string; source: string; durationMs: number }) =>
    call<MediaItem>("save_capture", { request: payload }),
  nativeScreenshot: (payload: { title: string; source: CaptureSource; microphone: boolean }) =>
    call<MediaItem>("native_screenshot", { request: payload }),
  nativeStartRecording: (payload: { title: string; source: CaptureSource; microphone: boolean }) =>
    call<void>("native_start_recording", { request: payload }),
  nativeStopRecording: () => call<MediaItem>("native_stop_recording"),
  openScreenCaptureSettings: () => call<void>("open_screen_capture_settings"),
  updateRecipe: (id: string, title: string, recipe: EditRecipe) => call<void>("update_recipe", { id, title, recipe }),
  exportMedia: (id: string, title: string, format: ExportFormat) =>
    call<ExportResult>("export_media", { request: { id, title, format } }),
  copyPath: (path: string) => call<void>("copy_path", { path }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  dataLocation: () => call<string>("data_location")
};
