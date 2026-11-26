import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { elapsedText } from "../../activity/Activity";
import { codingInbox, loadInboxMarks, saveInboxMark, SNOOZE_MS, type InboxItem } from "../../agents/codingInbox";
import { byProject, isLive, pinnedFirst, resumeCommand, sessionTitle, stateLine, stateWord, type CodingSession, type ProjectGroup, type TurnState } from "../../agents/CodingSession";
import { loadPinnedFolder, savePinnedFolder } from "../../agents/codingPin";
import { codingSessionsSnapshot, subscribeCodingSessions } from "../../agents/codingStore";
import { agentPlatform, type ClaudeHooksState } from "../../platform/agents";
import { petWindow } from "../../platform/petWindow";
import { TurnMark } from "../CodingCard";
import { useCloseShortcut } from "../keyboard";
import { useNow } from "../useNow";
import "../today/TodayPanel.css";
import "./CodingPanel.css";
import { Icon } from "../../ui/icons";
import { UNDO_MS } from "../../ui/feedback";
import { recordUse } from "../../usage/usage";

const TICK_MS = 15_000;
const HUD_MS = 2_400;
const DAY_MS = 24 * 60 * 60_000;
/** Where "编码助手" is in the settings window. */
const SETTINGS_SECTION = "tools";
/** ⌘1 to ⌘9 switch folders. */
const MAX_SHORTCUTS = 9;
const HAS_CHINESE = /[一-鿿]/;
/** A session heard of without a folder. */
const FOLDER_FALLBACK = "未知文件夹";
/** What a turn says when it ended without the pet hearing how. */
const NO_OUTCOME = "没等到这一轮的结果";

const hidePanel = () => void petWindow.hideSelf().catch((reason: unknown) => console.warn("Could not put the panel away", reason));
const openSettings = () => void petWindow.openSettings(SETTINGS_SECTION).catch((reason: unknown) => console.error("Failed to open the settings", reason));

/** A push pin, leaning as one stuck in a board. */
function PinGlyph({ className = "today-glyph" }: { className?: string }) {
  return <Icon name="pin" className={className} />;
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

const pad = (value: number) => String(value).padStart(2, "0");
const startOfDay = (at: number) => { const date = new Date(at); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); };

/** A time of day, with the day when it was not today. */
function clock(at: number, now: number): string {
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return time;
  if (days === 1) return `昨天 ${time}`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
}

/** The time beside a session: how long it has worked or waited, else when it was last heard from. */
function when(session: CodingSession, now: number): string | null {
  if (session.turn === "working") return session.turnStartedAt === undefined ? null : elapsedText(now - session.turnStartedAt);
  if (session.turn === "waiting") {
    const waited = elapsedText(now - session.lastEventAt);
    return waited && `等了 ${waited}`;
  }
  return ago(session.lastEventAt, now);
}

/** What stands under a session's name: what it is on or waits for, or how its last turn came out. Null when the mark already says it all. */
function standing(session: CodingSession): string | null {
  const line = stateLine(session);
  if (isLive(session)) return line;
  return line ? `${stateWord(session)}：${line}` : stateWord(session);
}

/** One turn as the detail shows it: what was asked, and what came of it. */
interface TurnView {
  key: string;
  task?: string;
  /** The mark it gets: a turn put away while still live is over, so it is not shown as going on. */
  mark: TurnState;
  text: string;
  meta: string | null;
}

/** How a turn that is over came out. */
function outcome(turn: TurnState, result: string | undefined): string {
  switch (turn) {
    case "completed": return result ?? "这一轮做完了";
    case "background": return result ?? "后台还在跑";
    case "failed": return result ?? "出错了";
    case "interrupted": return "已打断";
    case "unknown": return "状态未知：很久没有动静";
    default: return NO_OUTCOME;
  }
}

/** When a turn began, and how long it took once it was over. */
function turnMeta(startedAt: number | undefined, endedAt: number | undefined, now: number): string | null {
  if (startedAt === undefined) return endedAt === undefined ? null : clock(endedAt, now);
  if (endedAt === undefined) return `${clock(startedAt, now)} 开始`;
  return `${clock(startedAt, now)}，用了 ${elapsedText(endedAt - startedAt) ?? "不到 1 分"}`;
}

/** The turns the pet heard, the oldest first, the one going on or just over last. */
function turnsOf(session: CodingSession, now: number): TurnView[] {
  const earlier = (session.earlier ?? []).map((turn, index): TurnView => ({
    key: `earlier-${index}-${turn.startedAt ?? turn.endedAt ?? 0}`,
    task: turn.task,
    mark: turn.turn === "working" || turn.turn === "waiting" ? "idle" : turn.turn,
    text: outcome(turn.turn, turn.result),
    meta: turnMeta(turn.startedAt, turn.endedAt, now),
  }));
  if (session.task === undefined && session.turnStartedAt === undefined && session.turnEndedAt === undefined) return earlier;
  const text = session.turn === "working" ? session.activity ?? "在工作"
    : session.turn === "waiting" ? session.asking ?? "在等你确认"
      : outcome(session.turn, session.result);
  return [...earlier, { key: "current", task: session.task, mark: session.turn, text, meta: turnMeta(session.turnStartedAt, session.turnEndedAt, now) }];
}

/** The state at the top of the detail, with how long or how long ago. */
function headline(session: CodingSession, now: number): string {
  if (session.ended) return `会话已关闭，${ago(session.lastEventAt, now)}`;
  const time = when(session, now);
  if (!time) return stateWord(session);
  return session.turn === "working" ? `${stateWord(session)} ${time}` : `${stateWord(session)}，${time}`;
}

function TerminalGlyph() {
  return <Icon name="terminal" className="today-glyph" />;
}

function InboxGlyph() {
  return <Icon name="inbox" className="today-glyph" />;
}

function InfoGlyph() {
  return <Icon name="info" className="today-glyph" />;
}

function BackGlyph() {
  return <Icon name="chevron_left" className="today-glyph" />;
}

function FoldGlyph() {
  return <Icon name="chevron_right" className="today-glyph coding-fold__glyph" />;
}

interface RowProps {
  session: CodingSession;
  now: number;
  /** Its folder's sessions are on different branches: the row says which. */
  branched: boolean;
  closed?: boolean;
  onBack: () => void;
  onDetail: () => void;
}

function Row({ session, now, branched, closed = false, onBack, onDetail }: RowProps) {
  const title = sessionTitle(session);
  const time = when(session, now);
  // A closed session is said once by its group; its last turn is old news, so it keeps to its name.
  const line = closed ? null : standing(session);
  // What was asked last, unless the title already is that.
  const asked = !closed && session.task && session.task !== title ? session.task : null;
  const hint = session.revealable ? "点一下回到它所在的终端" : `点一下复制 ${resumeCommand(session)}，在终端里粘贴就能接着聊`;
  const tip = [title, asked && `你：${asked}`, line, hint].filter(Boolean).join("\n");
  const said = closed ? "已关闭" : `${stateWord(session)}${line && isLive(session) ? `：${line}` : ""}`;
  const does = session.revealable ? "点一下回到终端" : "点一下复制恢复命令";
  return (
    <li className={`today-row coding-row coding-row--${session.turn}${closed ? " coding-row--closed" : ""}`}>
      {/* Going back to the session is what the panel is mostly for, so it is the row's click; the detail is the button beside it. */}
      <button type="button" className="coding-row__main" title={tip} aria-label={`${title}，${said}，${does}`} onClick={onBack}>
        <span className="coding-row__mark"><TurnMark turn={session.turn} /></span>
        <span className="coding-row__body">
          <span className="coding-row__top">
            <strong>{title}</strong>
            {time && <span className="coding-row__time">{time}</span>}
          </span>
          {asked && <span className="coding-row__asked"><span className="coding-row__you">你：</span>{asked}</span>}
          {line && <span className="coding-row__line">{line}</span>}
          {branched && session.branch && <span className="coding-row__where">{session.branch}</span>}
        </span>
      </button>
      <button type="button" className="coding-tool coding-row__info" data-detail={session.id} aria-label={`${title}的详情和最近几轮`} title="详情和最近几轮" onClick={onDetail}><InfoGlyph /></button>
    </li>
  );
}

interface ProjectProps {
  group: ProjectGroup;
  now: number;
  unfolded: boolean;
  onFold: () => void;
  onBack: (session: CodingSession) => void;
  onDetail: (session: CodingSession) => void;
}

const folderName = (group: ProjectGroup) => group.project || FOLDER_FALLBACK;

/** One folder's sessions; the ended ones folded away under one line. */
function Project({ group, now, unfolded, onFold, onBack, onDetail }: ProjectProps) {
  const row = (session: CodingSession, closed = false) => (
    <Row key={session.id} session={session} now={now} branched={group.branched} closed={closed} onBack={() => onBack(session)} onDetail={() => onDetail(session)} />
  );
  return (
    <>
      {group.open.length > 0 && <ul className="coding-rows">{group.open.map((session) => row(session))}</ul>}
      {group.closed.length > 0 && (
        <>
          <button type="button" className={`coding-fold${unfolded ? " is-open" : ""}`} aria-expanded={unfolded} onClick={onFold}>
            <FoldGlyph />已关闭的 {group.closed.length} 个会话
          </button>
          {unfolded && <ul className="coding-rows">{group.closed.map((session) => row(session, true))}</ul>}
        </>
      )}
    </>
  );
}

/** How a folder stands, by its most pressing session: one waiting, else one at work. Null when nothing is going on there. */
function folderState(group: ProjectGroup): "waiting" | "working" | null {
  if (group.open.some((session) => session.turn === "waiting")) return "waiting";
  return group.open.some((session) => session.turn === "working") ? "working" : null;
}

interface FoldersProps {
  groups: ProjectGroup[];
  current: string | null;
  pinned: string | null;
  inboxCount: number;
  onInbox: () => void;
  onPick: (project: string) => void;
}

/** Every folder at once, each with how it stands and how many sessions are open there: a click, or ⌘1 to ⌘9, switches to it. */
function Folders({ groups, current, pinned, inboxCount, onInbox, onPick }: FoldersProps) {
  return (
    <nav className="coding-sidebar" aria-label="项目" data-tauri-drag-region>
      <h1 className="coding-sidebar__title" data-tauri-drag-region>Claude Code</h1>
      <ul>
        <li>
          <button type="button" className={`coding-folder${current === null ? " is-picked" : ""}`} aria-current={current === null ? "page" : undefined} onClick={onInbox}>
            <span className="coding-row__mark coding-folder__mark"><InboxGlyph /></span>
            <span className="coding-folder__name">待处理</span>
            {inboxCount > 0 && <span className="coding-folder__count">{inboxCount}</span>}
          </button>
        </li>
        {groups.map((group, index) => {
          const state = folderState(group);
          const picked = group.project === current;
          const shortcut = index < MAX_SHORTCUTS ? `（⌘${index + 1}）` : "";
          return (
            <li key={group.project}>
              <button
                type="button"
                className={`coding-folder${picked ? " is-picked" : ""}${group.open.length === 0 ? " is-quiet" : ""}`}
                aria-current={picked ? "true" : undefined}
                aria-label={`${folderName(group)}${group.project === pinned ? "（已置顶）" : ""}，${folderSummary(group)}`}
                title={`${folderName(group)}${shortcut}`}
                onClick={() => onPick(group.project)}
              >
                <span className={`coding-row__mark coding-folder__mark coding-folder__mark--${state ?? "none"}`}>{state && <TurnMark turn={state} />}</span>
                <span className="coding-folder__name">{folderName(group)}</span>
                {group.project === pinned && <PinGlyph className="today-glyph coding-folder__pin" />}
                {group.open.length > 0 && <span className="coding-folder__count">{group.open.length}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface InboxRowProps {
  item: InboxItem;
  now: number;
  deferred?: boolean;
  onBack: (session: CodingSession) => void;
  onMark: (key: string, until: number | null) => void;
}

function InboxRow({ item, now, deferred = false, onBack, onMark }: InboxRowProps) {
  const { session, turn, key, at, task, line } = item;
  const status = turn === "waiting" ? "等你处理" : turn === "failed" ? "出错了" : "结果待看";
  // Named as in its folder, so the same session reads the same in both places; the round's question goes under it.
  const title = sessionTitle(session);
  const asked = task && task !== title ? task : null;
  const context = [session.project || FOLDER_FALLBACK, session.branch].filter(Boolean).join(" · ");
  const description = line && line !== status ? `${status}：${line}` : status;
  const openLabel = session.revealable ? "回到终端" : "复制恢复命令";
  return (
    <li className={`today-row coding-row coding-inbox-row coding-row--${turn}`}>
      <button type="button" className="coding-row__main" title={[title, asked && `你：${asked}`, description, context, openLabel].filter(Boolean).join("\n")} onClick={() => onBack(session)}>
        <span className="coding-row__mark"><TurnMark turn={turn} /></span>
        <span className="coding-row__body">
          <span className="coding-row__top"><strong>{title}</strong><span className="coding-row__time">{ago(at, now)}</span></span>
          {asked && <span className="coding-row__asked"><span className="coding-row__you">你：</span>{asked}</span>}
          <span className="coding-row__line">{description}</span>
          <span className="coding-row__where">{context}</span>
          <span className="visually-hidden">{openLabel}</span>
        </span>
      </button>
      {turn !== "waiting" && (
        <div className="coding-inbox-row__actions">
          {deferred
            ? <button type="button" className="ui-button" onClick={() => onMark(key, null)}>移回待处理</button>
            : <button type="button" className="ui-button" onClick={() => onMark(key, Date.now() + SNOOZE_MS)}>30 分钟后看</button>}
          <button type="button" className="ui-button" onClick={() => onMark(key, 0)}>标为已看</button>
        </div>
      )}
    </li>
  );
}

interface DetailProps {
  session: CodingSession;
  now: number;
  onLeave: () => void;
  onReveal: () => void;
  onCopy: () => void;
}

/** One session: where it stands, the way back to it, and the last few things asked of it. */
function SessionDetail({ session, now, onLeave, onReveal, onCopy }: DetailProps) {
  const leave = useRef<HTMLButtonElement>(null);
  const turns = turnsOf(session, now);
  useEffect(() => leave.current?.focus(), []);
  return (
    <>
      <header className="coding-detail" data-tauri-drag-region>
        <button ref={leave} type="button" className="coding-leave" aria-label="回到会话列表" onClick={onLeave}><BackGlyph />{session.project || FOLDER_FALLBACK}</button>
        <h1 className="coding-detail__title" data-tauri-drag-region>{sessionTitle(session)}</h1>
        <p className={`coding-detail__state coding-detail__state--${session.ended ? "closed" : session.turn}`}>
          <span className="coding-row__mark"><TurnMark turn={session.ended ? "idle" : session.turn} /></span>
          <span>{headline(session, now)}</span>
          {session.branch && <span className="coding-detail__branch">分支 {session.branch}</span>}
        </p>
        <div className="coding-detail__actions">
          {session.revealable && <button type="button" className="ui-button ui-button--primary" onClick={onReveal}>回到终端</button>}
          <button type="button" className={`ui-button${session.revealable ? "" : " ui-button--primary"}`} onClick={onCopy}>复制恢复命令</button>
        </div>
        {!session.revealable && <p className="coding-detail__note">{session.ended ? "" : "不知道它在哪个终端，"}在终端里粘贴恢复命令就能接着聊</p>}
      </header>
      {/* Laid out from the bottom, so it opens on the latest turn, as a chat does. */}
      <section className="coding-turns" aria-label="最近几轮，最新的在最下面">
        <div>
          <p className="coding-turns__note">{turns.length > 0 ? "只记宠物开着时问的，每条只留第一行" : "还没记下这个会话里问过什么"}</p>
          <ol>
            {turns.map((turn) => (
              <li key={turn.key} className={`coding-turn coding-turn--${turn.mark}`}>
                {turn.task && <p className="coding-turn__asked"><span className="visually-hidden">你问：</span>{turn.task}</p>}
                <div className="coding-turn__reply">
                  <span className="coding-row__mark"><TurnMark turn={turn.mark} /></span>
                  <div className="coding-turn__body">
                    <p className="coding-turn__text">{turn.text}</p>
                    {turn.meta && <p className="coding-turn__meta">{turn.meta}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

/** How a folder stands, in a sentence under its name. */
function folderSummary(group: ProjectGroup): string {
  const waiting = group.open.filter((session) => session.turn === "waiting").length;
  const working = group.open.filter((session) => session.turn === "working").length;
  const parts = [waiting > 0 && `${waiting} 个等你处理`, working > 0 && `${working} 个在工作`].filter(Boolean);
  if (parts.length > 0) return parts.join("，");
  return group.open.length > 0 ? "现在没有在跑的会话" : "会话都已关闭";
}

/** What to say where the sessions would be, by whether Claude Code is connected. */
function Empty({ hooks, unread }: { hooks: ClaudeHooksState | undefined; unread: boolean }) {
  const connected = hooks?.connected && hooks.current;
  if (unread && !hooks) {
    return (
      <div className="today-empty">
        <TerminalGlyph />
        <strong>读不到 Claude Code 的连接状态</strong>
        <p>过一会儿再打开这个面板；一直这样，可以到设置里重新连接</p>
        <button type="button" className="ui-button coding-connect" onClick={openSettings}>去设置里看看</button>
      </div>
    );
  }
  // Still reading: say nothing yet rather than "not connected" for a moment.
  if (!hooks) return <div className="today-empty"><TerminalGlyph /></div>;
  return (
    <div className="today-empty">
      <TerminalGlyph />
      <strong>{connected ? "还没有会话" : hooks?.connected ? "需要重新连接 Claude Code" : "还没连上 Claude Code"}</strong>
      <p>{connected
        ? "新开的 Claude Code 会话会出现在这里，连接前就开着的要重开一次"
        : hooks?.connected
          ? "AI Pet 换了位置，或新版本多接了事件，重新连接后才收得全"
          : "连上后，这里会列出每个会话在做什么、哪个在等你"}</p>
      {hooks && !connected && <button type="button" className="ui-button ui-button--primary coding-connect" onClick={openSettings}>去设置里连接</button>}
    </div>
  );
}

/**
 * The Claude Code sessions, beside the pet: the folders down the side, a folder
 * with a session waiting for the user first and picked when the panel opens,
 * and the picked folder's sessions beside them. A click on a session goes back
 * to its terminal, or copies the command that reopens it when the pet cannot
 * tell where it runs; the button beside it opens the session's detail, with the
 * last few things asked of it. Ended sessions are folded away at the end.
 */
export function CodingPanel() {
  const sessions = useSyncExternalStore(subscribeCodingSessions, codingSessionsSnapshot);
  const now = useNow(true, TICK_MS);
  const [hooks, setHooks] = useState<ClaudeHooksState | undefined>(undefined);
  /** Whether connected could not be read: not the same as not connected. */
  const [hooksUnread, setHooksUnread] = useState(false);
  /** What went wrong last; it stays until the next thing works. Not cleared when the panel shows again:
   * 「回到终端」 puts the panel away before it knows whether it worked, and a failure is said there. */
  const [failure, setFailure] = useState("");
  const [hud, setHud] = useState<{ text: string; undo?: { key: string; until: number | null } } | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [marks, setMarks] = useState(() => loadInboxMarks());
  /** The folder the user switched to; until then, the one that needs them most. */
  const [chosen, setChosen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  /** The folder the user pinned: first in the list, and where the panel opens. */
  const [pinned, setPinned] = useState<string | null>(() => loadPinnedFolder());
  /** The session whose detail was just left: its button gets the focus back. */
  const left = useRef<string | null>(null);
  const groups = pinnedFirst(byProject(sessions), pinned);
  const group = groups.find((each) => each.project === chosen) ?? groups[0];
  const detail = picked === null ? undefined : sessions.find((session) => session.id === picked);
  const inbox = codingInbox(sessions, marks, now);

  useEffect(() => {
    document.documentElement.classList.add("today-window");
    document.body.classList.add("today-window");
    const readHooks = () => {
      void agentPlatform.state().then((state) => { setHooks(state); setHooksUnread(false); }).catch((reason: unknown) => {
        console.warn("Could not read whether Claude Code is connected", reason);
        setHooksUnread(true);
      });
    };
    // The window is hidden, not closed: each time it shows, it starts from the folder that needs the user most.
    const startOver = () => {
      setInboxOpen(false);
      setChosen(null);
      setPicked(null);
      readHooks();
    };
    readHooks();
    window.addEventListener("focus", readHooks);
    // The card under the pet asks for the folder of the session it is about.
    const showFolder = (folder: string) => {
      setInboxOpen(false);
      setChosen(folder);
      setPicked(null);
    };
    const stops = [petWindow.onShown(startOver), petWindow.onCodingFolderRequested(showFolder)];
    return () => {
      document.documentElement.classList.remove("today-window");
      document.body.classList.remove("today-window");
      window.removeEventListener("focus", readHooks);
      for (const stop of stops) stop();
    };
  }, []);

  const pick = (project: string) => {
    setInboxOpen(false);
    setChosen(project);
    setPicked(null);
  };

  useCloseShortcut(hidePanel);

  // Escape leaves the detail first, then puts the panel away; ⌘1 to ⌘9 switch folders.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (detail) setPicked(null);
        else hidePanel();
        return;
      }
      const digit = Number(event.key);
      if (!event.metaKey || !Number.isInteger(digit) || digit < 1 || digit > MAX_SHORTCUTS) return;
      const target = groups[digit - 1];
      if (!target) return;
      event.preventDefault();
      pick(target.project);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (picked !== null || left.current === null) return;
    document.querySelector<HTMLElement>(`[data-detail="${left.current}"]`)?.focus();
    left.current = null;
  }, [picked]);

  useEffect(() => {
    if (hud === null) return;
    const timer = setTimeout(() => setHud(null), hud.undo ? UNDO_MS : HUD_MS);
    return () => clearTimeout(timer);
  }, [hud]);

  const copy = async (session: CodingSession) => {
    try {
      await navigator.clipboard.writeText(resumeCommand(session));
      setFailure("");
      setHud({ text: `已复制 ${resumeCommand(session)}` });
    } catch (reason) {
      console.error("Failed to copy a resume command", reason);
      setFailure("没能复制，请再试一次。");
    }
  };
  const reveal = (session: CodingSession) => {
    recordUse("coding_reveal");
    agentPlatform.reveal(session.id).then(hidePanel).catch((reason: unknown) => {
      console.error("Could not bring a Claude Code terminal forward", reason);
      const text = String(reason).replace(/^Error:\s*/, "");
      setFailure(HAS_CHINESE.test(text) ? text : "没能切到它所在的终端");
    });
  };
  // Going back to a session, from the inbox or its folder, is reading its finished round; a question keeps waiting.
  const markRead = (session: CodingSession) => {
    const item = [...inbox.pending, ...inbox.later].find((each) => each.session.id === session.id && each.turn !== "waiting");
    if (!item) return;
    try {
      setMarks(saveInboxMark(item.key, 0, inbox.keys));
    } catch (reason) {
      console.error("Failed to save the coding inbox mark", reason);
    }
  };
  const goBack = (session: CodingSession) => {
    markRead(session);
    if (session.revealable) reveal(session);
    else void copy(session);
  };
  const leaveDetail = () => {
    left.current = picked;
    setPicked(null);
  };
  const togglePin = (project: string) => {
    const next = pinned === project ? null : project;
    try {
      savePinnedFolder(next);
      setPinned(next);
      setFailure("");
    } catch (reason) {
      console.error("Failed to save the pinned folder", reason);
      setFailure("没能置顶，请再试一次。");
    }
  };
  const fold = (project: string) => setUnfolded((before) => {
    const next = new Set(before);
    if (!next.delete(project)) next.add(project);
    return next;
  });

  const updateMark = (key: string, until: number | null, undoing = false) => {
    try {
      const previous = marks.find((mark) => mark.key === key)?.until ?? null;
      setMarks(saveInboxMark(key, until, inbox.keys));
      const text = undoing ? "已撤销" : until === 0 ? "已标为已看" : until === null ? "已移回待处理" : "30 分钟后回到待处理";
      setFailure("");
      setHud({ text, undo: undoing ? undefined : { key, until: previous } });
    } catch (reason) {
      console.error("Failed to save the coding inbox mark", reason);
      setFailure("没能保存，请再试一次。");
    }
  };
  const openInbox = () => {
    setInboxOpen(true);
    setPicked(null);
  };

  const stale = sessions.length > 0 && hooks !== undefined && !(hooks.connected && hooks.current);
  const notice = stale && (
    <p className="coding-notice">
      {hooks.connected ? "重新连接后，状态才收得全" : "现在没连着，下面是之前的样子"}
      <button type="button" onClick={openSettings}>{hooks.connected ? "重新连接" : "去连接"}</button>
    </p>
  );
  const undo = hud?.undo;
  const alert = failure && <p className="today-error" role="alert">{failure}</p>;
  const toast = hud && (
    <div className="today-hud" role="status">
      <span>{hud.text}</span>
      {undo && <button type="button" onClick={() => updateMark(undo.key, undo.until, true)}>撤销</button>}
    </div>
  );

  if (!group) {
    return (
      <main className="today-panel coding-panel ui-on-material">
        <header className="today-header" data-tauri-drag-region><h1 data-tauri-drag-region>Claude Code</h1></header>
        <section className="today-list" aria-label="Claude Code 会话"><Empty hooks={hooks} unread={hooksUnread} /></section>
        {alert}
        {toast}
      </main>
    );
  }

  return (
    <main className="today-panel coding-panel coding-panel--split ui-on-material">
      <Folders groups={groups} current={inboxOpen ? null : group.project} pinned={pinned} inboxCount={inbox.pending.length} onInbox={openInbox} onPick={pick} />
      <div className="coding-main">
        {detail ? (
          <SessionDetail session={detail} now={now} onLeave={leaveDetail} onReveal={() => reveal(detail)} onCopy={() => void copy(detail)} />
        ) : inboxOpen ? (
          <>
            <header className="today-header" data-tauri-drag-region>
              <div className="today-header__titles" data-tauri-drag-region>
                <h2 className="coding-main__name" data-tauri-drag-region>待处理</h2>
              </div>
            </header>
            <section className="today-list" aria-label="所有项目的待处理会话">
              {notice}
              {inbox.pending.length > 0 ? (
                <ul className="coding-rows">
                  {inbox.pending.map((item) => <InboxRow key={item.key} item={item} now={now} onBack={goBack} onMark={updateMark} />)}
                </ul>
              ) : <p className="coding-inbox-empty">暂时没有待处理的会话</p>}
              {inbox.later.length > 0 && (
                <details className="coding-inbox-later">
                  <summary>稍后看 · {inbox.later.length}</summary>
                  <ul className="coding-rows">
                    {inbox.later.map((item) => <InboxRow key={item.key} item={item} now={now} deferred onBack={goBack} onMark={updateMark} />)}
                  </ul>
                </details>
              )}
            </section>
          </>
        ) : (
          <>
            <header className="today-header" data-tauri-drag-region>
              <div className="today-header__titles" data-tauri-drag-region>
                <h2 className="coding-main__name" data-tauri-drag-region>{folderName(group)}</h2>
                <p data-tauri-drag-region>{folderSummary(group)}</p>
              </div>
              <button
                type="button"
                className={`coding-tool coding-pin${group.project === pinned ? " is-on" : ""}`}
                aria-pressed={group.project === pinned}
                aria-label="置顶"
                title={group.project === pinned ? "取消置顶" : "置顶：放在最前，打开时先看这个文件夹"}
                onClick={() => togglePin(group.project)}
              >
                <PinGlyph />
              </button>
            </header>
            <section className="today-list" aria-label={`${folderName(group)} 的会话`}>
              {notice}
              <Project
                group={group}
                now={now}
                unfolded={unfolded.has(group.project)}
                onFold={() => fold(group.project)}
                onBack={goBack}
                onDetail={(session) => setPicked(session.id)}
              />
            </section>
          </>
        )}
        {alert}
        {toast}
      </div>
    </main>
  );
}
