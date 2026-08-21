import { describe, expect, it } from "vitest";
import { clampRegion, safeFileName, validateRecipe } from "./format";
import { DEFAULT_RECIPE } from "../types";

describe("safeFileName", () => {
  it("removes traversal and platform-reserved characters", () => {
    expect(safeFileName(" ../release:demo?.mp4 ")).toBe("-release-demo-.mp4");
    expect(safeFileName("...", "capture")).toBe("capture");
  });
});

describe("non-destructive transform validation", () => {
  it("clamps crop and zoom without mutating the source recipe", () => {
    const recipe = { ...DEFAULT_RECIPE, crop: { x: -20, y: 98, width: 180, height: 0 }, zoom: 9 };
    const valid = validateRecipe(recipe);
    expect(valid.crop).toEqual({ x: 0, y: 98, width: 100, height: 1 });
    expect(valid.zoom).toBe(4);
    expect(recipe.zoom).toBe(9);
  });

  it("keeps a region inside the captured frame", () => {
    expect(clampRegion({ x: 80, y: 75, width: 50, height: 50 })).toEqual({ x: 80, y: 75, width: 20, height: 25 });
  });
});
