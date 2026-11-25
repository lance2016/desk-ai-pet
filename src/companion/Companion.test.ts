import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPANION, type CompanionPreferences } from "../preferences/CompanionPreferences";
import { DEFAULT_QUIET_PREFERENCES } from "../preferences/QuietPreferences";
import type { AgendaItem } from "../agenda/AgendaStore";
import { createMemoryStorage } from "../testing/fixtures";
import { Companion, type CompanionPorts } from "./Companion";
import type { GreetingFacts } from "./GreetingContent";
import { loadHistory } from "./history";
import { setHush } from "./hush";
import type { Line } from "./types";

const MINUTE = 60_000;
const MORNING = new Date(2026, 10, 16, 9, 0).getTime();
const FACTS: GreetingFacts = { openCount: 0, doneToday: 0, nextReminder: null, latestReminder: null, focusToday: 0, lastDay: null, leftovers: [] };
/** At the computer, hands off the keyboard for a moment: seconds without input. */
const HERE = 5;
/** Care in fixed words, so a test can tell what was said. */
const PLAIN: CompanionPreferences = { ...DEFAULT_COMPANION, careByModel: false };
/** For the lines that are not greetings: the morning greeting would come first. */
const NO_MORNING: CompanionPreferences = { ...PLAIN, morningGreeting: false };
/** Care written by the model, as a new install has it. */
const WRITTEN: CompanionPreferences = { ...DEFAULT_COMPANION, morningGreeting: false };

function setup(overrides: Partial<CompanionPorts> = {}, settings: CompanionPreferences = PLAIN) {
  const said: Line[] = [];
  const shown: string[] = [];
  const write = vi.fn(async (_intent: string, _facts: string[], _now: number) => "早呀，今天也加油！");
  const ports: CompanionPorts = {
    settings: () => settings,
    quietHours: () => DEFAULT_QUIET_PREFERENCES.quietHours,
    storage: createMemoryStorage(),
    maySpeak: () => true,
    reminders: () => [],
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
  for (let time = from; time <= until; time += MINUTE) await companion.check(time, HERE);
}

describe("greetings", () => {
  it("greets once with the model's words and remembers the day", async () => {
    const { companion, texts, write, ports } = setup();
    await companion.check(MORNING, HERE);
    await companion.check(MORNING + MINUTE, HERE);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("向用户问好，开始新的一天", ["今天要处理的提醒 0 个"], MORNING);
    expect(loadHistory(ports.storage)).toEqual([{ occasion: "morning", subject: "2026-11-16", at: MORNING }]);
  });

  it("offers to move earlier reminders only in the morning", async () => {
    const day = async () => ({ ...FACTS, leftovers: [{ text: "交周报", at: MORNING - 24 * 60 * MINUTE }] });
    const morning = setup({ day });
    await morning.companion.check(MORNING, HERE);
    expect(morning.said.map((line) => line.offerMove)).toEqual([true]);
    const evening = setup({ day });
    await evening.companion.check(new Date(2026, 10, 16, 22, 40).getTime(), null);
    expect(evening.said.map((line) => line.offerMove)).toEqual([false]);
    expect(evening.write).toHaveBeenCalledWith("跟用户道晚安，收个尾", expect.any(Array), expect.any(Number));
  });

  it("keeps good night to its own switch and time", async () => {
    const late = new Date(2026, 10, 16, 22, 40).getTime();
    const off = setup({}, { ...PLAIN, eveningGreeting: false });
    await off.companion.check(late, null);
    expect(off.said).toEqual([]);
    const moved = setup({}, { ...PLAIN, eveningTime: "21:00" });
    await moved.companion.check(late, null);
    expect(moved.said).toEqual([]);
    await moved.companion.check(new Date(2026, 10, 16, 21, 10).getTime(), null);
    expect(moved.said).toHaveLength(1);
  });

  it("falls back to the template when the model fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { companion, texts } = setup({ write: async () => { throw new Error("offline"); } });
    await companion.check(MORNING, HERE);
    expect(texts()).toEqual(["早上好！今天也一起加油吧～"]);
    warning.mockRestore();
  });

  it("does not ask the model while the pet may not speak up, and greets once it may", async () => {
    let allowed = false;
    const { companion, texts, write, ports } = setup({ maySpeak: () => allowed });
    await companion.check(MORNING, HERE);
    expect(write).not.toHaveBeenCalled();
    expect(loadHistory(ports.storage)).toEqual([]);
    allowed = true;
    await companion.check(MORNING + MINUTE, HERE);
    expect(texts()).toHaveLength(1);
  });

  it("tries again later when the line is held back at the last moment", async () => {
    let shows = false;
    const { companion, said, ports } = setup({ say: (line) => { if (shows) said.push(line); return shows; } });
    await companion.check(MORNING, HERE);
    expect(loadHistory(ports.storage)).toEqual([]);
    shows = true;
    await companion.check(MORNING + MINUTE, HERE);
    expect(said).toHaveLength(1);
    expect(loadHistory(ports.storage)).toHaveLength(1);
  });

  it("can disable the scheduled morning greeting independently", async () => {
    const { companion, said } = setup({}, NO_MORNING);
    await companion.check(MORNING, HERE);
    expect(said).toEqual([]);
  });

  it("waits for user activity inside the morning window", async () => {
    const { companion, texts } = setup();
    await companion.check(MORNING, null);
    await companion.check(MORNING + MINUTE, 600);
    expect(texts()).toEqual([]);
    await companion.check(MORNING + 2 * MINUTE, HERE);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
  });

  it("does not ask twice while a line is being written", async () => {
    let finish!: (text: string) => void;
    const write = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { companion, texts } = setup({ write });
    const first = companion.check(MORNING, HERE);
    await companion.check(MORNING, HERE);
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
    const through = setup({ maySpeak: quietHours }, { ...PLAIN, nightDuringQuiet: true });
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
    await companion.check(start + 142 * MINUTE, HERE);
    expect(texts()).toEqual([expect.stringContaining("休息一下")]);
    await use(companion, start + 143 * MINUTE, start + 231 * MINUTE);
    expect(texts()).toHaveLength(1);
    await companion.check(start + 232 * MINUTE, HERE);
    expect(texts()).toHaveLength(2);
    // A gap in the samples: how long the user has been at it is no longer known.
    await companion.check(start + 400 * MINUTE, HERE);
    expect(texts()).toHaveLength(2);
  });

  it("welcomes a return once, and not late when it could not speak up then", async () => {
    const start = new Date(2026, 10, 17, 14).getTime();
    const { companion, texts } = setup({}, NO_MORNING);
    await companion.check(start, 1800);
    await companion.check(start + MINUTE, HERE);
    await companion.check(start + 2 * MINUTE, HERE);
    expect(texts()).toEqual(["回来啦，欢迎回来～"]);

    let allowed = false;
    const focusing = setup({ maySpeak: () => allowed }, NO_MORNING);
    await focusing.companion.check(start, 1800);
    await focusing.companion.check(start + MINUTE, HERE);
    allowed = true;
    await focusing.companion.check(start + 2 * MINUTE, HERE);
    expect(focusing.said).toEqual([]);
  });

  it("says good morning, not welcome back, when the user returns in the morning", async () => {
    const { companion, texts } = setup();
    await companion.check(MORNING - MINUTE, 1800);
    await companion.check(MORNING, HERE);
    await companion.check(MORNING + MINUTE, HERE);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
  });
});

const AFTERNOON = new Date(2026, 10, 17, 14).getTime();
const reminder = (overrides: Partial<AgendaItem> = {}): AgendaItem => ({ id: "r1", text: "开会", remindAt: AFTERNOON + 30 * MINUTE, repeat: null, createdAt: AFTERNOON - 3 * 60 * MINUTE, doneAt: null, remindedAt: null, ...overrides });

describe("a word ahead of a reminder", () => {
  it("mentions a one-off reminder ten minutes ahead, once, without the model", async () => {
    const { companion, texts, write } = setup({ reminders: () => [reminder()] }, NO_MORNING);
    await use(companion, AFTERNOON, AFTERNOON + 19 * MINUTE);
    expect(texts()).toEqual([]);
    await use(companion, AFTERNOON + 20 * MINUTE, AFTERNOON + 29 * MINUTE);
    expect(texts()).toEqual(["还有 10 分钟：开会"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("follows the reminder into quiet hours, as the reminder itself does", async () => {
    const { companion, said } = setup({ reminders: () => [reminder()] }, NO_MORNING);
    await use(companion, AFTERNOON + 20 * MINUTE, AFTERNOON + 21 * MINUTE);
    expect(said[0].allowQuiet).toBe(true);
  });

  it("says nothing ahead of a reminder set just now, a repeating one, or one already seen to", async () => {
    const justSet = reminder({ createdAt: AFTERNOON });
    const daily = reminder({ id: "r2", repeat: [0, 1, 2, 3, 4, 5, 6] });
    const done = reminder({ id: "r3", doneAt: AFTERNOON });
    const { companion, texts } = setup({ reminders: () => [justSet, daily, done] }, NO_MORNING);
    await use(companion, AFTERNOON + 20 * MINUTE, AFTERNOON + 29 * MINUTE);
    expect(texts()).toEqual([]);
  });

  it("is not said while the user is away, with the reminder about to come, or when switched off", async () => {
    const away = setup({ reminders: () => [reminder()] }, NO_MORNING);
    await away.companion.check(AFTERNOON + 20 * MINUTE, 600);
    expect(away.said).toEqual([]);

    const late = setup({ reminders: () => [reminder()] }, NO_MORNING);
    await late.companion.check(AFTERNOON + 28 * MINUTE + 30_000, HERE);
    expect(late.said).toEqual([]);

    const off = setup({ reminders: () => [reminder()] }, { ...NO_MORNING, headsUp: false });
    await use(off.companion, AFTERNOON + 20 * MINUTE, AFTERNOON + 25 * MINUTE);
    expect(off.said).toEqual([]);
  });

  it("mentions it again when the reminder is moved to another time", async () => {
    let items = [reminder()];
    const { companion, texts } = setup({ reminders: () => items }, NO_MORNING);
    await companion.check(AFTERNOON + 20 * MINUTE, HERE);
    items = [reminder({ remindAt: AFTERNOON + 90 * MINUTE })];
    await companion.check(AFTERNOON + 80 * MINUTE, HERE);
    expect(texts()).toEqual(["还有 10 分钟：开会", "还有 10 分钟：开会"]);
  });
});

describe("asking after what the user left for", () => {
  const lunch = (overrides: Partial<AgendaItem> = {}) => reminder({ text: "出去吃饭", remindAt: AFTERNOON, remindedAt: AFTERNOON + MINUTE, ...overrides });
  /** At the computer until five past, gone for 45 minutes, then back. */
  async function leaveAndReturn(companion: Companion) {
    await companion.check(AFTERNOON + 5 * MINUTE, HERE);
    await companion.check(AFTERNOON + 50 * MINUTE, 45 * 60);
    await companion.check(AFTERNOON + 51 * MINUTE, HERE);
  }

  it("asks about the reminder the user left for instead of the plain welcome, in the model's words", async () => {
    const write = vi.fn(async () => "回来啦，饭吃得香不香？");
    const { companion, texts } = setup({ reminders: () => [lunch()], write }, WRITTEN);
    await leaveAndReturn(companion);
    expect(texts()).toEqual(["回来啦，饭吃得香不香？"]);
    expect(write).toHaveBeenCalledWith(
      "在用户回到电脑前时，像朋友一样顺着他刚才去做的那件事随口问一句，不要提“提醒”这两个字",
      ["用户 14:00 去做了这件事：「出去吃饭」，不知道做成没有", "用户离开了大约 45 分钟，刚回到电脑前"],
      AFTERNOON + 51 * MINUTE,
    );
  });

  it("asks in its own words when the model cannot answer, and knows a reminder ticked off", async () => {
    const write = vi.fn(async () => { throw new Error("offline"); });
    const open = setup({ reminders: () => [lunch()], write }, WRITTEN);
    await leaveAndReturn(open.companion);
    expect(open.texts()).toEqual(["回来啦～「出去吃饭」弄好了吗？"]);

    const ticked = setup({ reminders: () => [lunch({ doneAt: AFTERNOON + MINUTE })], write }, WRITTEN);
    await leaveAndReturn(ticked.companion);
    expect(ticked.texts()).toEqual(["回来啦～「出去吃饭」还顺利吗？"]);
  });

  it("asks once about the same reminder, also when the user leaves again right after", async () => {
    // Ticked off ahead of its time, so both times away are close to it.
    const early = lunch({ remindAt: AFTERNOON + 60 * MINUTE, remindedAt: null, doneAt: AFTERNOON });
    const { companion, texts } = setup({ reminders: () => [early], write: vi.fn(async () => "饭吃得怎么样？") }, { ...WRITTEN, welcomeBack: false });
    await companion.check(AFTERNOON + 35 * MINUTE, HERE);
    await companion.check(AFTERNOON + 80 * MINUTE, 45 * 60);
    await companion.check(AFTERNOON + 81 * MINUTE, HERE);
    await companion.check(AFTERNOON + 85 * MINUTE, HERE);
    await companion.check(AFTERNOON + 130 * MINUTE, 45 * 60);
    await companion.check(AFTERNOON + 131 * MINUTE, HERE);
    expect(texts()).toEqual(["饭吃得怎么样？"]);
  });

  it("just welcomes the user back when no reminder goes with their leaving", async () => {
    const longAgo = lunch({ remindAt: AFTERNOON - 3 * 60 * MINUTE, remindedAt: AFTERNOON - 3 * 60 * MINUTE });
    const stillDue = lunch({ id: "r2", remindedAt: null });
    const { companion, texts } = setup({ reminders: () => [longAgo, stillDue] }, NO_MORNING);
    await leaveAndReturn(companion);
    expect(texts()).toEqual(["回来啦，欢迎回来～"]);

    const off = setup({ reminders: () => [lunch()] }, { ...NO_MORNING, followUp: false });
    await leaveAndReturn(off.companion);
    expect(off.texts()).toEqual(["回来啦，欢迎回来～"]);
  });

  describe("a repeating reminder", () => {
    const DAY = 24 * 60 * MINUTE;
    /** Every day at two, made a week ago; today's time was shown a minute after it. */
    const daily = (overrides: Partial<AgendaItem> = {}) => lunch({ remindAt: AFTERNOON - 7 * DAY, createdAt: AFTERNOON - 8 * DAY, repeat: [0, 1, 2, 3, 4, 5, 6], ...overrides });

    it("asks after today's time, with today's time in the facts", async () => {
      const write = vi.fn(async () => "饭吃得怎么样？");
      const { companion, texts } = setup({ reminders: () => [daily()], write }, WRITTEN);
      await leaveAndReturn(companion);
      expect(texts()).toEqual(["饭吃得怎么样？"]);
      expect(write).toHaveBeenCalledWith(expect.any(String), ["用户 14:00 去做了这件事：「出去吃饭」，不知道做成没有", "用户离开了大约 45 分钟，刚回到电脑前"], AFTERNOON + 51 * MINUTE);
    });

    it("knows today's time was ticked off, and not yesterday's", async () => {
      const write = vi.fn(async () => { throw new Error("offline"); });
      const ticked = setup({ reminders: () => [daily({ doneAt: AFTERNOON })], write }, WRITTEN);
      await leaveAndReturn(ticked.companion);
      expect(ticked.texts()).toEqual(["回来啦～「出去吃饭」还顺利吗？"]);

      const yesterday = setup({ reminders: () => [daily({ doneAt: AFTERNOON - DAY })], write }, WRITTEN);
      await leaveAndReturn(yesterday.companion);
      expect(yesterday.texts()).toEqual(["回来啦～「出去吃饭」弄好了吗？"]);
    });

    it("does not ask when only yesterday's time was shown", async () => {
      const { companion, texts } = setup({ reminders: () => [daily({ remindedAt: AFTERNOON - DAY + MINUTE })] }, NO_MORNING);
      await leaveAndReturn(companion);
      expect(texts()).toEqual(["回来啦，欢迎回来～"]);
    });

    it("asks again the next day", async () => {
      let items = [daily()];
      const write = vi.fn(async () => "饭吃得怎么样？");
      const { companion, texts } = setup({ reminders: () => items, write }, { ...WRITTEN, welcomeBack: false });
      await leaveAndReturn(companion);
      items = [daily({ remindedAt: AFTERNOON + DAY + MINUTE })];
      await companion.check(AFTERNOON + DAY + 5 * MINUTE, HERE);
      await companion.check(AFTERNOON + DAY + 50 * MINUTE, 45 * 60);
      await companion.check(AFTERNOON + DAY + 51 * MINUTE, HERE);
      expect(texts()).toEqual(["饭吃得怎么样？", "饭吃得怎么样？"]);
    });
  });

  it("does not ask after a whole night away", async () => {
    const { companion, texts } = setup({ reminders: () => [lunch()] }, { ...NO_MORNING, welcomeBack: false });
    await companion.check(AFTERNOON + 5 * MINUTE, HERE);
    await companion.check(AFTERNOON + 10 * 60 * MINUTE, HERE);
    expect(texts()).toEqual([]);
  });

  it("asks after the computer slept through the time away, when no welcome is said", async () => {
    const { companion, texts } = setup({ reminders: () => [lunch()], write: vi.fn(async () => "饭吃得怎么样？") }, WRITTEN);
    await companion.check(AFTERNOON + 5 * MINUTE, HERE);
    await companion.check(AFTERNOON + 50 * MINUTE, HERE);
    expect(texts()).toEqual(["饭吃得怎么样？"]);
  });
});

describe("waiting for a pause", () => {
  it("does not speak while the user's hands are busy, and does once they stop for a moment", async () => {
    const { companion, texts, write } = setup();
    for (let second = 0; second < 120; second += 10) await companion.check(MORNING + second * 1000, 0);
    expect(texts()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    await companion.check(MORNING + 120_000, 3);
    expect(texts()).toEqual(["早呀，今天也加油！"]);
  });

  it("holds the word ahead of a reminder the same way", async () => {
    const { companion, texts } = setup({ reminders: () => [reminder()] }, NO_MORNING);
    await companion.check(AFTERNOON + 20 * MINUTE, 0);
    expect(texts()).toEqual([]);
    await companion.check(AFTERNOON + 21 * MINUTE, HERE);
    expect(texts()).toEqual(["还有 9 分钟：开会"]);
  });

  it("greets a return at once: that moment does not come again", async () => {
    const { companion, texts } = setup({}, NO_MORNING);
    await companion.check(AFTERNOON, 1800);
    await companion.check(AFTERNOON + MINUTE, 0);
    expect(texts()).toEqual(["回来啦，欢迎回来～"]);
  });
});

describe("care in the model's words", () => {
  const DAY: GreetingFacts = { ...FACTS, focusToday: 3, doneToday: 2, nextReminder: { text: "开会", at: AFTERNOON + 3 * 60 * MINUTE } };

  it("tells the model how long the user has been at it and what the day held", async () => {
    const write = vi.fn(async () => "都坐一个半小时啦，起来转转？");
    const { companion, texts } = setup({ write, day: async () => DAY }, WRITTEN);
    await use(companion, AFTERNOON, AFTERNOON + 90 * MINUTE);
    expect(texts()).toEqual(["都坐一个半小时啦，起来转转？"]);
    expect(write).toHaveBeenCalledWith(
      "提醒用户起来活动一下、歇歇眼睛，像朋友随口一说，不要说教",
      ["用户已经连续用了 90 分钟电脑", "今天专注了 3 轮", "今天完成了 2 个提醒", "下一个提醒：17:00 开会", "你今天心情很好，因为用户今天做成了不少事"],
      AFTERNOON + 90 * MINUTE,
    );
  });

  it("leaves out what did not happen today", async () => {
    const { companion, write } = setup({}, WRITTEN);
    await use(companion, AFTERNOON, AFTERNOON + 90 * MINUTE);
    expect(write).toHaveBeenCalledWith(expect.any(String), ["用户已经连续用了 90 分钟电脑"], expect.any(Number));
  });

  it("tells it the hour is late, and how long the user was away", async () => {
    const night = new Date(2026, 10, 17, 23, 30).getTime();
    const late = setup({}, WRITTEN);
    await use(late.companion, night, night + 15 * MINUTE);
    expect(late.write).toHaveBeenCalledWith("劝用户早点休息，像朋友随口一说，不要说教", ["已经是深夜，用户还在用电脑", "你有点困了，因为用户熬夜，你一直陪着"], night + 15 * MINUTE);

    const back = setup({}, WRITTEN);
    await back.companion.check(AFTERNOON, HERE);
    await back.companion.check(AFTERNOON + 50 * MINUTE, 50 * 60);
    await back.companion.check(AFTERNOON + 51 * MINUTE, HERE);
    expect(back.write).toHaveBeenCalledWith("欢迎用户回到电脑前", ["用户离开了大约 50 分钟，刚回到电脑前"], AFTERNOON + 51 * MINUTE);
  });

  it("says the fixed line when the model cannot answer", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { companion, texts } = setup({ write: async () => { throw new Error("offline"); } }, WRITTEN);
    await use(companion, AFTERNOON, AFTERNOON + 90 * MINUTE);
    expect(texts()).toEqual(["我想伸个懒腰，你也休息一下吧。"]);
    warning.mockRestore();
  });

  it("asks nothing of the model when the user turned that off, also on return from a reminder", async () => {
    const lunch = reminder({ text: "出去吃饭", remindAt: AFTERNOON, remindedAt: AFTERNOON + MINUTE });
    const { companion, texts, write } = setup({ reminders: () => [lunch] }, NO_MORNING);
    await companion.check(AFTERNOON + 5 * MINUTE, HERE);
    await companion.check(AFTERNOON + 50 * MINUTE, 45 * 60);
    await companion.check(AFTERNOON + 51 * MINUTE, HERE);
    expect(texts()).toEqual(["回来啦～「出去吃饭」弄好了吗？"]);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("manners", () => {
  it("keeps to itself after the user asked for quiet, but still says a word ahead of a reminder", async () => {
    const storage = createMemoryStorage();
    setHush(AFTERNOON + 24 * 60 * MINUTE, storage);
    const { companion, texts } = setup({ storage, reminders: () => [reminder({ remindAt: AFTERNOON + 100 * MINUTE })] }, NO_MORNING);
    await use(companion, AFTERNOON, AFTERNOON + 95 * MINUTE);
    expect(texts()).toEqual(["还有 10 分钟：开会"]);
  });

  it("takes a pat or a word soon after its line as an answer", async () => {
    const { companion, ports } = setup({}, NO_MORNING);
    expect(companion.heard(AFTERNOON)).toBe(false);
    await use(companion, AFTERNOON, AFTERNOON + 90 * MINUTE);
    expect(companion.heard(AFTERNOON + 91 * MINUTE)).toBe(true);
    expect(companion.heard(AFTERNOON + 92 * MINUTE)).toBe(false);
    expect(loadHistory(ports.storage)[0].answered).toBe(true);
  });

  it("reminds the user to rest less often once that went unanswered three times", async () => {
    const { companion, said } = setup({}, NO_MORNING);
    await use(companion, AFTERNOON, AFTERNOON + 270 * MINUTE);
    expect(said).toHaveLength(3);
    // The fourth would come 90 minutes after the third; eased, it waits for two hours.
    await use(companion, AFTERNOON + 271 * MINUTE, AFTERNOON + 389 * MINUTE);
    expect(said).toHaveLength(3);
    await companion.check(AFTERNOON + 390 * MINUTE, HERE);
    expect(said).toHaveLength(4);
  });
});

describe("mood", () => {
  it("comes from what the day held", async () => {
    const busy = setup({ day: async () => ({ ...FACTS, focusToday: 2, doneToday: 2 }) }, NO_MORNING);
    expect(await busy.companion.mood(AFTERNOON)).toBe("bright");
    expect(await setup({}, NO_MORNING).companion.mood(AFTERNOON)).toBe("calm");
  });

  it("is tired while the user is at the computer late at night, and the morning after the pet said so", async () => {
    const night = new Date(2026, 10, 17, 23, 40).getTime();
    const { companion } = setup({ day: async () => ({ ...FACTS, focusToday: 4 }) }, NO_MORNING);
    await companion.check(night, HERE);
    expect(await companion.mood(night)).toBe("tired");
    await use(companion, night, night + 20 * MINUTE);
    expect(await companion.mood(night + 9 * 60 * MINUTE)).toBe("tired");
    expect(await companion.mood(night + 14 * 60 * MINUTE)).toBe("bright");
  });
});

describe("trying an occasion", () => {
  it("shows the new lines with an example when there is nothing real to say them about", async () => {
    const write = vi.fn(async () => { throw new Error("offline"); });
    const { companion, shown } = setup({ write }, WRITTEN);
    expect(await companion.test("heads_up", MORNING)).toBe(true);
    expect(await companion.test("follow_up", MORNING)).toBe(true);
    expect(shown).toEqual(["还有 10 分钟：开会", "回来啦～「出去吃饭」还顺利吗？"]);
  });

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
