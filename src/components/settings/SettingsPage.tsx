import { TranslationSettings, TranslationShortcutRow } from "./TranslationSettings";
import { QuickChatShortcutRow } from "./QuickChatSettings";
import { ai } from "../../ai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appendUserActions, loadUserActions } from "../../actions/UserActions";
import { isCustomCharacter, loadCharacterPack, loadPackCatalog, type CatalogEntry } from "../../assets/PackCatalog";
import type { AnimationEntry, PetControl, PetPersona } from "../../assets/Manifest";
import { petWindow } from "../../platform/petWindow";
import { chatPictureActions, loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterPictures } from "../../appearance/characterPictures";
import { characterName } from "../../preferences/ChatPreferences";
import { isOnboarded, markOnboarded } from "../../preferences/UserProfile";
import { saveOnTop } from "../../preferences/DisplayPreferences";
import { systemPlatform } from "../../platform/system";
import { CHAT_LIMITS } from "../../chat/ChatThreads";
import { createLocalPetStorage } from "../../storage/PetStorage";
import { AISettings } from "./AISettings";
import { ClonedVoiceSettings } from "./ClonedVoiceSettings";
import { ChatSettings } from "./ChatSettings";
import { FactSettings } from "./FactSettings";
import { ChatRequestLog } from "./ChatRequestLog";
import { PromptPreview } from "./PromptPreview";
import { SkillList } from "./SkillSettings";
import { ToolDefinitions } from "./ToolDefinitions";
import { loadDeveloperMode, saveDeveloperMode } from "../../preferences/DeveloperMode";
import { CharacterSettings } from "./CharacterSettings";
import { CharacterProfileSettings } from "./CharacterProfileSettings";
import { HolidaySettings } from "./HolidaySettings";
import { MailSettings } from "./MailSettings";
import { AgentSettings } from "./AgentSettings";
import { DubbingSettings } from "./DubbingSettings";
import { ActionLibrary } from "./actions/ActionLibrary";
import { DockSettings } from "./DockSettings";
import { CompanionSettings } from "./CompanionSettings";
import { WelcomeGuide } from "./WelcomeGuide";
import { BackupSettings } from "./BackupSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { UpdateRow } from "./UpdateRow";
import { WhatsNewSheet } from "./WhatsNewSheet";
import { CURRENT_VERSION, markWhatsNewSeen, notesFor, shouldShowWhatsNew } from "../../update/WhatsNew";
import { LaunchAtLoginRow } from "./LaunchAtLoginRow";
import { hasUnsavedChanges, setUnsavedChanges } from "./unsavedChanges";
import { canShortcut } from "../../preferences/ActionPreferences";
import "./SettingsPage.css";
import { moveRadioChoice } from "./radioKeys";
import { ACCOUNT_SECTION, DEVELOPER_GROUP, NAV_GROUPS, SUB_PAGES, isSection, sectionLabel, type SettingsSection } from "./sections";
import { CharacterAvatar } from "../CharacterAvatar";
import { LinksSettings } from "../links/LinksPanel";
import { Chevron } from "./Chevron";
import { SettingsBackButton } from "./SettingsBackButton";
import { SettingsSearch, type SearchResult } from "./SettingsSearchField";
import { SETTINGS_INDEX } from "./settingsSearch";
import { FeatureGuide } from "./FeatureGuide";
import { FEATURE_GUIDE } from "../../guide/featureGuide";
import { Icon, type IconName } from "../../ui/icons";

const SCALES = [
  { value: 0.75, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.3, label: "大" },
] as const;
/** Shortcuts the app keeps to itself, listed on 「通用 › 快捷键」 so every key can be found in one place. */
const FIXED_SHORTCUTS: readonly [string, string][] = [
  ["打开设置", "⌘ ,"],
  ["新聊天", "⌘ N"],
  ["关闭窗口或面板", "⌘ W"],
  ["在设置里搜索", "⌘ F"],
  ["退出 AI Pet", "⌘ Q"],
];
/** Looking for a search result's title on a page that is still loading: every 100 ms, for 1.5 s. */
const FIND_INTERVAL_MS = 100;
const FIND_TRIES = 15;
/** Other words people look a page up by, old names included. */
const PAGE_KEYWORDS: Partial<Record<SettingsSection, string>> = {
  ai: "AI 对话 DeepSeek MiMo API Key 模型 语音",
  companion: "早安 问候 关心 勿扰 免打扰",
  tools: "划词 翻译 编码助手 Claude Code 邮箱 邮件 验证码 常用链接",
  links: "常用链接 网址 环境 域名 书签 地址",
  skills: "开关 关闭 提醒 备忘 日报 记忆 动作 安静 网页 链接",
  prompt: "系统提示词 system prompt 对话规则 修改规则 改写",
  toolDefs: "工具 tool function 函数 参数 schema 开关",
};
/** Pages whose settings belong to the current character; their title names it. */
const PER_CHARACTER: readonly SettingsSection[] = ["characterProfile", "dock", "actions"];

/** Each page's glyph on its tile in the sidebar. */
const PAGE_ICONS: Record<SettingsSection, IconName> = {
  character: "user", characterProfile: "user_plus", general: "gear", companion: "heart", dock: "dock", actions: "paw",
  chat: "chat", ai: "layers", skills: "skills", voices: "waveform", memory: "bookmark", tools: "wrench", links: "link",
  privacy: "shield", guide: "bulb", about: "info", diagnostics: "lines", prompt: "document", toolDefs: "braces", developer: "code",
};

function SettingsGlyph({ name }: { name: SettingsSection }) {
  return <Icon name={PAGE_ICONS[name]} />;
}


/** "隐私与数据": what stays on this computer, and each time the app goes online: title, what, and when. */
const STORED: readonly [string, string][] = [
  ["按角色分开", "名字、性格、聊天记录、快捷按钮、自己做的动作"],
  ["所有角色共用", "提醒、备忘、宠物大小、勿扰和其他设置"],
  ["聊天记录", `每个角色最多留 ${CHAT_LIMITS.threads} 段，更早的自动删掉`],
  ["请求记录", "每次请求 AI 的用时和用量留 90 天，不含内容；开发者模式另存最近 100 次的完整内容。都不进备份"],
  ["API Key 和邮箱授权码", "API Key 在本机加密保存，邮箱授权码存在钥匙串里"],
  ["克隆的声音", "原始录音和百炼音色 ID 保存在本机、不进备份；创建后的克隆音色也保存在阿里云百炼"],
];
const ONLINE: readonly [string, string, string][] = [
  ["DeepSeek · 聊天", `最近 ${CHAT_LIMITS.context} 条消息、你的称呼、角色设定和补充要求`, "聊天时"],
  ["DeepSeek · 网页", "链接和问题，追问时附上该网页的对话。联网搜索发送本轮问题", "阅读链接或搜索时"],
  ["DeepSeek · 图片", "缩小后的图片和本轮问题，聊天记录只保存图片名和问答", "发送带图片的消息时"],
  ["DeepSeek · 早安晚安", "今天的提醒内容和数量、专注了几轮", "每天两次"],
  ["DeepSeek · 查提醒和备忘", "所查类型的记录", "按条件查找时"],
  ["DeepSeek · 今日回顾", "今天勾掉和没处理的提醒、专注轮数、今天记的备忘", "需要归纳时"],
  ["DeepSeek · 划词", "只有选中的文字", "翻译、解释、总结、润色时"],
  ["小米 MiMo · 语音输入", "这段录音，识别完不保存", "说话时"],
  ["小米 MiMo · 朗读", "这条回复的文字（使用 MiMo 内置音色时）", "点朗读或试听时"],
  ["阿里云百炼 · 创建克隆音色", "录音片段；创建后的音色会保存在云端，直到删除", "添加克隆声音时"],
  ["阿里云百炼 · CosyVoice 朗读", "这条回复的文字和已创建的克隆音色 ID", "使用克隆音色朗读时"],
  ["163 邮箱", "只读最新几封邮件，不标已读", "查收时"],
  ["GitHub · 检查更新", "不带个人信息", "每天一次"],
];

/** Rows of "什么时候会连网" shown before "显示全部". */
const ONLINE_SHOWN = 4;

function InfoRow({ title, detail, value }: { title: string; detail: string; value?: string }) {
  return <div className="settings-row"><div className="settings-row__body"><strong>{title}</strong><span>{detail}</span></div>{value && <span className="settings-row__value">{value}</span>}</div>;
}

export function SettingsPage({ packId }: { packId: string }) {
  const storage = useMemo(() => createLocalPetStorage(window.localStorage, packId), [packId]);
  // Other windows can ask for a section, e.g. the chat window opens "ai" when the key is missing.
  const [section, setSection] = useState<SettingsSection>(() => { const asked = new URLSearchParams(window.location.search).get("section"); return isSection(asked) ? asked : "character"; });
  const contentRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  // Errors stick right under the page title, whose height changes with the page (sub pages add a way back).
  useLayoutEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content) return;
    const measure = () => content.style.setProperty("--header-height", `${header.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  // Every page shares one scroller. A page shorter than where the last one was scrolled to would open part way down, or blank.
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [persona, setPersona] = useState<PetPersona | undefined>(undefined);
  const [scale, setScale] = useState(() => storage.loadScale() ?? 1);
  const [onTop, setOnTop] = useState(true);
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [packInfo, setPackInfo] = useState<{ id: string; canvas: { width: number; height: number } } | null>(null);
  const [packActions, setPackActions] = useState<AnimationEntry[]>([]);
  /** Bumped when the user makes, changes or deletes one of their own actions. */
  const [userActionsRevision, setUserActionsRevision] = useState(0);
  /** Bumped when the avatar changes, so the sidebar row shows the new one. */
  const [, setLookRevision] = useState(0);
  const [baseControls, setBaseControls] = useState<PetControl[]>([]);
  const [resolveAsset, setResolveAsset] = useState<(file: string) => string>(() => (file: string) => file);

  const [developer, setDeveloper] = useState(loadDeveloperMode);
  /** "什么时候会连网" opens on its first few rows; the rest are a click away. */
  const [allOnline, setAllOnline] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // After an update, the "新功能" sheet opens by itself once; "关于" opens it again.
  const [whatsNew, setWhatsNew] = useState(() => { try { return shouldShowWhatsNew(window.localStorage); } catch { return false; } });
  const closeWhatsNew = () => {
    setWhatsNew(false);
    try { markWhatsNewSeen(window.localStorage); } catch (reason) { console.warn("Could not remember the what's new sheet", reason); }
  };
  const currentNotes = notesFor(CURRENT_VERSION);
  // First run: guide the user unless a DeepSeek key is already saved (an existing install).
  useEffect(() => {
    if (isOnboarded()) return;
    ai.keyStatus().then((saved) => { if (saved) markOnboarded(); else setWelcome(true); }).catch(() => setWelcome(true));
  }, []);
  const current = catalog.find((entry) => entry.id === packId);
  const reloadCatalog = useCallback(() => {
    // Portraits show the pictures each character really wears, never ones a custom character borrows.
    loadPackCatalog()
      .then((entries) => Promise.all(entries.map(async (entry) => ({ ...entry, actionImages: await characterPictures(entry.id, entry.actionImages, chatPictureActions(loadChatAppearance(entry.id))) }))))
      .then(setCatalog).catch((reason: unknown) => { console.error("Could not load the characters", reason); setError("角色列表没能读出来，关掉设置窗口再打开试试。"); });
  }, []);
  useEffect(reloadCatalog, [reloadCatalog]);

  useEffect(() => {
    document.documentElement.classList.add("settings-window");
    document.documentElement.classList.toggle("is-native", petWindow.isNative);
    // The sidebar's selection is coloured only while this window is the one in front, as in any Mac window.
    const showFront = () => document.documentElement.classList.toggle("is-inactive", !document.hasFocus());
    showFront();
    window.addEventListener("focus", showFront);
    window.addEventListener("blur", showFront);
    document.body.classList.add("settings-window");
    const stopOnTop = petWindow.onOnTopChanged(setOnTop);
    petWindow.getOnTop().then(setOnTop).catch((reason: unknown) => console.warn("Could not read the on-top setting", reason));
    systemPlatform.appVersion().then(setVersion).catch((reason: unknown) => console.warn("Could not read the app version", reason));
    // The window is hidden, not closed: the size may have been changed from the pet menu meanwhile.
    const onFocus = () => setScale(storage.loadScale() ?? 1);
    window.addEventListener("focus", onFocus);
    return () => {
      stopOnTop();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("focus", showFront);
      window.removeEventListener("blur", showFront);
      document.documentElement.classList.remove("settings-window");
      document.body.classList.remove("settings-window");
    };
  }, [storage]);

  useEffect(() => {
    let active = true;
    setPackInfo(null);
    loadCharacterPack(packId)
      .then((pack) => {
        if (!active) return;
        setPackInfo({ id: pack.manifest.id, canvas: pack.manifest.canvas });
        setPersona(pack.manifest.persona);
        setPackActions(pack.manifest.animations);
        setBaseControls(pack.manifest.controls);
        setResolveAsset(() => pack.resolve);
      })
      .catch((reason: unknown) => { console.error("Could not load the character", reason); if (active) setError("这个角色的配置没能读出来，可以换一个角色再试。"); });
    return () => { active = false; };
  }, [packId]);

  // The character's actions followed by the user's own, as the pet shows them. The revision says when storage changed.
  const actions = useMemo(() => (packInfo ? appendUserActions(packActions, loadUserActions(packInfo.id)) : []), [packInfo, packActions, userActionsRevision]);
  /** The actions a chat may ask for, as the chat windows offer them. */
  const chatActions = useMemo(() => packActions.filter(canShortcut).map((action) => action.id), [packActions]);

  const updateScale = async (value: number) => {
    setScale(value);
    storage.saveScale(value);
    try {
      await petWindow.requestScale(value);
      setError(null);
    } catch (reason) {
      console.error("Could not resize the pet", reason);
      setError("宠物大小没能改过来，可以在宠物的右键菜单里再试一次。");
    }
  };

  const updateOnTop = async (value: boolean) => {
    setOnTop(value);
    try {
      await petWindow.setOnTop(value);
    } catch (reason) {
      setOnTop(!value);
      console.error("Could not change always on top", reason);
      setError("没能改过来，可以在宠物的右键菜单里再试一次。");
      return;
    }
    try {
      saveOnTop(value);
      setError(null);
    } catch (reason) {
      console.error("Could not save always on top", reason);
      setError("已经生效，但没能记住，下次打开会恢复原样。");
    }
  };

  const updateDeveloper = (enabled: boolean) => {
    try {
      saveDeveloperMode(enabled);
      setDeveloper(enabled);
      setError(null);
    } catch (reason) {
      console.error("Could not save developer mode", reason);
      setError("设置没能保存，请再试一次。");
    }
  };

  const name = current ? characterName(packId, current.name) : "";
  const label = sectionLabel(section);
  const title = PER_CHARACTER.includes(section) && name ? `${label} · ${name}` : label;
  /** A page opened from inside another: that one stays lit in the sidebar, and the title leads back to it. */
  const parent = SUB_PAGES[section];
  /** Nested pages keep the top-level category selected (e.g. logs keep About lit). */
  const activeSection = parent ? SUB_PAGES[parent] ?? parent : section;
  const navGroups = developer ? [...NAV_GROUPS, DEVELOPER_GROUP] : NAV_GROUPS;
  /** The action editor has unsaved changes: the first click on another page only warns. */
  const [leaving, setLeaving] = useState<SettingsSection | null>(null);
  /** Shows page `id`; returns false when unsaved changes hold the user on this one. */
  const go = (id: SettingsSection): boolean => {
    if (id !== section && hasUnsavedChanges() && leaving !== id) {
      setLeaving(id);
      setError("动作还没保存。再点一次离开，改动会丢掉。");
      return false;
    }
    setUnsavedChanges(false);
    setLeaving(null);
    setSection(id);
    setError(null);
    return true;
  };
  // A page asked for from another window goes through `go` too, so unsaved action edits still warn first.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => petWindow.onSettingsSection((asked) => { if (isSection(asked)) goRef.current(asked); }), []);

  // Search: the pages, the settings on them and the features in "功能一览".
  const searchEntries = useMemo<SearchResult[]>(() => [
    ...[ACCOUNT_SECTION, ...NAV_GROUPS.flatMap(({ items }) => items.map(({ id }) => id)), ...(developer ? DEVELOPER_GROUP.items.map(({ id }) => id) : []), ...(Object.keys(SUB_PAGES) as SettingsSection[])].map((id) => ({ section: id, title: sectionLabel(id), place: "", keywords: PAGE_KEYWORDS[id] })),
    ...SETTINGS_INDEX.map((entry) => ({ ...entry, place: sectionLabel(entry.section) })),
    ...FEATURE_GUIDE.flatMap((group) => group.features.map((feature) => ({ section: "guide" as const, title: feature.title, keywords: `${feature.detail} ${feature.how?.join(" ") ?? ""}`, place: sectionLabel("guide") }))),
  ], [developer]);
  /** The title a search result points at; the page scrolls to it and flashes it. */
  const [found, setFound] = useState<{ title: string; at: number } | null>(null);
  const openResult = (entry: SearchResult) => {
    if (!go(entry.section)) return;
    setFound(entry.place ? { title: entry.title, at: Date.now() } : null);
  };
  useEffect(() => {
    if (!found) return;
    // Pages load their parts on their own time, so look for the title a few times before giving up.
    let tries = 0;
    let lit: Element | null = null;
    const timer = window.setInterval(() => {
      tries += 1;
      const label = [...(contentRef.current?.querySelectorAll("strong, h2, h3") ?? [])].find((element) => element.textContent?.trim() === found.title);
      if (!label && tries < FIND_TRIES) return;
      window.clearInterval(timer);
      if (!label) return;
      lit = label.closest(".settings-row, .guide-feature, .ai-settings__head, .settings-section__intro") ?? label;
      lit.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      lit.classList.remove("is-search-hit");
      void (lit as HTMLElement).offsetWidth;
      lit.classList.add("is-search-hit");
    }, FIND_INTERVAL_MS);
    return () => { window.clearInterval(timer); };
  }, [found]);

  return (
    <main className="settings-page">
      <aside className="settings-sidebar" data-tauri-drag-region>
        <SettingsSearch entries={searchEntries} onPick={openResult} icon={(entry) => <span className={`settings-nav__icon settings-nav__icon--${entry.section}`}><SettingsGlyph name={entry.section} /></span>}>
          <nav aria-label="设置分类">
            {/* The current character, at the top like the account in System Settings. */}
            <button type="button" aria-current={activeSection === ACCOUNT_SECTION ? "page" : undefined} className={activeSection === ACCOUNT_SECTION ? "settings-account is-active" : "settings-account"} onClick={() => go(ACCOUNT_SECTION)}>
              <CharacterAvatar picture={current ? pictureFor(loadChatAppearance(packId).avatar, current.actionImages) : null} className="settings-account__avatar" />
              <span className="settings-account__text"><strong>{name || sectionLabel(ACCOUNT_SECTION)}</strong><span>当前角色</span></span>
            </button>
            {navGroups.map(({ title: groupTitle, items }) => (
              <div key={groupTitle || "developer"} className="settings-nav-group">
                {groupTitle && <h2 className="settings-nav-group__title">{groupTitle}</h2>}
                {items.map(({ id, label }) => (
                  <button key={id} type="button" aria-current={activeSection === id ? "page" : undefined} className={activeSection === id ? "settings-nav is-active" : "settings-nav"} onClick={() => go(id)}>
                    <span className={`settings-nav__icon settings-nav__icon--${id}`}><SettingsGlyph name={id} /></span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </SettingsSearch>
      </aside>

      <section className="settings-content" ref={contentRef}>
        {/* The character page's portrait and name are its title. */}
        <header ref={headerRef} data-tauri-drag-region="deep" className={section === ACCOUNT_SECTION ? "settings-header settings-header--quiet" : "settings-header"}>
          {parent && <div className="settings-header__back"><SettingsBackButton destination={sectionLabel(parent)} onBack={() => go(parent)} /></div>}
          <h1>{title}</h1>
        </header>
        {error && <p className="settings-error" role="status">{error}</p>}

        {section === "general" && (
          <div className="settings-section">
            <h2 className="settings-group-title">宠物显示</h2>
            <div className="settings-group">
              <div className="settings-row"><div className="settings-row__body"><strong>总在最前面</strong><span>也会盖在全屏应用上面</span></div><button type="button" role="switch" aria-checked={onTop} aria-label="总在最前面" className={onTop ? "ui-switch is-on" : "ui-switch"} onClick={() => void updateOnTop(!onTop)}><span /></button></div>
              <div className="settings-row"><div className="settings-row__body"><strong>宠物大小</strong><span>也可以在右键菜单里调整</span></div><div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="宠物大小">{SCALES.map((item) => <button key={item.value} type="button" role="radio" aria-checked={scale === item.value} className={scale === item.value ? "is-selected" : ""} onClick={() => void updateScale(item.value)}>{item.label}</button>)}</div></div>
            </div>
            <h2 className="settings-group-title">启动</h2>
            <div className="settings-group">
              <LaunchAtLoginRow onError={setError} />
            </div>
            <h2 className="settings-group-title">快捷键</h2>
            <div className="settings-group">
              <QuickChatShortcutRow onError={setError} />
              <TranslationShortcutRow onError={setError} />
              {FIXED_SHORTCUTS.map(([title, keys]) => <div key={title} className="settings-row"><div className="settings-row__body"><strong>{title}</strong></div><kbd className="settings-row__value settings-keys">{keys}</kbd></div>)}
            </div>
            <p className="settings-footnote">上面两个可以改，点一下再按新的组合键；其余是固定的</p>
          </div>
        )}

        {section === "tools" && (
          <div className="settings-section">
            <h2 className="settings-group-title">划词翻译</h2>
            <TranslationSettings onError={setError} />
            <AgentSettings />
            <MailSettings />
            <DubbingSettings />
            <div className="settings-group">
              <button type="button" className="settings-row settings-link" onClick={() => go("links")}>
                <span className="settings-nav__icon settings-nav__icon--links"><SettingsGlyph name="links" /></span>
                <span className="settings-row__body"><strong>常用链接</strong><span>管理环境地址和常用工作入口</span></span>
                <Chevron />
              </button>
            </div>
          </div>
        )}

        {section === "links" && <LinksSettings />}

        {section === "dock" && packInfo && <DockSettings key={packInfo.id} packId={packInfo.id} controls={baseControls} actions={actions} resolveAsset={resolveAsset} onError={setError} />}

        {section === "companion" && <CompanionSettings name={name || "宠物"} onError={setError} />}

        {section === "actions" && packInfo && <ActionLibrary key={packInfo.id} actions={actions} controls={baseControls} packId={packInfo.id} custom={isCustomCharacter(packInfo.id)} characterName={name || "这个角色"} canvas={packInfo.canvas} resolveAsset={resolveAsset} onActionsChanged={() => setUserActionsRevision((value) => value + 1)} onPicturesChanged={reloadCatalog} />}

        {section === "character" && !welcome && packInfo?.id === packId && <CharacterSettings key={packId} packId={packId} catalog={catalog} profileIcon={<span className="settings-nav__icon settings-nav__icon--characterProfile"><SettingsGlyph name="characterProfile" /></span>} onCatalogChange={reloadCatalog} onOpenProfile={() => void go("characterProfile")} onLookChange={() => setLookRevision((value) => value + 1)} />}
        {section === "characterProfile" && packInfo?.id === packId && <CharacterProfileSettings key={packId} packId={packId} persona={persona} actions={packActions} current={catalog.find((entry) => entry.id === packId)} onCatalogChange={reloadCatalog} onLookChange={() => setLookRevision((value) => value + 1)} />}
        {section === "chat" && packInfo && <ChatSettings key={packId} packId={packId} onError={setError} />}
        {section === "skills" && <SkillList actions={chatActions} onError={setError} />}
        {section === "ai" && <AISettings packId={packId} persona={persona} characterName={name || "这个角色"} clonesIcon={<span className="settings-nav__icon settings-nav__icon--voices"><SettingsGlyph name="voices" /></span>} onOpenClones={() => void go("voices")} />}
        {section === "voices" && <ClonedVoiceSettings onOpenAI={() => void go("ai")} />}
        {section === "memory" && <FactSettings who={name || "宠物"} />}
        {section === "prompt" && <PromptPreview packId={packId} persona={persona} actions={chatActions} onError={setError} />}
        {section === "toolDefs" && <ToolDefinitions packId={packId} persona={persona} actions={chatActions} onError={setError} />}
        {section === "developer" && <div className="settings-section"><div className="settings-card"><ChatRequestLog /></div></div>}
        {section === "diagnostics" && <DiagnosticsSettings onError={setError} />}
        {section === "privacy" && (
          <div className="settings-section">
            <h2 className="settings-group-title">备份</h2>
            <BackupSettings onError={setError} />
            <h2 className="settings-group-title">存在这台电脑上</h2>
            <div className="settings-group">
              {STORED.map(([title, detail]) => <InfoRow key={title} title={title} detail={detail} />)}
            </div>
            <h2 className="settings-group-title">什么时候会连网</h2>
            <div className="settings-group">
              {(allOnline ? ONLINE : ONLINE.slice(0, ONLINE_SHOWN)).map(([title, detail, when]) => <InfoRow key={title} title={title} detail={detail} value={when} />)}
              <HolidaySettings />
              {!allOnline && <button type="button" className="settings-more" onClick={() => setAllOnline(true)}>显示全部 {ONLINE.length + 1} 项</button>}
            </div>
          </div>
        )}

        {section === "guide" && <FeatureGuide onOpen={go} />}

        {section === "about" && (
          <div className="settings-section">
            <div className="about-card"><img className="about-card__icon" src="/app-icon.png" alt="" /><h2>AI Pet</h2><p>会陪伴、能帮忙的桌面宠物</p>{version && <span>版本 {version}</span>}</div>
            <div className="settings-group">
              {currentNotes && <div className="settings-row"><div className="settings-row__body"><strong>{CURRENT_VERSION} 新功能</strong><span>这次更新加了 {currentNotes.features.length} 个新功能</span></div><button type="button" className="ui-button ui-button--small" onClick={() => setWhatsNew(true)}>查看</button></div>}
              <UpdateRow />
            </div>
            <h2 className="settings-group-title">排查问题</h2>
            <div className="settings-group">
              <button type="button" className="settings-row settings-link" onClick={() => go("diagnostics")}><span className="settings-nav__icon settings-nav__icon--diagnostics"><SettingsGlyph name="diagnostics" /></span><span className="settings-row__body"><strong>日志与诊断</strong><span>出了问题看日志，或导出诊断信息发给帮你排查的人</span></span><Chevron /></button>
              <div className="settings-row"><div className="settings-row__body"><strong>开发者模式</strong><span>侧栏多出「开发者」：提示词、工具定义和请求记录。打开期间，最近 100 次实际发给 AI 的内容和回复会留在本机</span></div><button type="button" role="switch" aria-label="开发者模式" aria-checked={developer} className={developer ? "ui-switch is-on" : "ui-switch"} onClick={() => updateDeveloper(!developer)}><span /></button></div>
            </div>
          </div>
        )}
      </section>
      {/* A new user gets the guide; what is new only matters to someone who used the last version. */}
      {welcome && current && <WelcomeGuide name={characterName(packId, current.name)} avatar={pictureFor(loadChatAppearance(packId).avatar, current.actionImages)} onClose={(withoutKey) => { setWelcome(false); closeWhatsNew(); if (withoutKey) setSection("ai"); }} />}
      {!welcome && whatsNew && currentNotes && <WhatsNewSheet version={CURRENT_VERSION} notes={currentNotes} onClose={closeWhatsNew} />}
    </main>
  );
}
