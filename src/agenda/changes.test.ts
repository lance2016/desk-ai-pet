import { describe, expect, it } from "vitest";
import type { AgendaItem } from "./AgendaStore";
import { agendaChange, hasNewId } from "./changes";

const item = (id: string, doneAt: number | null = null): AgendaItem => ({ id, text: id, remindAt: 1_000, repeat: null, createdAt: 0, doneAt, remindedAt: null });

describe("agendaChange", () => {
  it("sees a reminder that was added", () => {
    expect(agendaChange([item("a")], [item("a"), item("b")])).toBe("added");
  });

  it("sees a reminder that was ticked off, also a repeating one ticked off again", () => {
    expect(agendaChange([item("a")], [item("a", 5_000)])).toBe("done");
    expect(agendaChange([item("a", 5_000)], [item("a", 9_000)])).toBe("done");
  });

  it("counts adding over ticking off when both happen at once", () => {
    expect(agendaChange([item("a")], [item("a", 5_000), item("b")])).toBe("added");
  });

  it("makes nothing of unticking, removing or marking as shown", () => {
    expect(agendaChange([item("a", 5_000)], [item("a")])).toBeNull();
    expect(agendaChange([item("a"), item("b")], [item("a")])).toBeNull();
    expect(agendaChange([item("a")], [{ ...item("a"), remindedAt: 2_000 }])).toBeNull();
  });
});

describe("hasNewId", () => {
  it("is true only when an id appears", () => {
    expect(hasNewId(new Set(["a"]), ["a", "b"])).toBe(true);
    expect(hasNewId(new Set(["a", "b"]), ["b"])).toBe(false);
  });
});
