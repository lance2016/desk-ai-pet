import { describe, expect, it } from "vitest";
import { CHAT_CASES } from "./chatCases";
import { describeRun, runChat } from "./runChat";

/** `EVAL_RUNS=3 pnpm eval` asks each sentence three times; every run has to be right, except in a soft case. */
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS) || 1);

describe("what the pet does with a sentence", () => {
  for (const chatCase of CHAT_CASES) {
    it(`${chatCase.soft ? "(soft) " : ""}${chatCase.name}: ${chatCase.say}`, async () => {
      const failures: string[] = [];
      for (let attempt = 1; attempt <= RUNS; attempt += 1) {
        const run = await runChat(chatCase.setup ?? {}, chatCase.say);
        const problems = chatCase.check(run);
        if (problems.length > 0) failures.push(`run ${attempt}/${RUNS}: ${problems.join("; ")}\n    ${describeRun(run)}`);
      }
      const tally = `${RUNS - failures.length}/${RUNS} runs right`;
      if (!chatCase.soft) expect(failures, tally).toEqual([]);
      else if (failures.length > 0) console.warn(`(soft) ${chatCase.name}: ${tally}\n  ${failures.join("\n  ")}`);
    });
  }
});
