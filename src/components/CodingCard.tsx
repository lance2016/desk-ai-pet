import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { elapsedText } from "../activity/Activity";
import { overview, sessionTitle, stateLine, stateWord, type CodingOverview, type CodingSession } from "../agents/CodingSession";
import { petWindow } from "../platform/petWindow";
import { useNow } from "./useNow";
import { Icon } from "../ui/icons";

/** Whole minutes are shown, and a result stops being news after a few of them. */
const TICK_MS = 15_000;

/** The time the card goes by, kept up to date while a session is at work or has news that will go stale. */
export const useCodingNow = (sessions: readonly CodingSession[]): number =>
  useNow(sessions.some((session) => session.turnEndedAt !== undefined || session.turn === "working"), TICK_MS);

/** Whether the card has anything to say: a session at work, waiting for the user, or just done. */
export const codingHasNews = (sessions: readonly CodingSession[], now: number): boolean => overview(sessions, now).headline !== null;

/** Opens the sessions on the folder of the one the card is about, not the pinned one: that is what the user clicked. */
const openCoding = (folder: string) => void petWindow.openCoding(folder).catch((error: unknown) => console.error("Failed to open the coding sessions", error));

/** How the session's turn stands, as a small mark: spinning while it works, still otherwise. */
export function TurnMark({ turn }: { turn: CodingSession["turn"] }) {
  if (turn === "working") return <span className="status-chip__spinner" aria-hidden="true" />;
  if (turn === "waiting") return <span className="status-chip__dot" aria-hidden="true" />;
  if (turn === "completed") return <Icon name="check" className="coding-mark" />;
  if (turn === "failed") return <Icon name="alert" className="coding-mark" />;
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

/** Turns that need the user get the whole card; one at work or just done needs nothing from them, and keeps to a line. */
const CARD_TURNS: ReadonlySet<CodingSession["turn"]> = new Set(["waiting", "failed"]);

/**
 * Claude Code's sessions under the quick buttons, about the session that most
 * needs the user. When it waits for them or went wrong, a card: who it is and how
 * things stand, what it is about, and where. Otherwise, beside other pills, or with
 * little room, one line. With nothing going on it is not there: the sessions are a
 * quick button or a menu item away. A click opens all the sessions.
 */
export function CodingCard({ sessions, compact, now }: { sessions: readonly CodingSession[]; compact: boolean; now: number }) {
  const titleRef = useRef<HTMLElement>(null);
  const cut = useCut([titleRef]);
  const view = overview(sessions, now);
  const head = view.headline;
  if (!head) return null;

  const title = sessionTitle(head);
  const state = standing(view, head, now);
  const others = view.waiting.length + view.working.length - 1;
  if (compact || !CARD_TURNS.has(head.turn)) {
    // A cut title shows whole in the pill's help tag. The card has none: its cut lines are a summary, and a click shows them in full.
    return (
      <button type="button" className={`status-chip coding-pill coding-pill--${head.turn}${cut ? " pet-tip" : ""}`} data-tip={cut ? title : undefined} aria-label={`Claude Code，${state}：${title}`} onClick={() => openCoding(head.project)}>
        <TurnMark turn={head.turn} />
        {/* The mark alone would read a finished turn as a finished task. With one session, how long it has worked too. */}
        <span className="coding-pill__state">{others > 0 ? stateWord(head) : state}</span>
        <span ref={titleRef} className="coding-pill__title">{title}</span>
        {others > 0 && <span className="coding-pill__more">+{others}</span>}
      </button>
    );
  }
  const detail = stateLine(head) ?? head.branch;
  const meta = detail ? `${head.project} · ${detail}` : head.project;
  return (
    <button type="button" className={`coding-card coding-card--${head.turn}`} aria-label={`Claude Code，${state}：${title}。点一下看全部会话`} onClick={() => openCoding(head.project)}>
      <span className="coding-card__head">
        <TurnMark turn={head.turn} />
        <span className="coding-card__who">Claude Code</span>
        <span className="coding-card__state">{state}</span>
      </span>
      <strong className="coding-card__title">{title}</strong>
      <span className="coding-card__meta">{meta}</span>
    </button>
  );
}
