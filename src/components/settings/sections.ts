/** The pages of the settings window. */
export const SECTIONS = ["character", "general", "companion", "dock", "actions", "ai", "voice", "tools", "privacy", "guide", "about"] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const isSection = (value: string | null): value is SettingsSection => SECTIONS.some((section) => section === value);

/** Sidebar entries in order, in groups: the character, what the pet does, the app. Each gets its own tile colour, as in System Settings. */
export const NAV_GROUPS: readonly (readonly { id: SettingsSection; label: string }[])[] = [
  [{ id: "character", label: "角色" }, { id: "actions", label: "动作库" }, { id: "dock", label: "快捷按钮" }],
  [{ id: "ai", label: "AI 对话" }, { id: "voice", label: "语音" }, { id: "companion", label: "陪伴与勿扰" }, { id: "tools", label: "小工具" }],
  [{ id: "general", label: "通用" }, { id: "privacy", label: "隐私与数据" }, { id: "guide", label: "功能一览" }, { id: "about", label: "关于" }],
];
export const NAV = NAV_GROUPS.flat();
export const sectionLabel = (section: SettingsSection): string => NAV.find((item) => item.id === section)?.label ?? "";
