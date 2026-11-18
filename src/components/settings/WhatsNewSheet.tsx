import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Feature, ReleaseNotes } from "../../update/WhatsNew";

const GLYPHS: Record<Feature["icon"], ReactNode> = {
  bell: <><path d="M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></>,
  list: <><path d="M9.5 7h9M9.5 12h9M9.5 17h6" /><path d="M5.5 7h.01M5.5 12h.01M5.5 17h.01" /></>,
  text: <><path d="m4.5 19 4.5-13h2l4.5 13M6.8 14h6.4" /><path d="M18.5 3.5v4M16.5 5.5h4" /></>,
  moon: <path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z" />,
};

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
            <span className={`whats-new__tile whats-new__tile--${feature.color}`} aria-hidden="true"><svg viewBox="0 0 24 24">{GLYPHS[feature.icon]}</svg></span>
            <div><strong>{feature.title}</strong><p>{feature.detail}</p></div>
          </li>
        ))}
      </ul>
      {notes.more && <p className="whats-new__more">{notes.more}</p>}
      <button ref={done} type="button" className="whats-new__done" onClick={onClose}>好的</button>
    </div>
  </div>;
}
