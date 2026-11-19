/** The pages of the settings window. */
export const SECTIONS = ["character", "general", "companion", "dock", "actions", "chat", "ai", "memory", "voice", "tools", "privacy", "guide", "about", "diagnostics", "developer"] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const isSection = (value: string | null): value is SettingsSection => SECTIONS.some((section) => section === value);

const LABELS: Record<SettingsSection, string> = {
  character: "角色", actions: "动作库", dock: "快捷按钮",
  chat: "聊天", ai: "AI 对话", memory: "记忆", voice: "语音", companion: "陪伴与勿扰", tools: "小工具",
  general: "通用", privacy: "隐私与数据", guide: "功能一览", about: "关于",
  diagnostics: "日志与诊断", developer: "开发者",
};
const group = (...ids: SettingsSection[]) => ids.map((id) => ({ id, label: LABELS[id] }));

/** Sidebar entries in order, grouped by the user's task rather than implementation detail. */
export const NAV_GROUPS = [
  { title: "角色与外观", items: group("character", "actions", "dock") },
  { title: "聊天与 AI", items: group("chat", "ai", "memory", "voice") },
  { title: "陪伴与工具", items: group("companion", "tools") },
  { title: "应用", items: group("general", "privacy", "guide", "about") },
] as const;
/** Shown at the bottom of the sidebar only while developer mode is on. */
export const DEVELOPER_GROUP = { title: "", items: group("developer") } as const;
/** Pages opened from inside another page; the sidebar keeps that page lit and the title offers a way back. */
export const SUB_PAGES: Partial<Record<SettingsSection, SettingsSection>> = { diagnostics: "about" };
export const sectionLabel = (section: SettingsSection): string => LABELS[section];
