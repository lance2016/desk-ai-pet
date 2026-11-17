import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./EventBus";

interface TestEvents {
  ping: { value: number };
  pong: Record<string, never>;
}

describe("EventBus", () => {
  it("delivers the payload to every listener of that event only", () => {
    const bus = new EventBus<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    bus.on("ping", first);
    bus.on("ping", second);
    bus.on("pong", other);

    bus.emit("ping", { value: 7 });

    expect(first).toHaveBeenCalledWith({ value: 7 });
    expect(second).toHaveBeenCalledWith({ value: 7 });
    expect(other).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribing", () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    const unsubscribe = bus.on("ping", listener);

    unsubscribe();
    bus.emit("ping", { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("lets a listener unsubscribe during dispatch without skipping others", () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const unsubscribe = bus.on("ping", () => unsubscribe());
    bus.on("ping", second);

    bus.emit("ping", { value: 1 });

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores events nobody listens to", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("pong", {})).not.toThrow();
  });
});
