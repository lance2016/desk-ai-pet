import type { Skill, Tool } from "../ai/skill";
import { loadSavedItems, todayLines } from "../agenda/chatTools";
import { readWorkLog } from "../worklog/store";
import { EMPTY_WORK_LOG } from "../worklog/WorkLog";
import { AS_DATA, clipShown, SHOWN, SYNTHESIZE } from "./items";

export const REVIEW_TODAY_TOOL = "review_today";

const ASK_FOR_MORE = "今天还做了什么？告诉我，我可以补进日报。";

/** The daily report: what was done, what is still open, focus rounds and the day's notes. */
export function todayReport(today: readonly string[]): string {
  if (today.length === 0) return "今天还没有记录。还做了什么？告诉我，我可以补进日报。";
  const report = today.map((line) => (line.startsWith("还没处理的提醒：") ? `- 待跟进：${line.slice("还没处理的提醒：".length)}` : `- ${line}`)).join("\n");
  return today.length <= 1 ? `${report}\n\n${ASK_FOR_MORE}` : report;
}

const reviewToday: Tool = {
  name: REVIEW_TODAY_TOOL,
  label: "写今日回顾",
  description: "查看用户今天的记录：今天完成了哪些提醒、今天还有哪些提醒没处理、专注了几轮、今天记了哪些备忘。用户要写日报、回顾今天做了什么时使用。",
  parameters: () => ({ type: "object", properties: { synthesize: SYNTHESIZE } }),
  async run(args) {
    const now = Date.now();
    const log = await readWorkLog(now, now).catch((error: unknown) => {
      console.warn("Reviewing today without the work log", error);
      return EMPTY_WORK_LOG;
    });
    const report = todayReport(todayLines(loadSavedItems(), log, now));
    return args.synthesize === true ? { result: `${report}\n${AS_DATA}`, needsModel: true } : { result: SHOWN, shown: clipShown(report) };
  },
};

/** The daily report, from today's reminders, focus rounds and notes. */
export const reviewSkill: Skill = {
  id: "review",
  title: "今日回顾",
  summary: "你说「帮我写日报」时，按今天的提醒、专注和备忘来写",
  rules: () => `要求写日报或回顾今天时调用 ${REVIEW_TODAY_TOOL}。只要基础日报时由应用展示结果，无需先说“我查一下”；要筛选、归纳时设 synthesize=true，归纳只用实际记录和用户说过的事实，日报以“- ”分条，未完成的提醒可列为待跟进，资料不足时请用户补充。`,
  tools: [reviewToday],
};
