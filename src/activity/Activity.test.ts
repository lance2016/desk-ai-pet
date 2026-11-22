import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMITS, activityUpdateSchema, elapsedText } from "./Activity";

const valid = { id: "agent:7f3a", state: "waiting", label: "等你确认", icon: "mail", text: "要运行 rm -rf dist" };

describe("activityUpdateSchema", () => {
  it("accepts a well-formed report", () => {
    expect(activityUpdateSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown state, a bad id and an empty label", () => {
    expect(activityUpdateSchema.safeParse({ ...valid, state: "paused" }).success).toBe(false);
    expect(activityUpdateSchema.safeParse({ ...valid, id: "有 空格" }).success).toBe(false);
    expect(activityUpdateSchema.safeParse({ ...valid, label: " " }).success).toBe(false);
  });

  it("rejects a label or a text too long for the pet's bubble", () => {
    expect(activityUpdateSchema.safeParse({ ...valid, label: "长".repeat(ACTIVITY_LIMITS.label + 1) }).success).toBe(false);
    expect(activityUpdateSchema.safeParse({ ...valid, text: "长".repeat(ACTIVITY_LIMITS.text + 1) }).success).toBe(false);
  });

  it("drops fields it does not know", () => {
    expect(activityUpdateSchema.parse({ ...valid, command: "rm -rf /" })).toEqual(valid);
  });
});

describe("elapsedText", () => {
  it("says nothing for the first minute, then minutes, then hours", () => {
    expect(elapsedText(59_999)).toBeNull();
    expect(elapsedText(4 * 60_000 + 30_000)).toBe("4 分");
    expect(elapsedText(60 * 60_000)).toBe("1 小时");
    expect(elapsedText(65 * 60_000)).toBe("1 小时 5 分");
  });
});
