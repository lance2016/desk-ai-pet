import { useEffect, useState, type ReactNode, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { SpeechQueue } from "../core/SpeechQueue";
import { mailCodePlatform } from "../platform/mailCode";
import { petWindow } from "../platform/petWindow";
import type { PetEvents, StatusChip } from "../types";

interface PetSpeechProps {
  runtime: PetRuntime;
  /** The standing bubble while it is up, measured for the clickable area. */
  alertRef?: Ref<HTMLDivElement>;
  /** The status row at the pet's feet, measured for the clickable area. */
  badgeRef?: Ref<HTMLDivElement>;
  /** Called when the standing bubble or the status row comes or goes, so the clickable area is measured again. */
  onLayoutChange?: () => void;
  /** A quick chat answer. While there is one it has the bubble to itself. */
  reply?: ReactNode;
  hideBadge?: boolean;
}

type StandingAlert = PetEvents["pet.alert"] & { text: string };

const openReminders = () => void petWindow.openToday().catch((error: unknown) => console.error("Failed to open reminders", error));
const cancelMailCode = () => void mailCodePlatform.cancel().catch((error: unknown) => console.error("Failed to stop waiting for a mail code", error));

const ALERT_ICONS = {
  bell: <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />,
  mail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  timer: <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2.5 2M10 2h4" />,
};

/** A ring that fills as the focus round or the rest goes by. */
function ProgressRing({ progress }: { progress: number }) {
  return (
    <svg className="status-chip__ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="status-chip__ring-track" cx="8" cy="8" r="6" />
      <circle className="status-chip__ring-fill" cx="8" cy="8" r="6" pathLength={1} strokeDasharray={`${progress} 1`} />
    </svg>
  );
}

function Chip({ chip, onFocusClick }: { chip: StatusChip; onFocusClick: () => void }) {
  switch (chip.id) {
    case "focus":
    case "rest":
      return (
        <button type="button" className={`status-chip status-chip--${chip.id}`} title={chip.id === "focus" ? "专注中，点一下可以停止" : "休息中，点一下可以提前开始"} onClick={onFocusClick}>
          <ProgressRing progress={chip.progress ?? 0} />{chip.label}
        </button>
      );
    case "reminders":
      return <button type="button" className="status-chip" title="打开提醒" onClick={openReminders}>{chip.label}</button>;
    case "mail_code":
      return (
        <button type="button" className="status-chip status-chip--waiting" title="停止等验证码" aria-label={`${chip.label}，点一下停止`} onClick={cancelMailCode}>
          <span className="status-chip__spinner" aria-hidden="true" />{chip.label}
          <svg className="status-chip__close" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" /></svg>
        </button>
      );
    case "dnd":
      return <span className="status-chip status-chip--label">{chip.label}</span>;
  }
}

/**
 * The speech bubble above the pet and the status row at its feet. Passing
 * lines show for a few seconds; a standing line (due reminders, a mail code, a
 * finished focus round) stays until it is clicked, and a question on it stays
 * until one of its buttons is. Each part of the status row does its own thing.
 */
export function PetSpeech({ runtime, alertRef, badgeRef, onLayoutChange, reply, hideBadge }: PetSpeechProps) {
  const [line, setLine] = useState<string | null>(null);
  const [alert, setAlert] = useState<StandingAlert | null>(null);
  const [chips, setChips] = useState<StatusChip[]>([]);

  useEffect(() => {
    const queue = new SpeechQueue(setLine);
    const stops = [
      runtime.bus.on("pet.say", ({ text }) => queue.push(text)),
      runtime.bus.on("pet.alert", (next) => setAlert(next.text ? { ...next, text: next.text } : null)),
      runtime.bus.on("pet.badge", ({ chips: next }) => setChips(next)),
    ];
    return () => {
      for (const stop of stops) stop();
      queue.clear();
    };
  }, [runtime]);

  // A passing line borrows the bubble for a moment; the standing one comes back after it.
  const standing = line === null && !reply ? alert : null;
  const badgeShown = chips.length > 0 && !hideBadge;
  useEffect(() => { onLayoutChange?.(); }, [standing?.text, badgeShown, onLayoutChange]);

  const dismiss = () => {
    runtime.bus.emit("pet.alert_dismissed", {});
    // The line named only some reminders: show the user all of them.
    if (standing?.more) openReminders();
  };
  const statusRow = badgeShown && (
    <div ref={badgeRef} className="status-row">
      {chips.map((chip) => <Chip key={chip.id} chip={chip} onFocusClick={() => runtime.bus.emit("pet.focus_badge_clicked", {})} />)}
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
  const icon = standing && <svg className="speech-bubble__bell" viewBox="0 0 24 24" aria-hidden="true">{ALERT_ICONS[standing.icon ?? "bell"]}</svg>;
  // Reminders (the bell) keep their loud look with buttons; a question about something else looks calm.
  const look = !standing?.choices ? "" : standing.icon ? " speech-bubble--ask" : " speech-bubble--remind";
  return (
    <>
      <div className="speech-area" aria-live="polite">
        {line && <p key={line} className="speech-bubble"><span className="speech-bubble__spark" aria-hidden="true">✦</span>{line}</p>}
        {standing && (
          <div key={standing.text} ref={alertRef} className={`speech-bubble speech-bubble--alert${look}`}>
            {standing.choices ? (
              <>
                {icon}
                <span className="speech-bubble__body">
                  <span className="speech-bubble__alert-text">{standing.text}</span>
                  <span className="speech-bubble__choices">
                    {standing.choices.map((choice) => (
                      <button key={choice.label} type="button" className={choice.destructive ? "is-destructive" : undefined} onClick={() => runtime.bus.emit(choice.event, {})}>{choice.label}</button>
                    ))}
                  </span>
                </span>
              </>
            ) : (
              <button type="button" className="speech-bubble__press" title={standing.more ? "点一下看全部提醒" : "点一下收起"} onClick={dismiss}>
                {icon}
                <span><span className="speech-bubble__alert-text">{standing.text}</span><small>{standing.more ? "点一下看全部" : "点一下收起"}</small></span>
              </button>
            )}
          </div>
        )}
      </div>
      {statusRow}
    </>
  );
}
