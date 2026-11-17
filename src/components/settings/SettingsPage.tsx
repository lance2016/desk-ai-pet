import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appendUserActions, loadUserActions } from "../../actions/UserActions";
import { loadCharacterPack, loadPackCatalog, type CatalogEntry } from "../../assets/PackCatalog";
import type { AnimationEntry, PetControl, PetPersona } from "../../assets/Manifest";
import { chatPlatform } from "../../platform/chat";
import { petWindow } from "../../platform/petWindow";
import { loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterName } from "../../preferences/ChatPreferences";
import { isOnboarded, markOnboarded } from "../../preferences/UserProfile";
import { loadDisplayPreferences, saveDisplayPreferences, saveOnTop, type DisplayPreferences } from "../../preferences/DisplayPreferences";
import { systemPlatform } from "../../platform/system";
import { createLocalPetStorage } from "../../storage/PetStorage";
import { AISettings } from "./AISettings";
import { CharacterSettings } from "./CharacterSettings";
import { VoiceSettings } from "./VoiceSettings";
import { ActionLibrary } from "./ActionLibrary";
import { DockSettings } from "./DockSettings";
import { QuietSettings } from "./QuietSettings";
import { HolidaySettings } from "./HolidaySettings";
import { QuickChatSettings } from "./QuickChatSettings";
import { WelcomeGuide } from "./WelcomeGuide";
import { BackupSettings } from "./BackupSettings";
import { UpdateRow } from "./UpdateRow";
import { LaunchAtLoginRow } from "./LaunchAtLoginRow";
import { hasUnsavedChanges, setUnsavedChanges } from "./unsavedChanges";
import "./SettingsPage.css";

const SCALES = [
  { value: 0.75, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.3, label: "大" },
] as const;
const LINGER_OPTIONS = [{ value: 400, label: "快" }, { value: 700, label: "标准" }, { value: 1200, label: "慢" }] as const;
const SECTIONS = ["character", "general", "dock", "actions", "ai", "voice", "privacy", "about"] as const;
/** Pages whose settings belong to the current character; their title names it. */
const PER_CHARACTER: readonly SettingsSection[] = ["dock", "actions"];
type SettingsSection = (typeof SECTIONS)[number];
const isSection = (value: string | null): value is SettingsSection => SECTIONS.some((section) => section === value);

function SettingsGlyph({ name }: { name: SettingsSection }) {
  const paths: Record<SettingsSection, ReactNode> = {
    character: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
    general: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4L17 17.4a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17 3.4l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    dock: <><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 17h.01M12 17h.01M17 17h.01M8 4h8v6H8z" /></>,
    actions: <><path d="M12 20c-3 0-5-1.4-5-3.8 0-2 2.3-3.6 5-3.6s5 1.6 5 3.6c0 2.4-2 3.8-5 3.8Z" /><circle cx="5.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="19" cy="10" r="2" /></>,
    ai: <><path d="M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
    voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    privacy: <><path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** Sidebar entries in order. Each gets its own tile colour, as in System Settings. */
const NAV: readonly { id: SettingsSection; label: string }[] = [
  { id: "character", label: "角色" },
  { id: "general", label: "通用" },
  { id: "dock", label: "快捷按钮" },
  { id: "actions", label: "动作库" },
  { id: "ai", label: "AI 对话" },
  { id: "voice", label: "语音" },
  { id: "privacy", label: "隐私与数据" },
  { id: "about", label: "关于" },
];

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
  // First run: guide the user unless a DeepSeek key is already saved (an existing install).
  useEffect(() => {
    if (isOnboarded()) return;
    chatPlatform.keyStatus().then((saved) => { if (saved) markOnboarded(); else setWelcome(true); }).catch(() => setWelcome(true));
  }, []);
  const current = catalog.find((entry) => entry.id === packId);
  const reloadCatalog = useCallback(() => {
    loadPackCatalog().then(setCatalog).catch((reason: unknown) => { console.error("Could not load the characters", reason); setError("角色列表没能读出来，关掉设置窗口再打开试试。"); });
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
    const next: DisplayPreferences = { ...display, controlsLingerMs: value };
    try { saveDisplayPreferences(next); setDisplay(next); setError(null); } catch (reason) { console.error("Could not save the display setting", reason); setError("设置没能保存，请再试一次。"); }
  };

  const name = current ? characterName(packId, current.name) : "";
  const label = NAV.find((item) => item.id === section)?.label ?? "";
  const title = PER_CHARACTER.includes(section) && name ? `${label} · ${name}` : label;
  /** The action editor has unsaved changes: the first click on another page only warns. */
  const [leaving, setLeaving] = useState<SettingsSection | null>(null);
  const go = (id: SettingsSection) => {
    if (id !== section && hasUnsavedChanges() && leaving !== id) {
      setLeaving(id);
      setError("动作还没保存。再点一次离开，改动会丢掉。");
      return;
    }
    setUnsavedChanges(false);
    setLeaving(null);
    setSection(id);
    setError(null);
  };

  return (
    <main className="settings-page">
      <aside className="settings-sidebar">
        <nav aria-label="设置分类">
          {NAV.map(({ id, label }) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "settings-nav is-active" : "settings-nav"} onClick={() => go(id)}>
              <span className={`settings-nav__icon settings-nav__icon--${id}`}><SettingsGlyph name={id} /></span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
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
              <div className="settings-row"><div className="settings-row__body"><strong>总在最前面</strong><span>宠物显示在其他窗口前面，包括全屏应用</span></div><button type="button" role="switch" aria-checked={onTop} aria-label="总在最前面" className={onTop ? "toggle is-on" : "toggle"} onClick={() => void updateOnTop(!onTop)}><span /></button></div>
              <div className="settings-row"><div className="settings-row__body"><strong>宠物大小</strong><span>也可以在右键菜单里调整</span></div><div className="segmented" role="radiogroup" aria-label="宠物大小">{SCALES.map((item) => <button key={item.value} type="button" role="radio" aria-checked={scale === item.value} className={scale === item.value ? "is-selected" : ""} onClick={() => void updateScale(item.value)}>{item.label}</button>)}</div></div>
              <div className="settings-row"><div className="settings-row__body"><strong>鼠标离开后快捷按钮保留</strong><span>留一点时间，方便把鼠标移到按钮上</span></div><div className="segmented" role="radiogroup" aria-label="快捷按钮保留时间">{LINGER_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={display.controlsLingerMs === option.value} className={display.controlsLingerMs === option.value ? "is-selected" : ""} onClick={() => updateLinger(option.value)}>{option.label}</button>)}</div></div>
            </div>
            <h2 className="settings-group-title">快速聊天</h2>
            <QuickChatSettings onError={setError} />
            <h2 className="settings-group-title">勿扰</h2>
            <QuietSettings onError={setError} />
            <h2 className="settings-group-title">提醒</h2>
            <HolidaySettings />
          </div>
        )}

        {section === "dock" && packInfo && <DockSettings key={packInfo.id} packId={packInfo.id} controls={baseControls} actions={actions} resolveAsset={resolveAsset} onError={setError} />}

        {section === "actions" && packInfo && <ActionLibrary key={packInfo.id} actions={actions} controls={baseControls} packId={packInfo.id} canvas={packInfo.canvas} resolveAsset={resolveAsset} onActionsChanged={() => setUserActionsRevision((value) => value + 1)} />}

        {section === "character" && !welcome && packInfo?.id === packId && <CharacterSettings key={packId} packId={packId} catalog={catalog} persona={persona} actions={packActions} onCatalogChange={reloadCatalog} />}
        {section === "ai" && packInfo && <AISettings key={packId} packId={packId} persona={persona} name={name || undefined} />}
        {section === "voice" && packInfo && <VoiceSettings key={packId} packId={packId} />}
        {section === "privacy" && (
          <div className="settings-section">
            <h2 className="settings-group-title">备份</h2>
            <BackupSettings onError={setError} />
            <h2 className="settings-group-title">保存在这台电脑</h2>
            <div className="settings-group settings-prose">
              <p>所有数据都只存在这台电脑上。快捷按钮、自己做的动作、聊天记录、名字和性格按角色分开；提醒、备忘、宠物大小、勿扰和其他设置所有角色共用，换角色也还在。DeepSeek 和 MiMo 的 API Key 存在钥匙串里。</p>
            </div>
            <h2 className="settings-group-title">会发出去的内容</h2>
            <div className="settings-group settings-prose">
              <p>聊天时，会发给 DeepSeek 的有：这段聊天最近的消息、当前时间、你的称呼、角色的名字和性格，以及宠物会做的动作名称。早安晚安会把今天的提醒数量、专注轮数和提醒内容发给 DeepSeek 来写问候。用语音输入时，录音会发给 MiMo 识别，不会保存。备忘只在你让宠物“记一下”时经过 DeepSeek，其余时候不会发出去。缺少今年或明年的法定节假日安排时，宠物每天最多一次从公开的节假日数据源下载，请求里不带任何个人信息。宠物每天会去 GitHub 查一次有没有新版本，同样不带个人信息。</p>
            </div>
          </div>
        )}

        {section === "about" && (
          <div className="settings-section">
            <div className="about-card"><img className="about-card__icon" src="/app-icon.png" alt="" /><h2>AI Pet</h2><p>会陪伴、能帮忙的桌面宠物</p>{version && <span>版本 {version}</span>}</div>
            <div className="settings-group"><UpdateRow /></div>
          </div>
        )}
      </section>
      {welcome && current && <WelcomeGuide name={characterName(packId, current.name)} avatar={pictureFor(loadChatAppearance(packId).avatar, current.actionImages)} onClose={(withoutKey) => { setWelcome(false); if (withoutKey) setSection("ai"); }} />}
    </main>
  );
}
