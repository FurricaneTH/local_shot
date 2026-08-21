import type { EditRecipe, Region } from "../types";

const RESERVED = /[<>:"/\\|?*\u0000-\u001F]/g;

export function safeFileName(input: string, fallback = "capture"): string {
  const normalized = input.normalize("NFKC").replace(RESERVED, "-").replace(/\s+/g, " ").trim();
  const withoutDots = normalized.replace(/^\.+|\.+$/g, "");
  return (withoutDots || fallback).slice(0, 96);
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function clampRegion(region: Region): Region {
  const x = Math.min(99, Math.max(0, region.x));
  const y = Math.min(99, Math.max(0, region.y));
  return {
    x,
    y,
    width: Math.min(100 - x, Math.max(1, region.width)),
    height: Math.min(100 - y, Math.max(1, region.height))
  };
}

export function validateRecipe(recipe: EditRecipe): EditRecipe {
  return {
    ...recipe,
    crop: clampRegion(recipe.crop),
    zoom: Math.min(4, Math.max(1, Number.isFinite(recipe.zoom) ? recipe.zoom : 1)),
    annotations: recipe.annotations
      .filter((item) => item.text.trim().length <= 500 && item.startMs >= 0 && item.endMs > item.startMs)
      .slice(0, 100)
  };
}

export function pathName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

