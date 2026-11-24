import { describe, expect, it } from "vitest";
import type { ActivityUpdate } from "../types";
import { ActivityBoard } from "./ActivityBoard";

const build = (id: string, state: ActivityUpdate["state"], extra: Partial<ActivityUpdate> = {}): ActivityUpdate => ({ id, state, label: `${id} 的事`, icon: "mail", ...extra });

describe("ActivityBoard", () => {
  it("shows a chip for what is running or waiting for the user, in the order they came", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running", { cancellable: true }));
    board.report(build("b", "waiting"));
    expect(board.chips()).toEqual([
      { id: "activity", label: "a 的事", activity: { id: "a", waiting: false, cancellable: true } },
      { id: "activity", label: "b 的事", activity: { id: "b", waiting: true, cancellable: false } },
    ]);
  });

  it("gives no chip to an activity shown somewhere of its own, and still tells its news", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running", { noChip: true }));
    expect(board.chips()).toEqual([]);
    board.report(build("a", "waiting", { noChip: true, text: "等你点头" }));
    expect(board.chips()).toEqual([]);
    expect(board.notice()?.text).toBe("等你点头");
  });

  it("says whether an activity of a kind is running", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running", { icon: "agent" }));
    board.report(build("b", "waiting", { icon: "timer" }));
    expect(board.running("agent")).toBe(true);
    expect(board.running("timer")).toBe(false);
    board.report(build("a", "cancelled", { icon: "agent" }));
    expect(board.running("agent")).toBe(false);
  });

  it("keeps a chip in its place when its activity moves on", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running"));
    board.report(build("b", "running"));
    board.report(build("a", "waiting"));
    expect(board.chips().map((chip) => chip.activity?.id)).toEqual(["a", "b"]);
  });

  it("drops the chip once the activity is over", () => {
    for (const state of ["done", "failed", "cancelled"] as const) {
      const board = new ActivityBoard();
      board.report(build("a", "running"));
      board.report(build("a", state, { text: "结果" }));
      expect(board.chips()).toEqual([]);
    }
  });

  it("has no line for an activity that just runs", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running", { text: "正在跑" }));
    expect(board.notice()).toBeNull();
  });

  it("keeps a failure up until it is dismissed, then forgets the activity", () => {
    const board = new ActivityBoard();
    board.report(build("a", "failed", { text: "没成" }));
    expect(board.notice()?.text).toBe("没成");
    board.dismiss();
    expect(board.notice()).toBeNull();
  });

  it("keeps no line for a success: it is only said in passing", () => {
    const board = new ActivityBoard();
    board.report(build("a", "waiting", { text: "等你点头" }));
    expect(board.report(build("a", "done", { text: "做完了" }))).toBe(true);
    expect(board.notice()).toBeNull();
    expect(board.chips()).toEqual([]);
  });

  it("keeps a success the user still needs up until it is dismissed, without a chip", () => {
    const board = new ActivityBoard();
    board.report(build("a", "running"));
    board.report(build("a", "done", { text: "验证码 1234", keep: true }));
    expect(board.notice()?.text).toBe("验证码 1234");
    expect(board.chips()).toEqual([]);
    board.dismiss();
    expect(board.notice()).toBeNull();
  });

  it("counts every line waiting to stand", () => {
    const board = new ActivityBoard();
    board.report(build("a", "failed", { text: "没成" }));
    board.report(build("b", "waiting", { text: "等你点头" }));
    board.report(build("c", "running", { text: "正在跑" }));
    expect(board.noticeCount()).toBe(2);
    board.dismiss();
    expect(board.noticeCount()).toBe(1);
  });

  it("puts what waits for the user ahead of results", () => {
    const board = new ActivityBoard();
    board.report(build("a", "failed", { text: "没成" }));
    board.report(build("b", "waiting", { text: "等你点头" }));
    expect(board.notice()?.text).toBe("等你点头");
    board.dismiss();
    expect(board.notice()?.text).toBe("没成");
  });

  it("keeps the chip of a waiting activity after its line is dismissed, and does not bring the line back", () => {
    const board = new ActivityBoard();
    board.report(build("a", "waiting", { text: "等你点头" }));
    board.dismiss();
    expect(board.notice()).toBeNull();
    expect(board.chips()).toHaveLength(1);
    expect(board.report(build("a", "waiting", { text: "等你点头" }))).toBe(false);
    expect(board.notice()).toBeNull();
  });

  it("asks again when a waiting activity asks something new", () => {
    const board = new ActivityBoard();
    board.report(build("a", "waiting", { text: "第一件" }));
    board.dismiss();
    expect(board.report(build("a", "waiting", { text: "第二件" }))).toBe(true);
    expect(board.notice()?.text).toBe("第二件");
  });

  it("takes down the last result when the activity starts again or is cancelled", () => {
    for (const state of ["running", "cancelled"] as const) {
      const board = new ActivityBoard();
      board.report(build("a", "failed", { text: "没成" }));
      board.report(build("a", state));
      expect(board.notice()).toBeNull();
    }
  });

  it("tells a new report from a repeated one", () => {
    const board = new ActivityBoard();
    expect(board.report(build("a", "running"))).toBe(true);
    expect(board.report(build("a", "running"))).toBe(false);
    expect(board.report(build("a", "done"))).toBe(true);
    expect(board.report(build("gone", "cancelled"))).toBe(false);
  });
});
