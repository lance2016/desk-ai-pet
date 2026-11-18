import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ReleaseNotes } from "../../update/WhatsNew";
import { FeatureTile } from "./FeatureTile";

/** The phone-style "新功能" sheet: what this version brings, one row per feature. */
export function WhatsNewSheet({ version, notes, onClose }: { version: string; notes: ReleaseNotes; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => done.current?.focus(), []);
  // The only control is the button, so Tab stays on it and Esc closes like it does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); if (event.key === "Escape") onClose(); }
  };

  return <div className="whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" onKeyDown={onKeyDown}>
    <div className="whats-new__card">
      <img className="whats-new__icon" src="/app-icon.png" alt="" />
      <h2 id="whats-new-title">AI Pet {version} 新功能</h2>
      <ul className="whats-new__list">
        {notes.features.map((feature) => (
          <li key={feature.title}>
            <FeatureTile icon={feature.icon} color={feature.color} />
            <div><strong>{feature.title}</strong><p>{feature.detail}</p></div>
          </li>
        ))}
      </ul>
      {notes.more && <p className="whats-new__more">{notes.more}</p>}
      <button ref={done} type="button" className="whats-new__done" onClick={onClose}>好的</button>
    </div>
  </div>;
}
