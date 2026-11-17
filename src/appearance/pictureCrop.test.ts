import { describe, expect, it } from "vitest";
import { coverCrop, cropStyle, CROP_LIMITS, headCrop, panCrop, zoomCrop } from "./pictureCrop";

const SQUARE = 1;

describe("picture crop", () => {
  it("fills the frame with the middle of an upload", () => {
    // A landscape photo in a round frame: the frame is as tall as the photo.
    expect(coverCrop(0.5, SQUARE)).toEqual({ x: 0.5, y: 0.5, zoom: 0.5, ratio: 0.5 });
    // A portrait photo: the frame is as wide as the photo.
    expect(coverCrop(2, SQUARE)).toEqual({ x: 0.5, y: 0.5, zoom: 1, ratio: 2 });
  });

  it("turns a crop into CSS that puts the crop centre in the middle of the frame", () => {
    const style = cropStyle({ x: 0.5, y: 0.5, zoom: 0.5, ratio: 1 }, SQUARE);
    expect(style).toEqual({ width: "200%", left: "-50%", top: "-50%" });
  });

  it("matches the old head crop for full-body action images", () => {
    const style = cropStyle(headCrop(583 / 429, SQUARE), SQUARE);
    expect(parseFloat(style.width)).toBeCloseTo(170);
    expect(parseFloat(style.left)).toBeCloseTo(-35);
    expect(parseFloat(style.top)).toBeCloseTo(4);
  });

  it("moves with the pointer and keeps the centre on the picture", () => {
    const crop = { x: 0.5, y: 0.5, zoom: 0.5, ratio: 1 };
    // Frame 100px wide, so the picture is 200px wide: dragging 20px right shows 10% more of the left side.
    expect(panCrop(crop, 20, 0, 100).x).toBeCloseTo(0.4);
    expect(panCrop(crop, 0, -40, 100).y).toBeCloseTo(0.7);
    expect(panCrop(crop, 10_000, 10_000, 100)).toMatchObject({ x: 0, y: 0 });
  });

  it("zooms within limits", () => {
    const crop = { x: 0.5, y: 0.5, zoom: 0.5, ratio: 1 };
    expect(zoomCrop(crop, 0.5).zoom).toBeCloseTo(0.25);
    expect(zoomCrop(crop, 100).zoom).toBe(CROP_LIMITS.maxZoom);
    expect(zoomCrop(crop, 0.0001).zoom).toBe(CROP_LIMITS.minZoom);
  });
});
