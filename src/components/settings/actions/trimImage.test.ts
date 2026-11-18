import { describe, expect, it } from "vitest";
import { visibleBounds } from "./trimImage";

/** A width × height RGBA image, see-through except the listed [x, y, alpha] pixels. */
function image(width: number, height: number, filled: [number, number, number][] = [], background = 0): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = background;
  for (const [x, y, alpha] of filled) pixels[(y * width + x) * 4 + 3] = alpha;
  return pixels;
}

describe("visibleBounds", () => {
  it("returns the padded rectangle around visible pixels", () => {
    const result = visibleBounds(image(10, 10, [[4, 3, 255], [6, 5, 40]]), 10, 10, 1);
    expect(result).toEqual({ bounds: { x: 3, y: 2, width: 5, height: 5 }, opaque: false });
  });

  it("keeps the padding inside the image", () => {
    const { bounds } = visibleBounds(image(4, 4, [[0, 0, 255], [3, 3, 255]]), 4, 4, 2);
    expect(bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("reports a picture with no see-through pixel as opaque", () => {
    expect(visibleBounds(image(3, 2, [], 255), 3, 2)).toEqual({ bounds: { x: 0, y: 0, width: 3, height: 2 }, opaque: true });
  });

  it("returns no bounds for a fully transparent picture", () => {
    expect(visibleBounds(image(3, 3), 3, 3).bounds).toBeNull();
  });
});
