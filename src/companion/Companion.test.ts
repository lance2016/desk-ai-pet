import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPANION, type CompanionPreferences } from "../preferences/CompanionPreferences";
import { DEFAULT_QUIET_PREFERENCES } from "../preferences/QuietPreferences";
import { createMemoryStorage } from "../testing/fixtures";
import { Companion, type CompanionPorts } from "./Companion";
import type { GreetingFacts } from "./GreetingContent";
import { loadHistory } from "./history";
import type { Line } from "./types";

const MINUTE = 60_000;
const MORNING = new Date(2026, 10, 16, 9, 0).getTime();
const FACTS: GreetingFacts = { openCount: 0, doneToday: 0, nextReminder: null, latestReminder: null, focusToday: 0, lastDay: null, leftovers: [] };
/** For the lines that are not greetings: the morning greeting would come first. */
const NO_MORNING: CompanionPreferences = { ...DEFAULT_COMPANION, morningGreeting: false };

function setup(overrides: Partial<CompanionPorts> = {}, settings: CompanionPreferences = DEFAULT_COMPANION) {
  const said: Line[] = [];
  const shown: string[] = [];
  const write = vi.fn(async (_intent: string, _facts: string[], _now: number) => "早呀，今天也加油！");
  const ports: CompanionPorts = {
    settings: () => settings,
    quietHours: () => DEFAULT_QUIET_PREFERENCES.quietHours,
    storage: createMemoryStorage(),
    maySpeak: () => true,
    day: async () => FACTS,
    write,
    say: (line) => { said.push(line); return true; },
    show: (text) => { shown.push(text); return true; },
    ...overrides,
  };
  return { companion: new Companion(ports), ports, said, shown, write, texts: () => said.map((line) => line.text) };
}

/** The user at the computer, sampled once a minute. */
async function use(companion: Companion, from: number, until: number) {
  for (let time = from; time <= until; time += MINUTE) await companion.check(time, 0);
}

describe("greetings", () => {
  it("greets once with the model's words and remembers the day", async () => {
    const { companion, texts, write, ports } = setup();
    await companion.check(MORNING, 0);
    await companion.check(MORNING + MINUTE, 0);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("向用户问好，开始新的一天", ["今天要处理的提醒 0 个"], MORNING);
    expect(loadHistory(ports.storage)).toEqual([{ occasion: "morning", subject: "2026-11-16", at: MORNING }]);
  });

  it("offers to move earlier reminders only in the morning", async () => {
    const day = async () => ({ ...FACTS, leftovers: [{ text: "交周报", at: MORNING - 24 * 60 * MINUTE }] });
    const morning = setup({ day });
    await morning.companion.check(MORNING, 0);
    expect(morning.said.map((line) => line.offerMove)).toEqual([true]);
    const evening = setup({ day });
    await evening.companion.check(new Date(2026, 10, 16, 22, 40).getTime(), null);
    expect(evening.said.map((line) => line.offerMove)).toEqual([false]);
    expect(evening.write).toHaveBeenCalledWith("跟用户道晚安，收个尾", expect.any(Array), expect.any(Number));
  });

  it("falls back to the template when the model fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { companion, texts } = setup({ write: async () => { throw new Error("offline"); } });
    await companion.check(MORNING, 0);
    expect(texts()).toEqual(["早上好！今天也一起加油吧～"]);
    warning.mockRestore();
  });

  it("does not ask the model while the pet may not speak up, and greets once it may", async () => {
    let allowed = false;
    const { companion, texts, write, ports } = setup({ maySpeak: () => allowed });
    await companion.check(MORNING, 0);
    expect(write).not.toHaveBeenCalled();
    expect(loadHistory(ports.storage)).toEqual([]);
    allowed = true;
    await companion.check(MORNING + MINUTE, 0);
    expect(texts()).toHaveLength(1);
  });

  it("tries again later when the line is held back at the last moment", async () => {
    let shows = false;
    const { companion, said, ports } = setup({ say: (line) => { if (shows) said.push(line); return shows; } });
    await companion.check(MORNING, 0);
    expect(loadHistory(ports.storage)).toEqual([]);
    shows = true;
    await companion.check(MORNING + MINUTE, 0);
    expect(said).toHaveLength(1);
    expect(loadHistory(ports.storage)).toHaveLength(1);
  });

  it("can disable the scheduled morning greeting independently", async () => {
    const { companion, said } = setup({}, NO_MORNING);
    await companion.check(MORNING, 0);
    expect(said).toEqual([]);
  });

  it("waits for user activity inside the morning window", async () => {
    const { companion, texts } = setup();
    await companion.check(MORNING, null);
    await companion.check(MORNING + MINUTE, 600);
    expect(texts()).toEqual([]);
    await companion.check(MORNING + 2 * MINUTE, 0);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
  });

  it("does not ask twice while a line is being written", async () => {
    let finish!: (text: string) => void;
    const write = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { companion, texts } = setup({ write });
    const first = companion.check(MORNING, 0);
    await companion.check(MORNING, 0);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    finish("早！");
    await first;
    expect(write).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual(["早！"]);
  });
});

describe("care", () => {
  it("waits for activity and cares only once per night, including after restart", async () => {
    const storage = createMemoryStorage();
    const start = new Date(2026, 10, 17, 23, 30).getTime();
    const first = setup({ storage });
    await use(first.companion, start, start + 20 * MINUTE);
    const second = setup({ storage });
    await use(second.companion, start + 21 * MINUTE, start + 41 * MINUTE);
    expect(first.said).toEqual([{ text: expect.stringContaining("很晚"), allowQuiet: false, offerMove: false }]);
    expect(second.said).toEqual([]);
    expect(first.write).not.toHaveBeenCalled();
  });

  it("lets late-night care through quiet hours only when the user chose so", async () => {
    const start = new Date(2026, 10, 17, 23, 30).getTime();
    const quietHours = (allowQuiet: boolean) => allowQuiet;
    const kept = setup({ maySpeak: quietHours });
    await use(kept.companion, start, start + 20 * MINUTE);
    expect(kept.said).toEqual([]);
    const through = setup({ maySpeak: quietHours }, { ...DEFAULT_COMPANION, nightDuringQuiet: true });
    await use(through.companion, start, start + 20 * MINUTE);
    expect(through.said).toEqual([{ text: expect.stringContaining("很晚"), allowQuiet: true, offerMove: false }]);
  });

  it("suggests a rest after long use, and counts again after a real break or after saying so", async () => {
    const { companion, texts } = setup({}, NO_MORNING);
    const start = new Date(2026, 10, 17, 12).getTime();
    await use(companion, start, start + 50 * MINUTE);
    await companion.check(start + 51 * MINUTE, 300);
    await use(companion, start + 52 * MINUTE, start + 141 * MINUTE);
    expect(texts()).toEqual([]);
    await companion.check(start + 142 * MINUTE, 0);
    expect(texts()).toEqual([expect.stringContaining("休息一下")]);
    await use(companion, start + 143 * MINUTE, start + 231 * MINUTE);
    expect(texts()).toHaveLength(1);
    await companion.check(start + 232 * MINUTE, 0);
    expect(texts()).toHaveLength(2);
    // A gap in the samples: how long the user has been at it is no longer known.
    await companion.check(start + 400 * MINUTE, 0);
    expect(texts()).toHaveLength(2);
  });

  it("welcomes a return once, and not late when it could not speak up then", async () => {
    const start = new Date(2026, 10, 17, 14).getTime();
    const { companion, texts } = setup({}, NO_MORNING);
    await companion.check(start, 1800);
    await companion.check(start + MINUTE, 0);
    await companion.check(start + 2 * MINUTE, 0);
    expect(texts()).toEqual(["回来啦，欢迎回来～"]);

    let allowed = false;
    const focusing = setup({ maySpeak: () => allowed }, NO_MORNING);
    await focusing.companion.check(start, 1800);
    await focusing.companion.check(start + MINUTE, 0);
    allowed = true;
    await focusing.companion.check(start + 2 * MINUTE, 0);
    expect(focusing.said).toEqual([]);
  });

  it("says good morning, not welcome back, when the user returns in the morning", async () => {
    const { companion, texts } = setup();
    await companion.check(MORNING - MINUTE, 1800);
    await companion.check(MORNING, 0);
    await companion.check(MORNING + MINUTE, 0);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
  });
});

describe("trying an occasion", () => {
  it("shows the line now without using up the scheduled one", async () => {
    const { companion, shown, said, write, ports } = setup();
    expect(await companion.test("morning", MORNING)).toBe(true);
    expect(await companion.test("rest", MORNING)).toBe(true);
    expect(shown).toEqual(["早呀，今天也加油！", "我想伸个懒腰，你也休息一下吧。"]);
    expect(write).toHaveBeenCalledWith("向用户问好，开始新的一天", ["今天要处理的提醒 0 个"], MORNING);
    expect(said).toEqual([]);
    expect(loadHistory(ports.storage)).toEqual([]);
  });

  it("refuses an occasion it does not know, or while another line is being written", async () => {
    let finish!: (text: string) => void;
    const { companion } = setup({ write: () => new Promise<string>((resolve) => { finish = resolve; }) });
    expect(await companion.test("unknown", MORNING)).toBe(false);
    const first = companion.test("morning", MORNING);
    expect(await companion.test("rest", MORNING)).toBe(false);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish("早！");
    expect(await first).toBe(true);
  });
});
