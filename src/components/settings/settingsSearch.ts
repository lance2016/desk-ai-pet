import type { SettingsSection } from "./sections";

/** Something the settings search can find: the page it is on and the title shown there. */
export interface SearchEntry {
  section: SettingsSection;
  /** Exactly the text shown on the page, so the result can scroll to it. */
  title: string;
  /** Other words people may type for it. */
  keywords?: string;
}

/**
 * The settings people look for, by the title each row or group shows. A test checks that every
 * title here appears in the settings components, and that every row title there is listed here
 * or in SEARCH_SKIPPED; a new setting needs a line in one of them.
 */
export const SETTINGS_INDEX: readonly SearchEntry[] = [
  { section: "character", title: "我的角色", keywords: "切换角色 换角色" },
  { section: "character", title: "新建角色", keywords: "自己的角色 创建" },
  { section: "character", title: "当前角色", keywords: "名字 改名" },
  { section: "character", title: "性格", keywords: "人设 说话风格" },
  { section: "character", title: "形象", keywords: "头像 小人 聊天窗口" },
  { section: "character", title: "关于你", keywords: "称呼 昵称 怎么叫我" },
  { section: "character", title: "导入角色包", keywords: "导入" },
  { section: "character", title: "导出当前角色", keywords: "导出 分享" },
  { section: "dock", title: "按钮", keywords: "快捷按钮 排序 图标 隐藏 添加动作" },
  { section: "ai", title: "DeepSeek", keywords: "API Key 密钥 连接 测试" },
  { section: "ai", title: "回复用的模型", keywords: "模型 flash pro 自定义" },
  { section: "ai", title: "回复长度", keywords: "长短 简短 详细" },
  { section: "ai", title: "快速聊天", keywords: "快捷键 输入框 Space" },
  { section: "ai", title: "聊天记录", keywords: "历史" },
  { section: "ai", title: "自动生成聊天标题", keywords: "标题" },
  { section: "ai", title: "对话规则", keywords: "提示词 系统提示词 规则 修改提示词 补充要求 发送什么 能力" },
  { section: "ai", title: "开发者模式", keywords: "调试 请求记录 原始回复 实际发送 提示词 debug" },
  { section: "voice", title: "小米 MiMo", keywords: "语音 API Key 麦克风" },
  { section: "voice", title: "语音识别语言", keywords: "中文 英文 自动 识别" },
  { section: "companion", title: "深夜关心", keywords: "熬夜 早点睡" },
  { section: "companion", title: "关心时间", keywords: "深夜 几点" },
  { section: "companion", title: "定时勿扰时照样深夜关心" },
  { section: "companion", title: "休息一下", keywords: "久坐 起来活动 休息提醒" },
  { section: "companion", title: "使用多久后提醒", keywords: "久坐 分钟" },
  { section: "companion", title: "回来打招呼", keywords: "欢迎回来 离开" },
  { section: "companion", title: "手动勿扰", keywords: "免打扰 安静" },
  { section: "companion", title: "定时勿扰", keywords: "免打扰 睡觉 夜间 早安 晚安" },
  { section: "tools", title: "划词翻译", keywords: "翻译 选中文字 快捷键" },
  { section: "tools", title: "划词浮钮", keywords: "解释 总结 润色 选中文字" },
  { section: "tools", title: "翻译窗口", keywords: "粘贴 翻译" },
  { section: "tools", title: "工作日", keywords: "提醒 节假日 调休 法定假日" },
  { section: "tools", title: "查收验证码", keywords: "邮箱 邮件 验证码" },
  { section: "tools", title: "163 邮箱", keywords: "授权码 IMAP 邮箱" },
  { section: "tools", title: "认不出验证码？", keywords: "规则 测试" },
  { section: "general", title: "开机时打开", keywords: "开机启动 登录项" },
  { section: "general", title: "总在最前面", keywords: "置顶 全屏" },
  { section: "general", title: "宠物大小", keywords: "缩放 变大 变小" },
  { section: "general", title: "快捷按钮停留", keywords: "收起 速度" },
  { section: "privacy", title: "导出数据", keywords: "备份 导出" },
  { section: "privacy", title: "从备份恢复", keywords: "导入 恢复 换电脑" },
  { section: "privacy", title: "存在这台电脑上", keywords: "本机 数据 隐私" },
  { section: "privacy", title: "什么时候会连网", keywords: "隐私 联网 发送 DeepSeek" },
  { section: "about", title: "软件更新", keywords: "检查更新 新版本 升级 版本号" },
];

/**
 * Titles in the settings components that search leaves out: a step in the welcome guide,
 * a result inside a tool, a group already found through its rows.
 */
export const SEARCH_SKIPPED: readonly string[] = [
  "右键我", "点我一下", "AI Pet", "帧顺序", "先画待机图", "再补其他动作", "没有找到动作", "添加动作图片",
  "创建提醒", "保存备忘", "查提醒和备忘、写日报", "做动作", "回复方式", "连接与模型", "发给 AI 的设定", "拼好的完整提示词", "最近发出的请求",
  "AI 可以使用的能力", "不像验证码邮件", "是验证码邮件，但没认出码", "识别", "语音输入", "关心", "勿扰", "启动", "窗口",
  "提醒", "备份", "导入与导出", "快捷键", "辅助功能权限",
];

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/**
 * The entries matching every word of `query`, best first: the title itself, then a title that
 * starts with it, contains it, and last a match in the keywords only. Among equals the shorter
 * title is the closer match.
 */
export function searchSettings<T extends SearchEntry>(entries: readonly T[], query: string, limit = 30): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const whole = normalize(query);
  const rank = (entry: T): number => {
    const title = normalize(entry.title);
    if (title === whole) return 0;
    if (title.startsWith(whole)) return 1;
    if (title.includes(whole)) return 2;
    return 3;
  };
  return entries
    .filter((entry) => { const text = normalize(`${entry.title} ${entry.keywords ?? ""}`); return words.every((word) => text.includes(word)); })
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.entry.title.length - b.entry.title.length || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
