import type { IconName } from "../ui/icons";
import { usageKind } from "./usage";

/** A line on the usage page and the work log kinds it adds up. `byPet`: started by the pet or an agent, not the user. */
export interface UsageRow { id: string; label: string; icon: IconName; kinds: readonly string[]; byPet?: boolean }
export interface UsageGroup { title: string; rows: readonly UsageRow[] }

const use = (id: Parameters<typeof usageKind>[0], label: string, icon: IconName): UsageRow => ({ id, label, icon, kinds: [usageKind(id)] });

/** The user's features by what they are for, in the order shown. */
export const USAGE_GROUPS: readonly UsageGroup[] = [
  { title: "聊天", rows: [
    use("quick_chat", "快速聊天发消息", "chat"),
    use("chat_send", "聊天窗口发消息", "send"),
    use("greeting_reply", "回宠物主动说的话", "quote"),
    use("handed", "处理递给它的内容", "clipboard"),
    use("voice_input", "语音输入", "mic"),
    use("read_aloud", "朗读回复", "speaker"),
  ] },
  { title: "和宠物", rows: [
    use("petted", "摸摸头", "hand"),
    use("quick_action", "快捷按钮做动作", "paw"),
    { id: "focus", label: "专注", icon: "timer", kinds: ["focus_completed", "focus_stopped"] },
  ] },
  { title: "面板", rows: [
    use("panel_today", "打开提醒", "bell"),
    use("panel_notes", "打开备忘", "note"),
    use("panel_links", "打开常用链接", "link"),
    use("panel_coding", "打开 Claude Code", "code"),
    use("panel_translation", "打开翻译窗口", "text"),
  ] },
  { title: "小工具", rows: [
    use("link_open", "从常用链接打开网址", "open"),
    use("coding_reveal", "回到终端", "terminal"),
    use("mail_code", "查收验证码", "mail"),
    use("dubbing", "打开配音", "waveform"),
  ] },
  { title: "记下的事", rows: [
    { id: "reminder_added", label: "新建提醒", icon: "calendar_check", kinds: ["reminder_added"] },
    { id: "reminder_done", label: "完成提醒", icon: "check", kinds: ["reminder_done"] },
    { id: "note_added", label: "新建备忘", icon: "document", kinds: ["note_added"] },
    { id: "fact_added", label: "记住关于你的事", icon: "bookmark", kinds: ["fact_added"] },
  ] },
];

/** What the pet and Claude Code did by themselves: told in a footnote, never part of the charts. */
export const PET_ROWS: readonly UsageRow[] = [
  { ...use("greeting", "宠物主动搭话", "sparkle"), byPet: true },
  { id: "agent_turn", label: "Claude Code 做完一轮", icon: "terminal", kinds: ["agent_turn_done"], byPet: true },
];

export const USAGE_ROWS: readonly UsageRow[] = [...USAGE_GROUPS.flatMap((group) => group.rows), ...PET_ROWS];
