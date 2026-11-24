import { describe, expect, it } from "vitest";
import { createHoverMark, HOVER_ATTRIBUTE, type Markable } from "./hoverMark";

class FakeElement implements Markable {
  readonly attributes = new Set<string>();
  constructor(readonly parentElement: FakeElement | null = null) {}
  setAttribute(name: string) { this.attributes.add(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  get hovered() { return this.attributes.has(HOVER_ATTRIBUTE); }
}

describe("createHoverMark", () => {
  const app = new FakeElement();
  const bar = new FakeElement(app);
  const first = new FakeElement(bar);
  const second = new FakeElement(bar);
  const under = (x: number) => (x === 1 ? first : x === 2 ? second : x === 0 ? app : null);

  it("marks the element under the cursor and its ancestors, and moves with the cursor", () => {
    const hover = createHoverMark((x) => under(x));
    hover.at(1, 0);
    expect([app.hovered, bar.hovered, first.hovered, second.hovered]).toEqual([true, true, true, false]);
    // Straight from one button to the next: only the new one looks hovered.
    hover.at(2, 0);
    expect([app.hovered, bar.hovered, first.hovered, second.hovered]).toEqual([true, true, false, true]);
    hover.at(0, 0);
    expect([app.hovered, bar.hovered, first.hovered, second.hovered]).toEqual([true, false, false, false]);
  });

  it("clears everything when the cursor leaves the pet or is over nothing", () => {
    const hover = createHoverMark((x) => under(x));
    hover.at(1, 0);
    hover.clear();
    expect([app.hovered, bar.hovered, first.hovered]).toEqual([false, false, false]);
    hover.at(2, 0);
    hover.at(9, 0);
    expect([app.hovered, bar.hovered, second.hovered]).toEqual([false, false, false]);
  });
});
