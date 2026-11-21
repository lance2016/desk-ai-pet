import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMITS, activityUpdateSchema } from "./Activity";

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
