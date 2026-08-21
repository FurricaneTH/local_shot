export type CaptureKind = "screenshot" | "video";
export type CaptureSource = "screen" | "window" | "region";
export type ExportFormat = "h264" | "webm";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureOptions {
  kind: CaptureKind;
  source: CaptureSource;
  microphone: boolean;
  region?: Region;
}

export interface Annotation {
  id: string;
  kind: "text" | "spotlight";
  text: string;
  x: number;
  y: number;
  startMs: number;
  endMs: number;
}

export interface EditRecipe {
  crop: Region;
  zoom: number;
  cursorHighlight: boolean;
  annotations: Annotation[];
}

export interface MediaItem {
  id: string;
  title: string;
  kind: CaptureKind;
  source: CaptureSource;
  mediaPath: string;
  posterPath: string | null;
  transcriptPath: string;
  summaryPath: string;
  durationMs: number;
  createdAt: string;
  recipe: EditRecipe;
}

export interface ExportResult {
  mediaPath: string;
  posterPath: string;
  transcriptPath: string;
  summaryPath: string;
}

export const DEFAULT_RECIPE: EditRecipe = {
  crop: { x: 0, y: 0, width: 100, height: 100 },
  zoom: 1,
  cursorHighlight: true,
  annotations: []
};

