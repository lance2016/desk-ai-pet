import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { codingInbox, loadInboxMarks, saveInboxMark, SNOOZE_MS } from "./codingInbox";
import { ClaudeSessions } from "./ClaudeSessions";
import type { CodingSession } from "./CodingSession";

const NOW = 1_000_000;

function session(id: string, turn: CodingSession["turn"], extra: Partial<CodingSession> = {}): CodingSession {
  return { id, project: id, provider: "claude-code", turn, ended: false, revealable: true, lastEventAt: NOW, ...extra };
}

describe("coding inbox", () => {
  it("puts live questions first, then errors and results across projects, even after the card would expire", () => {
    const waiting = session("waiting", "waiting");
    const sessions = [
      session("working", "working"),
      session("complete", "completed", { ended: true, turnEndedAt: NOW - 20 * 60_000 }),
      session("failed", "failed", { turnEndedAt: NOW }),
      waiting,
    ];
    expect(codingInbox(sessions, [], NOW).pending.map(({ session }) => session.id)).toEqual(["waiting", "failed", "complete"]);
    sessions[3] = { ...waiting, turn: "working" };
    expect(codingInbox(sessions, [], NOW).pending.map(({ session }) => session.id)).toEqual(["failed", "complete"]);
  });

  it("holds a turn left to background work back until Claude has gone on and finished it", () => {
    const sessions = new ClaudeSessions();
    const identity = { session: "pet", project: "ai-pet" };
    sessions.report({ ...identity, event: "UserPromptSubmit", task: "跑测试" }, NOW - 10 * 60_000);
    sessions.report({ ...identity, event: "Stop", summary: "测试还在后台跑", background: true }, NOW - 8 * 60_000);
    expect(codingInbox(sessions.list(), [], NOW).pending).toEqual([]);
    sessions.report({ ...identity, event: "UserPromptSubmit", woke: true }, NOW - 60_000);
    sessions.report({ ...identity, event: "Stop", summary: "测试都过了" }, NOW);
    expect(codingInbox(sessions.list(), [], NOW).pending).toMatchObject([{ turn: "completed", at: NOW, task: "跑测试", line: "测试都过了" }]);
  });

  it("keeps an error whose start hook was missed when the user retries", () => {
    const sessions = new ClaudeSessions();
    const identity = { session: "pet", project: "ai-pet" };
    sessions.report({ ...identity, event: "StopFailure", error: "rate_limit" }, NOW - 1);
    sessions.report({ ...identity, event: "UserPromptSubmit", task: "Retry" }, NOW);
    expect(codingInbox(sessions.list(), [], NOW).pending).toMatchObject([
      { turn: "failed", at: NOW - 1, line: "额度用完了" },
    ]);
  });

  it("keeps a previous result and remembers each round separately after a reload", () => {
    const storage = createMemoryStorage();
    const old = session("pet", "completed", { turnEndedAt: NOW - 1 });
    const { keys, pending: [first] } = codingInbox([old], [], NOW);
    saveInboxMark(first.key, 0, keys, storage);

    const current = session("pet", "completed", { turnEndedAt: NOW, earlier: [{ turn: "completed", endedAt: NOW - 1 }] });
    const marks = loadInboxMarks(storage);
    expect(codingInbox([current], [], NOW).pending).toHaveLength(2);
    expect(codingInbox([current], marks, NOW).pending.map(({ at }) => at)).toEqual([NOW]);
  });

  it("restores a snoozed result at the deadline or when brought back manually", () => {
    const storage = createMemoryStorage();
    const sessions = [session("pet", "failed", { turnEndedAt: NOW })];
    const { pending: [item], keys } = codingInbox(sessions, [], NOW);
    const until = NOW + SNOOZE_MS;
    const marks = saveInboxMark(item.key, until, keys, storage);
    expect(codingInbox(sessions, marks, until - 1).later.map(({ key }) => key)).toEqual([item.key]);
    expect(codingInbox(sessions, marks, until).pending.map(({ key }) => key)).toEqual([item.key]);
    const restored = saveInboxMark(item.key, null, keys, storage);
    expect(codingInbox(sessions, restored, NOW).pending.map(({ key }) => key)).toEqual([item.key]);
  });
});
