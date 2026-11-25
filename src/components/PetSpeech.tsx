import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { SpeechQueue, fitSpeech, speechDuration } from "../core/SpeechQueue";
import { codingSessionsSnapshot, subscribeCodingSessions } from "../agents/codingStore";
import { petWindow } from "../platform/petWindow";
import type { PetEvents, StatusChip } from "../types";
import { CodingCard, codingHasNews, useCodingNow } from "./CodingCard";
import { speechShown } from "./speechShown";
import { Icon } from "../ui/icons";

interface PetSpeechProps {
  runtime: PetRuntime;
  /** The standing bubble while it is up, or a passing line that can be answered: measured for the clickable area. */
  alertRef?: Ref<HTMLDivElement>;
  /** The status row at the pet's feet, measured for the clickable area. */
  badgeRef?: Ref<HTMLDivElement>;
  /** Called when the standing bubble or the status row comes or goes, so the clickable area is measured again. */
  onLayoutChange?: () => void;
  /** A quick chat answer. While there is one it has the bubble to itself. */
  reply?: ReactNode;
  /** Shown above the pet only while nothing is said there, such as the chat button. */
  idle?: ReactNode;
  hideBadge?: boolean;
  /** There is little room under the pet (at a screen edge, or with the window hanging off the bottom): the coding card keeps to one line. */
  tight?: boolean;
}

type StandingAlert = PetEvents["pet.alert"] & { text: string };

const openReminders = () => void petWindow.openToday().catch((error: unknown) => console.error("Failed to open reminders", error));

const LOTUS = "/focus/lotus.png";

const ALERT_ICONS = { bell: "bell", mail: "mail", timer: "timer", agent: "terminal" } as const;

/** A ring that fills as the focus round or the rest goes by. */
function ProgressRing({ progress }: { progress: number }) {
  return (
    <svg className="status-chip__ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="status-chip__ring-track" cx="8" cy="8" r="6" />
      <circle className="status-chip__ring-fill" cx="8" cy="8" r="6" pathLength={1} strokeDasharray={`${progress} 1`} />
    </svg>
  );
}

function Chip({ chip, onFocusClick, onActivityClick }: { chip: StatusChip; onFocusClick: () => void; onActivityClick: (id: string) => void }) {
  switch (chip.id) {
    case "focus": {
      // The arc under the pet shows how far the round has come, so the pill shows only a lotus and the time.
      const time = chip.label.split(" ")[1];
      return (
        <button type="button" className="status-chip status-chip--focus pet-tip" data-tip="结束专注…" aria-label={`${chip.label}，点一下可以结束`} onClick={onFocusClick}>
          <img className="status-chip__lotus" src={LOTUS} alt="" draggable={false} />
          {time}
        </button>
      );
    }
    case "rest":
      return (
        <button type="button" className="status-chip status-chip--rest pet-tip" data-tip="提前开始专注…" onClick={onFocusClick}>
          <ProgressRing progress={chip.progress ?? 0} />{chip.label}
        </button>
      );
    case "reminders":
      return <button type="button" className="status-chip pet-tip" data-tip="打开提醒" onClick={openReminders}>{chip.label}</button>;
    case "activity": {
      // Running spins; waiting for the user holds still and stands out.
      const mark = <span className={chip.activity?.waiting ? "status-chip__dot" : "status-chip__spinner"} aria-hidden="true" />;
      const look = `status-chip status-chip--activity${chip.activity?.waiting ? " status-chip--asking" : ""}`;
      if (!chip.activity?.cancellable) return <span className={look}>{mark}{chip.label}</span>;
      const { id } = chip.activity;
      return (
        <button type="button" className={`${look} status-chip--stoppable pet-tip`} data-tip={`停止${chip.label}`} aria-label={`${chip.label}，点一下停止`} onClick={() => onActivityClick(id)}>
          {mark}{chip.label}
          <Icon name="close" className="status-chip__close" />
        </button>
      );
    }
    case "dnd":
      return <span className="status-chip status-chip--label">{chip.label}</span>;
  }
}

/**
 * The speech bubble above the pet and the status row at its feet. Passing
 * lines show for a few seconds; a standing line (due reminders, an activity's news, a
 * finished focus round) stays until it is clicked, and a question on it stays
 * until one of its buttons is. A line the pet said by itself can be clicked to
 * answer it. Each part of the status row does its own thing.
 */
export function PetSpeech({ runtime, alertRef, badgeRef, onLayoutChange, reply, idle, hideBadge, tight }: PetSpeechProps) {
  const [line, setLine] = useState<string | null>(null);
  const [alert, setAlert] = useState<StandingAlert | null>(null);
  const [chips, setChips] = useState<StatusChip[]>([]);
  /** What the pet last said by itself, as the bubble shows it: a click on that line answers it. */
  const [ownLine, setOwnLine] = useState<string | null>(null);
  const coding = useSyncExternalStore(subscribeCodingSessions, codingSessionsSnapshot);
  const codingNow = useCodingNow(coding);

  useEffect(() => {
    const queue = new SpeechQueue(setLine);
    const stops = [
      runtime.bus.on("pet.say", ({ text }) => queue.push(text)),
      runtime.bus.on("pet.greeting", ({ text }) => setOwnLine(fitSpeech(text))),
      runtime.bus.on("pet.alert", (next) => setAlert(next.text ? { ...next, text: next.text } : null)),
      runtime.bus.on("pet.badge", ({ chips: next }) => setChips(next)),
    ];
    return () => {
      for (const stop of stops) stop();
      queue.clear();
    };
  }, [runtime]);

  const { line: passing, standing } = speechShown(line, alert, Boolean(reply));
  // The coding card joins the row only while a session has something to say.
  const codingShown = codingHasNews(coding, codingNow);
  const badgeShown = (chips.length > 0 || codingShown) && !hideBadge;
  const idleShown = Boolean(idle) && passing === null && standing === null;
  const answerable = passing !== null && passing === ownLine;
  useEffect(() => { onLayoutChange?.(); }, [standing?.text, badgeShown, idleShown, answerable, onLayoutChange]);

  const dismiss = () => {
    runtime.bus.emit("pet.alert_dismissed", {});
    // The line named only some reminders: show the user all of them.
    if (standing?.more) openReminders();
  };
  const statusRow = badgeShown && (
    <div ref={badgeRef} className="status-row">
      {chips.map((chip) => <Chip key={chip.activity?.id ?? chip.id} chip={chip} onFocusClick={() => runtime.bus.emit("pet.focus_badge_clicked", {})} onActivityClick={(id) => runtime.bus.emit("pet.activity_chip_clicked", { id })} />)}
      {/* Beside other pills, or with little room under the pet, it keeps to one line. */}
      {codingShown && <CodingCard sessions={coding} now={codingNow} compact={chips.length > 0 || Boolean(tight)} />}
    </div>
  );
  if (reply) {
    return (
      <>
        <div className="speech-area" aria-live="polite">{reply}</div>
        {statusRow}
      </>
    );
  }
  // Reminders (the bell) sit on a colored tile, like a notification; other lines keep a plain icon.
  const reminder = standing !== null && !standing.icon;
  const glyph = standing && <Icon name={ALERT_ICONS[standing.icon ?? "bell"]} className="speech-bubble__bell" />;
  const icon = reminder ? <span className="speech-bubble__tile">{glyph}</span> : glyph;
  const heading = standing?.heading && <span className="speech-bubble__heading">{standing.heading}</span>;
  // Lines waiting behind this one: said quietly, so the user knows another comes once this one is answered.
  const queued = standing?.queued ? `还有 ${standing.queued} 条` : null;
  const choiceHeading = (standing?.heading || queued) && (
    <span className="speech-bubble__heading">
      {standing?.heading}
      {queued && <span className="speech-bubble__queued">{standing?.heading ? `，${queued}` : queued}</span>}
    </span>
  );
  // A question about something other than reminders looks calm and holds still. News with a way to it (an agent waiting) keeps the look of news.
  const look = reminder ? " speech-bubble--remind" : standing?.choices && standing.icon !== "agent" ? " speech-bubble--ask" : "";
  const lastChoice = (standing?.choices?.length ?? 0) - 1;
  return (
    <>
      <div className="speech-area" aria-live="polite">
        {idleShown && idle}
        {/* --stay: how long the queue keeps the line up, so the bubble can fade out just before it goes. */}
        {passing && !answerable && <p key={passing} className="speech-bubble speech-bubble--passing" style={{ "--stay": `${speechDuration(passing)}ms` } as CSSProperties}><span className="speech-bubble__spark" aria-hidden="true">✦</span>{passing}</p>}
        {passing && answerable && (
          <div key={passing} ref={alertRef} className="speech-bubble speech-bubble--passing speech-bubble--answer" role="button" tabIndex={-1} style={{ "--stay": `${speechDuration(passing)}ms` } as CSSProperties} onClick={() => runtime.bus.emit("pet.chat_requested", {})}>
            <span className="speech-bubble__spark" aria-hidden="true">✦</span>{passing}
          </div>
        )}
        {standing && (
          <div key={standing.text} ref={alertRef} className={`speech-bubble speech-bubble--alert${look}`}>
            {standing.choices ? (
              <>
                {icon}
                <span className="speech-bubble__body">
                  <span className="speech-bubble__alert-text">{standing.text}</span>
                  {/* The heading shares the button row: the room above the pet has no line to spare. */}
                  <span className="speech-bubble__choices">
                    {choiceHeading}
                    {standing.choices.map((choice, index) => (
                      // As in a Mac alert, the answer most people pick is on the right and filled in.
                      <button key={choice.label} type="button" className={choice.destructive ? "is-destructive" : index === lastChoice ? "is-primary" : undefined} onClick={() => runtime.bus.emit(choice.event, {})}>{choice.label}</button>
                    ))}
                  </span>
                </span>
              </>
            ) : (
              <button type="button" className="speech-bubble__press" onClick={dismiss}>
                {icon}
                <span className="speech-bubble__body">{heading}<span className="speech-bubble__alert-text">{standing.text}</span><small>{standing.more ? "点一下看全部" : "点一下收起"}{queued && `，${queued}`}</small></span>
              </button>
            )}
          </div>
        )}
      </div>
      {statusRow}
    </>
  );
}
