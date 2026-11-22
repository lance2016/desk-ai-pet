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
  { section: "character", title: "全部角色", keywords: "切换角色 换角色 我的角色" },
  { section: "character", title: "新建角色", keywords: "自己的角色 创建" },
  { section: "character", title: "导入角色包", keywords: "导入" },
  { section: "character", title: "导出当前角色", keywords: "导出 分享" },
  { section: "characterProfile", title: "当前角色", keywords: "名字 改名" },
  { section: "characterProfile", title: "性格", keywords: "人设 说话风格" },
  { section: "characterProfile", title: "形象", keywords: "头像 小人 聊天窗口" },
  { section: "characterProfile", title: "回复长度", keywords: "长短 简短 详细" },
  { section: "characterProfile", title: "补充要求", keywords: "角色要求 说话方式 个性 回复风格" },
  { section: "characterProfile", title: "角色管理", keywords: "删除 移除 角色管理" },
  { section: "characterProfile", title: "删除这个角色", keywords: "移除 角色管理" },
  { section: "memory", title: "关于你", keywords: "称呼 昵称 怎么叫我" },
  { section: "dock", title: "按钮", keywords: "快捷按钮 排序 图标 隐藏 添加动作" },
  { section: "ai", title: "DeepSeek", keywords: "API Key 密钥 连接 测试" },
  { section: "ai", title: "回复用的模型", keywords: "模型 flash pro 自定义" },
  { section: "chat", title: "自动阅读网页链接", keywords: "网址 网页 链接 浏览器" },
  { section: "memory", title: "已记住的事", keywords: "记忆 记住 忘掉 关于我 偏好 习惯 长期记忆 memory" },
  { section: "memory", title: "聊天时自动记住", keywords: "记忆 自动记 记住我" },
  { section: "chat", title: "快速聊天", keywords: "快捷键 输入框 Space" },
  { section: "chat", title: "聊天按钮", keywords: "聊天入口 气泡 图标 常驻 点宠物" },
  { section: "chat", title: "复制后提示", keywords: "剪贴板 复制 粘贴 翻译 递给它" },
  { section: "chat", title: "聊天时", keywords: "聊天记录 标题 网页 语音" },
  { section: "chat", title: "自动生成聊天标题", keywords: "标题" },
  { section: "chat", title: "通用对话规则", keywords: "对话规则 提示词 系统提示词 规则 修改提示词 通用规则 发送什么 能力" },
  { section: "chat", title: "规则与能力", keywords: "提示词 工具 定义 修改能力 AI" },
  { section: "general", title: "开发者模式", keywords: "调试 请求记录 原始回复 实际发送 提示词 debug" },
  { section: "ai", title: "小米 MiMo", keywords: "语音 语音输入 API Key 麦克风" },
  { section: "ai", title: "朗读声音", keywords: "朗读 读出来 喇叭 音色 配音 TTS" },
  { section: "ai", title: "声音", keywords: "音色 朗读 男声 女声 换声音 试听 克隆" },
  { section: "ai", title: "语气", keywords: "朗读 语速 情绪 风格 音色描述" },
  { section: "voices", title: "添加声音", keywords: "克隆 复刻 音色 录音 自己的声音 上传 wav mp3" },
  { section: "chat", title: "语音识别语言", keywords: "中文 英文 自动 识别" },
  { section: "companion", title: "深夜关心", keywords: "熬夜 早点睡 关心时间 几点" },
  { section: "companion", title: "定时勿扰时照样深夜关心" },
  { section: "companion", title: "休息一下", keywords: "久坐 起来活动 休息提醒 多久 分钟" },
  { section: "companion", title: "提醒前说一声", keywords: "提前 预告 事前 快到了 十分钟 提醒" },
  { section: "companion", title: "回来问一句", keywords: "事后 回访 问一下 离开 回来 提醒" },
  { section: "companion", title: "回来打招呼", keywords: "欢迎回来 离开" },
  { section: "companion", title: "正在安静", keywords: "别催 别吵 安静 恢复说话 不说话" },
  { section: "companion", title: "关心的话由 AI 来写", keywords: "模型 DeepSeek 固定 语气 关心 费用 隐私" },
  { section: "companion", title: "早安问候", keywords: "早上好 每天问候 早安时间" },
  { section: "companion", title: "每天说早安", keywords: "早安 开启 关闭 问候 早安时间 时钟 定时" },
  { section: "companion", title: "预览一句", keywords: "预览 立即验证 试一下 测试 早安 晚安 问候预览" },
  { section: "companion", title: "手动勿扰", keywords: "免打扰 安静" },
  { section: "companion", title: "定时勿扰", keywords: "免打扰 睡觉 夜间 早安 晚安" },
  { section: "general", title: "工作日", keywords: "提醒 节假日 调休 法定假日" },
  { section: "tools", title: "划词翻译", keywords: "翻译 选中文字 快捷键" },
  { section: "tools", title: "划词浮钮", keywords: "解释 总结 润色 选中文字" },
  { section: "tools", title: "翻译窗口", keywords: "粘贴 翻译" },
  { section: "tools", title: "编码助手", keywords: "Agent 编程 代码 状态 钩子 hooks" },
  { section: "tools", title: "Claude Code", keywords: "Agent 编程 代码 状态 等你确认 做完了 钩子 hooks 连接 断开 会话" },
  { section: "tools", title: "宠物跟着反应", keywords: "Claude Code 编码助手 动作 气泡 通知 关闭 安静 会话" },
  { section: "tools", title: "查收验证码", keywords: "邮箱 邮件 验证码" },
  { section: "tools", title: "163 邮箱", keywords: "授权码 IMAP 邮箱 添加 多个" },
  { section: "tools", title: "认不出验证码？", keywords: "规则 测试" },
  { section: "general", title: "开机时打开", keywords: "开机启动 登录项" },
  { section: "general", title: "总在最前面", keywords: "置顶 全屏" },
  { section: "general", title: "宠物大小", keywords: "缩放 变大 变小" },
  { section: "general", title: "快捷按钮停留", keywords: "收起 速度 显示时间 悬停 变淡" },
  { section: "privacy", title: "导出数据", keywords: "备份 导出 工作日志" },
  { section: "privacy", title: "从备份恢复", keywords: "导入 恢复 换电脑" },
  { section: "privacy", title: "存在这台电脑上", keywords: "本机 数据 隐私" },
  { section: "privacy", title: "什么时候会连网", keywords: "隐私 联网 发送 DeepSeek" },
  { section: "about", title: "AI Pet", keywords: "关于 版本号 新功能" },
  { section: "about", title: "软件更新", keywords: "检查更新 新版本 升级 版本号" },
  { section: "about", title: "日志与诊断", keywords: "日志 诊断 报错 出错 排查" },
  { section: "diagnostics", title: "日志", keywords: "诊断 报错 出错 排查 搜索日志" },
  { section: "diagnostics", title: "日志文件", keywords: "清理日志 在访达中显示 删除日志" },
  { section: "diagnostics", title: "导出诊断信息", keywords: "诊断 日志 反馈 报错" },
];

/**
 * Titles in the settings components that search leaves out: a step in the welcome guide,
 * a result inside a tool, a group already found through its rows.
 */
export const SEARCH_SKIPPED: readonly string[] = [
  // Ways into a page or a form that search already finds by the page or form's own name.
  "角色设定", "新建角色…",
  "右键我", "点我一下", "帧顺序", "先画待机图", "再补其他动作", "没有找到动作", "添加动作图片",
  "创建提醒", "保存备忘", "查提醒和备忘、写日报", "记住你的习惯", "做动作", "回复方式", "连接与模型", "发给 AI 的设定", "拼好的完整提示词", "最近发出的请求",
  "AI 可以使用的能力", "不像验证码邮件", "是验证码邮件，但没认出码", "语音", "添加克隆声音", "克隆的声音", "关心", "勿扰", "应用", "宠物",
  "提醒", "备份", "导入与导出", "快捷键", "辅助功能权限", "诊断",
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
