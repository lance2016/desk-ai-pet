import { TranslationShortcutSettings } from "./TranslationShortcutSettings";
import { ai } from "../../ai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appendUserActions, loadUserActions } from "../../actions/UserActions";
import { isCustomCharacter, loadCharacterPack, loadPackCatalog, type CatalogEntry } from "../../assets/PackCatalog";
import type { AnimationEntry, PetControl, PetPersona } from "../../assets/Manifest";
import { petWindow } from "../../platform/petWindow";
import { chatPictureActions, loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterPictures } from "../../appearance/characterPictures";
import { characterName } from "../../preferences/ChatPreferences";
import { isOnboarded, markOnboarded } from "../../preferences/UserProfile";
import { loadDisplayPreferences, saveDisplayPreferences, saveOnTop, type DisplayPreferences } from "../../preferences/DisplayPreferences";
import { systemPlatform } from "../../platform/system";
import { CHAT_LIMITS } from "../../chat/ChatThreads";
import { createLocalPetStorage } from "../../storage/PetStorage";
import { AISettings } from "./AISettings";
import { CharacterSettings } from "./CharacterSettings";
import { VoiceSettings } from "./VoiceSettings";
import { MailSettings } from "./MailSettings";
import { ActionLibrary } from "./actions/ActionLibrary";
import { DockSettings } from "./DockSettings";
import { CompanionSettings } from "./CompanionSettings";
import { HolidaySettings } from "./HolidaySettings";
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
import { NAV_GROUPS, isSection, sectionLabel, type SettingsSection } from "./sections";
import { SettingsSearch, type SearchResult } from "./SettingsSearchField";
import { SETTINGS_INDEX } from "./settingsSearch";
import { FeatureGuide } from "./FeatureGuide";
import { FEATURE_GUIDE } from "../../guide/featureGuide";

const SCALES = [
  { value: 0.75, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.3, label: "大" },
] as const;
/** Looking for a search result's title on a page that is still loading: every 100 ms, for 1.5 s. */
const FIND_INTERVAL_MS = 100;
const FIND_TRIES = 15;
const LINGER_OPTIONS = [{ value: 400, label: "快" }, { value: 700, label: "标准" }, { value: 1200, label: "慢" }] as const;
/** Pages whose settings belong to the current character; their title names it. */
const PER_CHARACTER: readonly SettingsSection[] = ["dock", "actions"];

function SettingsGlyph({ name }: { name: SettingsSection }) {
  const paths: Record<SettingsSection, ReactNode> = {
    character: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
    general: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4L17 17.4a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17 3.4l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    companion: <><path d="M20 9c0 5-8 10-8 10S4 14 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1Z" /></>,
    dock: <><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 17h.01M12 17h.01M17 17h.01M8 4h8v6H8z" /></>,
    actions: <><path d="M12 20c-3 0-5-1.4-5-3.8 0-2 2.3-3.6 5-3.6s5 1.6 5 3.6c0 2.4-2 3.8-5 3.8Z" /><circle cx="5.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="19" cy="10" r="2" /></>,
    ai: <><path d="M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
    voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    tools: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.4-.4-2.4 2.5-2.5Z" /></>,
    privacy: <><path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    guide: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}


/** "隐私与数据": what stays on this computer, and each time the app goes online: title, what, and when. */
const STORED: readonly [string, string][] = [
  ["按角色分开", "名字、性格、聊天记录、快捷按钮、自己做的动作"],
  ["所有角色共用", "提醒、备忘、宠物大小、勿扰和其他设置"],
  ["聊天记录", `每个角色最多留 ${CHAT_LIMITS.threads} 段，更早的自动删掉`],
  ["请求记录", "每次请求 AI 的用时和用量留 90 天，不含内容；开发者模式另存最近 100 次的完整内容。都不进备份"],
  ["API Key 和邮箱授权码", "存在钥匙串里"],
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
  ["163 邮箱", "只读最新几封邮件，不标已读", "查收时"],
  ["节假日数据", "不带个人信息", "缺数据时"],
  ["GitHub · 检查更新", "不带个人信息", "每天一次"],
];

function InfoRow({ title, detail, value }: { title: string; detail: string; value?: string }) {
  return <div className="settings-row"><div className="settings-row__body"><strong>{title}</strong><span>{detail}</span></div>{value && <span className="settings-row__value">{value}</span>}</div>;
}

export function SettingsPage({ packId }: { packId: string }) {
  const storage = useMemo(() => createLocalPetStorage(window.localStorage, packId), [packId]);
  // Other windows can ask for a section, e.g. the chat window opens "ai" when the key is missing.
  const [section, setSection] = useState<SettingsSection>(() => { const asked = new URLSearchParams(window.location.search).get("section"); return isSection(asked) ? asked : "character"; });
  const contentRef = useRef<HTMLElement>(null);
  // Every page shares one scroller. A page shorter than where the last one was scrolled to would open part way down, or blank.
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);
  useEffect(() => petWindow.onSettingsSection((asked) => { if (isSection(asked)) setSection(asked); }), []);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [persona, setPersona] = useState<PetPersona | undefined>(undefined);
  const [scale, setScale] = useState(() => storage.loadScale() ?? 1);
  const [onTop, setOnTop] = useState(true);
  const [display, setDisplay] = useState(loadDisplayPreferences);
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [packInfo, setPackInfo] = useState<{ id: string; canvas: { width: number; height: number } } | null>(null);
  const [packActions, setPackActions] = useState<AnimationEntry[]>([]);
  /** Bumped when the user makes, changes or deletes one of their own actions. */
  const [userActionsRevision, setUserActionsRevision] = useState(0);
  const [baseControls, setBaseControls] = useState<PetControl[]>([]);
  const [resolveAsset, setResolveAsset] = useState<(file: string) => string>(() => (file: string) => file);

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
    document.body.classList.add("settings-window");
    const stopOnTop = petWindow.onOnTopChanged(setOnTop);
    petWindow.getOnTop().then(setOnTop).catch((reason: unknown) => console.warn("Could not read the on-top setting", reason));
    systemPlatform.appVersion().then(setVersion).catch((reason: unknown) => console.warn("Could not read the app version", reason));
    // The window is hidden, not closed: the size may have been changed from the pet menu meanwhile.
    const onFocus = () => { setScale(storage.loadScale() ?? 1); setDisplay(loadDisplayPreferences()); };
    window.addEventListener("focus", onFocus);
    return () => {
      stopOnTop();
      window.removeEventListener("focus", onFocus);
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

  const updateLinger = (value: DisplayPreferences["controlsLingerMs"]) => {
    // Read again: the AI page saves the chat button into the same preferences.
    const next: DisplayPreferences = { ...loadDisplayPreferences(), controlsLingerMs: value };
    try { saveDisplayPreferences(next); setDisplay(next); setError(null); } catch (reason) { console.error("Could not save the display setting", reason); setError("设置没能保存，请再试一次。"); }
  };

  const name = current ? characterName(packId, current.name) : "";
  const label = sectionLabel(section);
  const title = PER_CHARACTER.includes(section) && name ? `${label} · ${name}` : label;
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

  // Search: the pages, the settings on them and the features in "功能一览".
  const searchEntries = useMemo<SearchResult[]>(() => [
    ...NAV_GROUPS.flat().map(({ id, label: page }) => ({ section: id, title: page, place: "" })),
    ...SETTINGS_INDEX.map((entry) => ({ ...entry, place: sectionLabel(entry.section) })),
    ...FEATURE_GUIDE.flatMap((group) => group.features.map((feature) => ({ section: "guide" as const, title: feature.title, keywords: `${feature.detail} ${feature.how?.join(" ") ?? ""}`, place: sectionLabel("guide") }))),
  ], []);
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
      <aside className="settings-sidebar">
        <SettingsSearch entries={searchEntries} onPick={openResult} icon={(entry) => <span className={`settings-nav__icon settings-nav__icon--${entry.section}`}><SettingsGlyph name={entry.section} /></span>}>
          <nav aria-label="设置分类">
            {NAV_GROUPS.map((group) => (
              <div key={group[0].id} className="settings-nav-group">
                {group.map(({ id, label }) => (
                  <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "settings-nav is-active" : "settings-nav"} onClick={() => go(id)}>
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
        <header className="settings-header"><h1>{title}</h1></header>
        {error && <p className="settings-error" role="status">{error}</p>}

        {section === "general" && (
          <div className="settings-section">
            <h2 className="settings-group-title">启动</h2>
            <div className="settings-group"><LaunchAtLoginRow onError={setError} /></div>
            <h2 className="settings-group-title">窗口</h2>
            <div className="settings-group">
              <div className="settings-row"><div className="settings-row__body"><strong>总在最前面</strong><span>也会盖在全屏应用上面</span></div><button type="button" role="switch" aria-checked={onTop} aria-label="总在最前面" className={onTop ? "toggle is-on" : "toggle"} onClick={() => void updateOnTop(!onTop)}><span /></button></div>
              <div className="settings-row"><div className="settings-row__body"><strong>宠物大小</strong><span>也可以在右键菜单里调整</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="宠物大小">{SCALES.map((item) => <button key={item.value} type="button" role="radio" aria-checked={scale === item.value} className={scale === item.value ? "is-selected" : ""} onClick={() => void updateScale(item.value)}>{item.label}</button>)}</div></div>
              <div className="settings-row"><div className="settings-row__body"><strong>快捷按钮停留</strong><span>鼠标移开后，脚下的按钮多久变淡</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="快捷按钮停留时间">{LINGER_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={display.controlsLingerMs === option.value} className={display.controlsLingerMs === option.value ? "is-selected" : ""} onClick={() => updateLinger(option.value)}>{option.label}</button>)}</div></div>
            </div>
          </div>
        )}

        {section === "tools" && (
          <div className="settings-section">
            <h2 className="settings-group-title">划词翻译</h2>
            <TranslationShortcutSettings onError={setError} />
            <h2 className="settings-group-title">提醒</h2>
            <HolidaySettings />
            <MailSettings />
          </div>
        )}

        {section === "dock" && packInfo && <DockSettings key={packInfo.id} packId={packInfo.id} controls={baseControls} actions={actions} resolveAsset={resolveAsset} onError={setError} />}

        {section === "companion" && <CompanionSettings name={name || "宠物"} onError={setError} />}

        {section === "actions" && packInfo && <ActionLibrary key={packInfo.id} actions={actions} controls={baseControls} packId={packInfo.id} custom={isCustomCharacter(packInfo.id)} characterName={name || "这个角色"} canvas={packInfo.canvas} resolveAsset={resolveAsset} onActionsChanged={() => setUserActionsRevision((value) => value + 1)} onPicturesChanged={reloadCatalog} />}

        {section === "character" && !welcome && packInfo?.id === packId && <CharacterSettings key={packId} packId={packId} catalog={catalog} persona={persona} actions={packActions} onCatalogChange={reloadCatalog} />}
        {section === "ai" && packInfo && <AISettings key={packId} packId={packId} persona={persona} name={name || undefined} actions={packActions.filter(canShortcut).map((action) => action.id)} onCharacter={() => go("character")} onError={setError} />}
        {section === "voice" && packInfo && <VoiceSettings key={packId} packId={packId} />}
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
              {ONLINE.map(([title, detail, when]) => <InfoRow key={title} title={title} detail={detail} value={when} />)}
            </div>
          </div>
        )}

        {section === "guide" && <FeatureGuide onOpen={go} />}

        {section === "about" && (
          <div className="settings-section">
            <div className="about-card"><img className="about-card__icon" src="/app-icon.png" alt="" /><h2>AI Pet</h2><p>会陪伴、能帮忙的桌面宠物</p>{version && <span>版本 {version}</span>}</div>
            <div className="settings-group">
              {currentNotes && <div className="settings-row"><div className="settings-row__body"><strong>{CURRENT_VERSION} 新功能</strong><span>这次更新加了 {currentNotes.features.length} 个新功能</span></div><button type="button" className="settings-button settings-button--small" onClick={() => setWhatsNew(true)}>查看</button></div>}
              <UpdateRow />
            </div>
            <h2 className="settings-group-title">诊断</h2>
            <DiagnosticsSettings onError={setError} />
          </div>
        )}
      </section>
      {/* A new user gets the guide; what is new only matters to someone who used the last version. */}
      {welcome && current && <WelcomeGuide name={characterName(packId, current.name)} avatar={pictureFor(loadChatAppearance(packId).avatar, current.actionImages)} onClose={(withoutKey) => { setWelcome(false); closeWhatsNew(); if (withoutKey) setSection("ai"); }} />}
      {!welcome && whatsNew && currentNotes && <WhatsNewSheet version={CURRENT_VERSION} notes={currentNotes} onClose={closeWhatsNew} />}
    </main>
  );
}
