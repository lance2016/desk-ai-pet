import { useEffect, useState, type ReactNode, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { SpeechQueue } from "../core/SpeechQueue";
import { petWindow } from "../platform/petWindow";

interface PetSpeechProps {
  runtime: PetRuntime;
  /** The standing bubble while it is up, measured for the clickable area. */
  alertRef?: Ref<HTMLButtonElement>;
  /** The badge at the pet's feet, measured for the clickable area. */
  badgeRef?: Ref<HTMLButtonElement>;
  /** Called when the standing bubble or the badge comes or goes, so the clickable area is measured again. */
  onLayoutChange?: () => void;
  /** A quick chat answer. While there is one it has the bubble to itself. */
  reply?: ReactNode;
  hideBadge?: boolean;
}

const openReminders = () => void petWindow.openToday().catch((error: unknown) => console.error("Failed to open reminders", error));

/**
 * The speech bubble above the pet and the status badge at its feet. Passing
 * lines show for a few seconds; a standing line (due reminders, a finished
 * focus round) stays until it is clicked. The standing line and the badge take
 * the mouse; the badge opens the reminders panel.
 */
export function PetSpeech({ runtime, alertRef, badgeRef, onLayoutChange, reply, hideBadge }: PetSpeechProps) {
  const [line, setLine] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ text: string; more: boolean } | null>(null);
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    const queue = new SpeechQueue(setLine);
    const stops = [
      runtime.bus.on("pet.say", ({ text }) => queue.push(text)),
      runtime.bus.on("pet.alert", ({ text, more }) => setAlert(text ? { text, more: more ?? false } : null)),
      runtime.bus.on("pet.badge", ({ text }) => setBadge(text)),
    ];
    return () => {
      for (const stop of stops) stop();
      queue.clear();
    };
  }, [runtime]);

  // A passing line borrows the bubble for a moment; the standing one comes back after it.
  const standing = line === null && !reply ? alert : null;
  const badgeShown = badge !== null && !hideBadge;
  useEffect(() => { onLayoutChange?.(); }, [standing?.text, badgeShown, onLayoutChange]);

  const dismiss = () => {
    runtime.bus.emit("pet.alert_dismissed", {});
    // The line named only some reminders: show the user all of them.
    if (standing?.more) openReminders();
  };
  const badgeButton = badgeShown && (
    <button ref={badgeRef} type="button" className="status-badge" title="打开提醒" onClick={openReminders}>{badge}</button>
  );
  if (reply) {
    return (
      <>
        <div className="speech-area" aria-live="polite">{reply}</div>
        {badgeButton}
      </>
    );
  }
  return (
    <>
      <div className="speech-area" aria-live="polite">
        {line && <p key={line} className="speech-bubble"><span className="speech-bubble__spark" aria-hidden="true">✦</span>{line}</p>}
        {standing && (
          <button type="button" key={standing.text} ref={alertRef} className="speech-bubble speech-bubble--alert" title={standing.more ? "点一下看全部提醒" : "点一下收起"} onClick={dismiss}>
            <svg className="speech-bubble__bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>
            <span><span className="speech-bubble__alert-text">{standing.text}</span><small>{standing.more ? "点一下看全部" : "点一下收起"}</small></span>
          </button>
        )}
      </div>
      {badgeButton}
    </>
  );
}
