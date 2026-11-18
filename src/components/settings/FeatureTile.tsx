import type { ReactNode } from "react";
import type { FeatureColor, FeatureIcon } from "../../guide/featureIcons";

const GLYPHS: Record<FeatureIcon, ReactNode> = {
  chat: <path d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3H5.5A2.5 2.5 0 0 1 3 14.5v-7A2.5 2.5 0 0 1 5.5 5Z" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-1V5a1.5 1.5 0 0 1 3 0v6m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4.2-2.3L4.5 15A1.5 1.5 0 0 1 7 13.4L8 15" />,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  sparkle: <><path d="m11 3 1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7Z" /><path d="M18.5 15v5M16 17.5h5" /></>,
  sleep: <path d="M4 10h6l-6 7h6M14 4h6l-6 7h6" />,
  bell: <><path d="M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  note: <><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14 3v5h5M9 12.5h7M9 16.5h5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></>,
  list: <><path d="M9.5 7h9M9.5 12h9M9.5 17h6" /><path d="M5.5 7h.01M5.5 12h.01M5.5 17h.01" /></>,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 2M9.5 2.5h5" /></>,
  text: <><path d="m4.5 19 4.5-13h2l4.5 13M6.8 14h6.4" /><path d="M18.5 3.5v4M16.5 5.5h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 8.5 6 8.5-6" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  heart: <path d="M20 9c0 5-8 10-8 10S4 14 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1Z" />,
  moon: <path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  paw: <><path d="M12 20c-3 0-5-1.4-5-3.8 0-2 2.3-3.6 5-3.6s5 1.6 5 3.6c0 2.4-2 3.8-5 3.8Z" /><circle cx="5.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="19" cy="10" r="2" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" /></>,
};

/** A feature's icon on a system-coloured rounded square, like the icons in macOS System Settings. */
export function FeatureTile({ icon, color }: { icon: FeatureIcon; color: FeatureColor }) {
  return <span className={`feature-tile feature-tile--${color}`} aria-hidden="true"><svg viewBox="0 0 24 24">{GLYPHS[icon]}</svg></span>;
}
