import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { elapsedText } from "../activity/Activity";
import { overview, sessionTitle, stateLine, stateWord, type CodingOverview, type CodingSession } from "../agents/CodingSession";
import { petWindow } from "../platform/petWindow";
import { useNow } from "./useNow";

/** Whole minutes are shown, and a result stops being news after a few of them. */
const TICK_MS = 15_000;

/** The time the card goes by, kept up to date while a session is at work or has news that will go stale. */
export const useCodingNow = (sessions: readonly CodingSession[]): number =>
  useNow(sessions.some((session) => session.turnEndedAt !== undefined || session.turn === "working"), TICK_MS);

/** Whether the card has anything to say: a session at work, waiting for the user, or just done. */
export const codingHasNews = (sessions: readonly CodingSession[], now: number): boolean => overview(sessions, now).headline !== null;

const openCoding = () => void petWindow.openCoding().catch((error: unknown) => console.error("Failed to open the coding sessions", error));

/** How the session's turn stands, as a small mark: spinning while it works, still otherwise. */
export function TurnMark({ turn }: { turn: CodingSession["turn"] }) {
  if (turn === "working") return <span className="status-chip__spinner" aria-hidden="true" />;
  if (turn === "waiting") return <span className="status-chip__dot" aria-hidden="true" />;
  if (turn === "completed") return <svg className="coding-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5.2" /></svg>;
  if (turn === "failed") return <svg className="coding-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v4.4M6 9.3v.2" /></svg>;
  return <span className="coding-mark coding-mark--quiet" aria-hidden="true" />;
}

/** How things stand across the sessions: the counts when several are going, else the one session's state and how long it has worked. */
function standing({ waiting, working }: CodingOverview, head: CodingSession, now: number): string {
  if (waiting.length + working.length > 1) {
    return [waiting.length > 0 && `${waiting.length} 个等你`, working.length > 0 && `${working.length} 个在工作`].filter(Boolean).join("，");
  }
  const elapsed = head.turn === "working" && head.turnStartedAt !== undefined ? elapsedText(now - head.turnStartedAt) : null;
  return elapsed ? `${stateWord(head)} ${elapsed}` : stateWord(head);
}

/** Whether any of these lines is cut short. Measured after each render: it depends on the words. */
function useCut(lines: RefObject<HTMLElement | null>[]): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    setCut(lines.some(({ current }) => current !== null && current.scrollWidth > current.clientWidth + 1));
  });
  return cut;
}

/**
 * The whole of a cut title and line, above the card while it is pointed at. The pet window
 * does not take the app's focus, so the system's own tooltip does not show there.
 */
function Full({ title, line }: { title: string; line: string }) {
  return (
    <span className="coding-full" aria-hidden="true">
      <strong>{title}</strong>
      {line && <span>{line}</span>}
    </span>
  );
}

/**
 * Claude Code's sessions under the quick buttons, as one card about the session
 * that most needs the user: who it is and how things stand, what it is about,
 * and where. Beside other pills it keeps to one line. With nothing going on it
 * is not there: the sessions are a quick button or a menu item away. A click opens all the sessions.
 */
export function CodingCard({ sessions, compact, now }: { sessions: readonly CodingSession[]; compact: boolean; now: number }) {
  const titleRef = useRef<HTMLElement>(null);
  const metaRef = useRef<HTMLElement>(null);
  const cut = useCut([titleRef, metaRef]);
  const view = overview(sessions, now);
  const head = view.headline;
  if (!head) return null;

  const title = sessionTitle(head);
  const state = standing(view, head, now);
  const others = view.waiting.length + view.working.length - 1;
  if (compact) {
    return (
      <button type="button" className={`status-chip coding-pill coding-pill--${head.turn}`} aria-label={`Claude Code，${state}：${title}`} title="看看 Claude Code 的会话" onClick={openCoding}>
        <TurnMark turn={head.turn} />
        <span ref={titleRef} className="coding-pill__title">{title}</span>
        {others > 0 && <span className="coding-pill__more">+{others}</span>}
        {cut && <Full title={title} line={stateLine(head) ?? ""} />}
      </button>
    );
  }
  const detail = stateLine(head) ?? head.branch;
  const meta = detail ? `${head.project} · ${detail}` : head.project;
  return (
    <button type="button" className={`coding-card coding-card--${head.turn}`} aria-label={`Claude Code，${state}：${title}。点一下看全部会话`} onClick={openCoding}>
      <span className="coding-card__head">
        <TurnMark turn={head.turn} />
        <span className="coding-card__who">Claude Code</span>
        <span className="coding-card__state">{state}</span>
      </span>
      <strong ref={titleRef} className="coding-card__title">{title}</strong>
      <span ref={metaRef} className="coding-card__meta">{meta}</span>
      {cut && <Full title={title} line={meta} />}
    </button>
  );
}
