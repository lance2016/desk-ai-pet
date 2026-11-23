/** The pages of the settings window. */
export const SECTIONS = ["character", "characterProfile", "general", "companion", "dock", "actions", "chat", "skills", "ai", "voices", "memory", "tools", "links", "privacy", "guide", "about", "diagnostics", "prompt", "toolDefs", "developer"] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const isSection = (value: string | null): value is SettingsSection => SECTIONS.some((section) => section === value);

const LABELS: Record<SettingsSection, string> = {
  character: "角色", characterProfile: "角色设定", actions: "动作库", dock: "快捷按钮",
  chat: "聊天", skills: "能力", ai: "AI 服务", voices: "克隆的声音", memory: "记忆", companion: "陪伴", tools: "小工具", links: "常用链接",
  general: "通用", privacy: "隐私与数据", guide: "功能一览", about: "关于",
  diagnostics: "日志与诊断", prompt: "提示词", toolDefs: "工具定义", developer: "请求记录",
};
const group = (...ids: SettingsSection[]) => ids.map((id) => ({ id, label: LABELS[id] }));

/** The current character's page: the avatar row at the top of the sidebar, like the account row in System Settings. */
export const ACCOUNT_SECTION: SettingsSection = "character";
/** Sidebar entries below the avatar row, in order, grouped by the user's task rather than implementation detail. */
export const NAV_GROUPS = [
  { title: "角色与外观", items: group("actions", "dock") },
  { title: "聊天", items: group("chat", "skills", "memory", "ai") },
  { title: "陪伴与工具", items: group("companion", "tools") },
  { title: "应用", items: group("general", "privacy", "guide", "about") },
] as const;
/** Shown at the bottom of the sidebar only while developer mode is on. */
export const DEVELOPER_GROUP = { title: "开发者", items: group("prompt", "toolDefs", "developer") } as const;
/** Pages opened from another page; the direct parent is shown above the title and the top-level ancestor stays selected. */
export const SUB_PAGES: Partial<Record<SettingsSection, SettingsSection>> = { characterProfile: "character", diagnostics: "about", voices: "ai", links: "tools" };
export const sectionLabel = (section: SettingsSection): string => LABELS[section];
