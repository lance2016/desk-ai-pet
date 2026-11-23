import { useEffect, useState, useSyncExternalStore } from "react";
import { elapsedText } from "../../activity/Activity";
import { isLive, overview, resumeCommand, sessionTitle, stateLine, stateWord, type CodingSession } from "../../agents/CodingSession";
import { codingSessionsSnapshot, subscribeCodingSessions } from "../../agents/codingStore";
import { agentPlatform, type ClaudeHooksState } from "../../platform/agents";
import { petWindow } from "../../platform/petWindow";
import { TurnMark } from "../CodingCard";
import { useNow } from "../useNow";
import "../today/TodayPanel.css";
import "./CodingPanel.css";

const TICK_MS = 15_000;
const HUD_MS = 2_400;
/** Where "编码助手" is in the settings window. */
const SETTINGS_SECTION = "tools";
const HAS_CHINESE = /[一-鿿]/;

const hidePanel = () => void petWindow.hideSelf().catch((reason: unknown) => console.warn("Could not put the panel away", reason));
const openSettings = () => void petWindow.openSettings(SETTINGS_SECTION).catch((reason: unknown) => console.error("Failed to open the settings", reason));

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
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

function CopyGlyph() {
  return <svg className="today-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></svg>;
}

function TerminalGlyph() {
  return <svg className="today-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M13 15h3.5" /></svg>;
}

function Row({ session, now, closed = false, onReveal, onCopy }: { session: CodingSession; now: number; closed?: boolean; onReveal: () => void; onCopy: () => void }) {
  const time = when(session, now);
  // A closed session is said once by its group; its last turn is old news, so it keeps to two short lines.
  const line = closed ? null : standing(session);
  // Going back to its terminal is what a click does when the pet knows where the session runs; otherwise the way back is the command that reopens it.
  const primary = session.revealable ? onReveal : onCopy;
  const hint = session.revealable ? "点一下回到它所在的终端" : `点一下复制 ${resumeCommand(session)}，在终端里粘贴就能接着聊`;
  // The title is cut short; pointing at the row shows all of it, and what it is on.
  const tip = [sessionTitle(session), line, hint].filter(Boolean).join("\n");
  const said = closed ? "已关闭" : `${stateWord(session)}${line && isLive(session) ? `：${line}` : ""}`;
  const does = session.revealable ? "点一下回到终端" : "点一下复制恢复命令";
  return (
    <li className={`today-row coding-row coding-row--${session.turn}${closed ? " coding-row--closed" : ""}`}>
      <button type="button" className="coding-row__main" title={tip} aria-label={`${sessionTitle(session)}，${said}，${does}`} onClick={primary}>
        <span className="coding-row__mark"><TurnMark turn={session.turn} /></span>
        <span className="coding-row__body">
          <span className="coding-row__top">
            <strong>{sessionTitle(session)}</strong>
            {/* Kept even when empty: the copy button takes its place on hover, so the title never reflows. */}
            <span className="coding-row__time">{time}</span>
          </span>
          <span className="coding-row__where">{session.project}{session.branch && <> · {session.branch}</>}</span>
          {line && <span className="coding-row__line">{line}</span>}
        </span>
        {/* What a click does, always in sight: back to the terminal, or copy the command that reopens the session. */}
        <span className="coding-row__does" aria-hidden="true">{session.revealable ? <TerminalGlyph /> : <CopyGlyph />}</span>
      </button>
      {session.revealable && (
        <span className="coding-row__tools">
          <button type="button" className="coding-tool" aria-label="复制恢复命令" title={`复制 ${resumeCommand(session)}`} onClick={onCopy}><CopyGlyph /></button>
        </span>
      )}
    </li>
  );
}

/** How things stand, in a sentence under the title. */
function summary(waiting: number, working: number, recent: number): string {
  const parts = [waiting > 0 && `${waiting} 个等你处理`, working > 0 && `${working} 个在工作`].filter(Boolean);
  if (parts.length > 0) return parts.join("，");
  return recent > 0 ? "现在没有在跑的会话" : "";
}

/** What to say where the sessions would be, by whether Claude Code is connected. */
function Empty({ hooks }: { hooks: ClaudeHooksState | undefined }) {
  const connected = hooks?.connected && hooks.current;
  return (
    <div className="today-empty">
      <TerminalGlyph />
      <strong>{connected ? "还没有会话" : hooks?.connected ? "需要重新连接 Claude Code" : "还没连上 Claude Code"}</strong>
      <p>{connected
        ? "新开的 Claude Code 会话会出现在这里，连接前就开着的要重开一次"
        : hooks?.connected
          ? "AI Pet 换了位置，或新版本多接了事件，重新连接后才收得全"
          : "连上后，这里会列出每个会话在做什么、哪个在等你"}</p>
      {hooks && !connected && <button type="button" className="today-button today-button--primary coding-connect" onClick={openSettings}>去设置里连接</button>}
    </div>
  );
}

/**
 * The Claude Code sessions, beside the pet: the ones waiting for the user first,
 * then the ones at work, then recent ones, then closed ones. A click on a session goes
 * back to its terminal, or copies the command that reopens it when the pet cannot tell
 * where it runs; closed sessions sit apart so the two never look alike.
 */
export function CodingPanel() {
  const sessions = useSyncExternalStore(subscribeCodingSessions, codingSessionsSnapshot);
  const now = useNow(true, TICK_MS);
  const [hooks, setHooks] = useState<ClaudeHooksState | undefined>(undefined);
  const [hud, setHud] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("today-window");
    document.body.classList.add("today-window");
    const refresh = () => void agentPlatform.state().then(setHooks).catch((reason: unknown) => console.warn("Could not read whether Claude Code is connected", reason));
    refresh();
    // The window is hidden, not closed: look again whenever it shows.
    window.addEventListener("focus", refresh);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hidePanel(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("today-window");
      document.body.classList.remove("today-window");
      window.removeEventListener("focus", refresh);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (hud === null) return;
    const timer = setTimeout(() => setHud(null), HUD_MS);
    return () => clearTimeout(timer);
  }, [hud]);

  const copy = async (session: CodingSession) => {
    try {
      await navigator.clipboard.writeText(resumeCommand(session));
      setHud(`已复制 ${resumeCommand(session)}`);
    } catch (reason) {
      console.error("Failed to copy a resume command", reason);
      setHud("没能复制到剪贴板，请再试一次");
    }
  };
  const reveal = (session: CodingSession) => {
    agentPlatform.reveal(session.id).then(hidePanel).catch((reason: unknown) => {
      console.error("Could not bring a Claude Code terminal forward", reason);
      const text = String(reason).replace(/^Error:\s*/, "");
      setHud(HAS_CHINESE.test(text) ? text : "没能切到它所在的终端");
    });
  };

  const view = overview(sessions, now);
  const row = (session: CodingSession, closed = false) => <Row key={session.id} session={session} now={now} closed={closed} onReveal={() => reveal(session)} onCopy={() => void copy(session)} />;
  const stale = sessions.length > 0 && hooks !== undefined && !(hooks.connected && hooks.current);
  const line = summary(view.waiting.length, view.working.length, view.recent.length + view.closed.length);

  return (
    <main className="today-panel coding-panel">
      <header className="today-header">
        <div className="today-header__titles">
          <h1>Claude Code</h1>
          {line && <p>{line}</p>}
        </div>
      </header>

      <section className="today-list" aria-label="Claude Code 会话">
        {stale && (
          <p className="coding-notice">
            {hooks.connected ? "重新连接后，状态才收得全" : "现在没连着，下面是之前的样子"}
            <button type="button" onClick={openSettings}>{hooks.connected ? "重新连接" : "去连接"}</button>
          </p>
        )}
        {sessions.length === 0 ? <Empty hooks={hooks} /> : (
          <>
            {view.waiting.length > 0 && <><h2 className="today-section">需要你处理</h2><ul>{view.waiting.map((session) => row(session))}</ul></>}
            {view.working.length > 0 && <><h2 className="today-section">正在工作</h2><ul>{view.working.map((session) => row(session))}</ul></>}
            {view.recent.length > 0 && <><h2 className="today-section">最近</h2><ul>{view.recent.map((session) => row(session))}</ul></>}
            {view.closed.length > 0 && (
              <>
                <h2 className="today-section">已关闭</h2>
                <ul>{view.closed.map((session) => row(session, true))}</ul>
              </>
            )}
          </>
        )}
      </section>

      {hud && <div className="today-hud" role="status"><span>{hud}</span></div>}
    </main>
  );
}
