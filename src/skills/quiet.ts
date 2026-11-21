import { formatReminderTime } from "../agenda/AgendaStore";
import { failed, type Skill, type Tool } from "../ai/skill";
import { hushedUntil, nextMorning, setHush } from "../companion/hush";
import { loadCompanionPreferences } from "../preferences/CompanionPreferences";

export const STAY_QUIET_TOOL = "stay_quiet";

const stayQuiet: Tool = {
  name: STAY_QUIET_TOOL,
  description: "用户要你别再主动说话、别催、别吵（如「今晚别催我」「今天先别说话」），或者要你恢复（「可以说话了」）时调用。只管你自己主动开口的问候和关心，用户设的提醒照常到点。结果由应用确认。",
  parameters: () => ({ type: "object", properties: { quiet: { type: "boolean", description: "true：到明天早上之前不主动说话；false：恢复主动说话" } }, required: ["quiet"] }),
  run(args) {
    if (typeof args.quiet !== "boolean") return failed("没看懂是要安静还是恢复说话");
    const now = Date.now();
    const before = hushedUntil(now);
    const undo = () => setHush(before);
    if (!args.quiet) {
      if (before === null) return { result: "现在本来就可以主动说话", confirmation: "我本来就没憋着呀" };
      setHush(null);
      return { result: "已恢复主动说话", lines: [{ kind: "quiet", text: "已恢复主动说话", undo }], confirmation: "好，那我想到什么就说啦" };
    }
    const until = nextMorning(now, loadCompanionPreferences().morningTime);
    setHush(until);
    const label = formatReminderTime(until, now);
    return {
      result: `已安静：${label} 前不主动说话，提醒照常到点`,
      lines: [{ kind: "quiet", text: `已安静：${label} 前不主动说话`, undo }],
      confirmation: `好，${label} 之前我不主动说话，提醒照常叫你`,
    };
  },
};

/** Asking the pet to keep to itself for the rest of the day, and to speak up again. */
export const quietSkill: Skill = {
  id: "quiet",
  title: "安静一会儿",
  rules: () => `用户明确要你别再主动说话、别催、别吵时，调用 ${STAY_QUIET_TOOL}，quiet=true；要你恢复时 quiet=false。这只管你自己主动说的问候和关心，用户设的提醒照常到点，回复里别说成连提醒都不叫了。用户只是说累、说忙、心情不好，不算要你安静，照常回应。`,
  tools: [stayQuiet],
};
