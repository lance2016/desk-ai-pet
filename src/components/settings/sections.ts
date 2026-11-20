/** The pages of the settings window. */
export const SECTIONS = ["character", "characterProfile", "general", "companion", "dock", "actions", "chat", "ai", "memory", "voice", "tools", "privacy", "guide", "about", "diagnostics", "developer"] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const isSection = (value: string | null): value is SettingsSection => SECTIONS.some((section) => section === value);

const LABELS: Record<SettingsSection, string> = {
  character: "角色", characterProfile: "角色设定", actions: "动作库", dock: "快捷按钮",
  chat: "聊天", ai: "AI 对话", memory: "记忆", voice: "语音", companion: "陪伴与勿扰", tools: "划词与邮箱",
  general: "通用", privacy: "隐私与数据", guide: "功能一览", about: "关于",
  diagnostics: "日志与诊断", developer: "请求记录",
};
const group = (...ids: SettingsSection[]) => ids.map((id) => ({ id, label: LABELS[id] }));

/** The current character's page: the avatar row at the top of the sidebar, like the account row in System Settings. */
export const ACCOUNT_SECTION: SettingsSection = "character";
/** Sidebar entries below the avatar row, in order, grouped by the user's task rather than implementation detail. */
export const NAV_GROUPS = [
  { title: "角色与外观", items: group("actions", "dock") },
  { title: "聊天与 AI", items: group("chat", "ai", "memory", "voice") },
  { title: "陪伴与工具", items: group("companion", "tools") },
  { title: "应用", items: group("general", "privacy", "guide") },
] as const;
/** Shown at the bottom of the sidebar only while developer mode is on. */
export const DEVELOPER_GROUP = { title: "开发者", items: group("developer") } as const;
/** Pages opened from another page; the direct parent is shown above the title and the top-level ancestor stays selected. */
export const SUB_PAGES: Partial<Record<SettingsSection, SettingsSection>> = { characterProfile: "character", about: "general", diagnostics: "about" };
export const sectionLabel = (section: SettingsSection): string => LABELS[section];
