import { describe, expect, it } from "vitest";
import { composeHitMask } from "./hitMask";

/** Renders a mask as rows of `#` and `.` so expectations are readable. */
function draw(cells: boolean[], columns: number): string[] {
  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += columns) {
    rows.push(cells.slice(start, start + columns).map((cell) => (cell ? "#" : ".")).join(""));
  }
  return rows;
}

const base = { cell: 4, columns: 6, rows: 4, drawn: null, grow: 0, rects: [] };

describe("composeHitMask", () => {
  it("lets the mouse through everywhere when nothing is drawn", () => {
    expect(draw(composeHitMask(base), 6)).toEqual(["......", "......", "......", "......"]);
  });

  it("copies the drawn cells", () => {
    const drawn = { columns: 3, rows: 2, cells: [false, true, false, true, false, false] };
    expect(draw(composeHitMask({ ...base, drawn }), 6)).toEqual([".#....", "#.....", "......", "......"]);
  });

  it("places the drawn cells at the pet's offset in the window", () => {
    const drawn = { columns: 2, rows: 1, cells: [true, false] };
    expect(draw(composeHitMask({ ...base, drawn, offset: { columns: 2, rows: 1 } }), 6)).toEqual(["......", "..#...", "......", "......"]);
  });

  it("grows the drawn area and clips it to the window", () => {
    const drawn = { columns: 3, rows: 2, cells: [true, false, false, false, false, false] };
    expect(draw(composeHitMask({ ...base, drawn, grow: 1 }), 6)).toEqual(["##....", "##....", "......", "......"]);
  });

  it("marks every cell a rectangle touches", () => {
    const rects = [{ left: 5, top: 8, right: 13, bottom: 16 }];
    expect(draw(composeHitMask({ ...base, rects }), 6)).toEqual(["......", "......", ".###..", ".###.."]);
  });

  it("ignores the parts of a rectangle outside the window", () => {
    const rects = [{ left: -10, top: 12, right: 100, bottom: 100 }];
    expect(draw(composeHitMask({ ...base, rects }), 6)).toEqual(["......", "......", "......", "######"]);
  });
});
