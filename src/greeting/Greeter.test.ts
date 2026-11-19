import { describe, expect, it, vi } from "vitest";
import { DEFAULT_QUIET_PREFERENCES, type QuietPreferences } from "../preferences/QuietPreferences";
import { Greeter, type GreeterDeps } from "./Greeter";
import type { GreetingFacts } from "./GreetingContent";
import type { GreetingRecord } from "./GreetingSchedule";

const MORNING = new Date(2026, 10, 16, 9, 0).getTime();
const FACTS: GreetingFacts = { openCount: 0, doneToday: 0, nextReminder: null, latestReminder: null, focusToday: 0, lastDay: null, leftovers: [] };

function setup(overrides: Partial<GreeterDeps> = {}, quiet: QuietPreferences = DEFAULT_QUIET_PREFERENCES) {
  let record: GreetingRecord = { morning: null, evening: null };
  const greeted: string[] = [];
  const offered: boolean[] = [];
  const compose = vi.fn(async () => "早呀，今天也加油！");
  const greeter = new Greeter({
    loadQuiet: () => quiet,
    loadRecord: () => record,
    saveRecord: (next) => { record = next; },
    facts: async () => FACTS,
    compose,
    greet: (text, offerMove) => { greeted.push(text); offered.push(offerMove); return true; },
    ...overrides,
  });
  return { greeter, greeted, offered, compose, record: () => record };
}

describe("Greeter", () => {
  it("greets once with the model's words and remembers the day", async () => {
    const { greeter, greeted, compose, record } = setup();
    await greeter.check(MORNING);
    await greeter.check(MORNING + 60_000);
    expect(greeted).toEqual(["早呀，今天也加油！"]);
    expect(compose).toHaveBeenCalledWith("morning", ["今天要处理的提醒 0 个"], MORNING);
    expect(record().morning).toBe("2026-11-16");
  });

  it("offers to move earlier reminders only in the morning", async () => {
    const facts = async () => ({ ...FACTS, leftovers: [{ text: "交周报", at: MORNING - 86_400_000 }] });
    const morning = setup({ facts });
    await morning.greeter.check(MORNING);
    expect(morning.offered).toEqual([true]);
    const evening = setup({ facts });
    await evening.greeter.check(new Date(2026, 10, 16, 22, 40).getTime());
    expect(evening.offered).toEqual([false]);
  });

  it("falls back to the template when the model fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { greeter, greeted } = setup({ compose: async () => { throw new Error("offline"); } });
    await greeter.check(MORNING);
    expect(greeted).toEqual(["早上好！今天也一起加油吧～"]);
    warning.mockRestore();
  });

  it("tries again later when the pet may not speak up yet", async () => {
    let allowed = false;
    const { greeter, greeted, record } = setup({ greet: (text) => { if (allowed) greeted.push(text); return allowed; } });
    await greeter.check(MORNING);
    expect(record().morning).toBeNull();
    allowed = true;
    await greeter.check(MORNING + 60_000);
    expect(greeted).toHaveLength(1);
    expect(record().morning).toBe("2026-11-16");
  });

  it("waits while do-not-disturb is on", async () => {
    const { greeter, greeted, record } = setup({}, { ...DEFAULT_QUIET_PREFERENCES, doNotDisturb: true });
    await greeter.check(MORNING);
    expect(greeted).toEqual([]);
    expect(record().morning).toBeNull();
  });

  it("does not ask twice while a greeting is being written", async () => {
    let finish!: (text: string) => void;
    const compose = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { greeter, greeted } = setup({ compose });
    const first = greeter.check(MORNING);
    await greeter.check(MORNING);
    finish("早！");
    await first;
    expect(compose).toHaveBeenCalledTimes(1);
    expect(greeted).toEqual(["早！"]);
  });
});
