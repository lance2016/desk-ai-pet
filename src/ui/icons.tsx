import type { ReactNode } from "react";

/**
 * Every line icon the app draws, each concept once, on a 24 grid. The stroke, its width and
 * caps come from `.ui-icon` (controls.css), so an icon follows the colour of the text it sits in;
 * a window sets only the size. Names used as data (quick-button presets, feature icons) are kept.
 */
const PATHS = {
  // Actions
  close: <path d="m7 7 10 10M17 7 7 17" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M7 12h10" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <path d="M12 5v8.8M12 18.6v.4" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  clear: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
  edit: <><path d="M5 19h4L19 9l-4-4L5 15v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6m4-6v6" />,
  copy: <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" /><path d="M12 13v7" /></>,
  open: <path d="M14 4h6v6M20 4l-8 8M10 5H5v14h14v-5" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  grip: <path d="M5 9h14M5 15h14" />,
  repeat: <><path d="m17 3 3 3-3 3" /><path d="M4 11v-1a4 4 0 0 1 4-4h12" /><path d="m7 21-3-3 3-3" /><path d="M20 13v1a4 4 0 0 1-4 4H4" /></>,
  chevron_right: <path d="m9 6 6 6-6 6" />,
  chevron_left: <path d="m15 6-6 6 6 6" />,
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  play: <path d="M7.5 5.25v13.5l11.25-6.75Z" />,
  attach: <path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7" />,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" /></>,
  speaker: <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  inbox: <path d="M4 13l3-7h10l3 7v5H4zM4 13h5l1 2h4l1-2h5" />,

  // Things
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 4-4 3 3 5-5 4 4" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  quote: <path d="M4.5 14.25c0-3.75 1.5-6.3 4.5-7.5M4.5 14.25h3.75V18H4.5ZM13.5 14.25c0-3.75 1.5-6.3 4.5-7.5M13.5 14.25h3.75V18H13.5Z" />,
  document: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  note: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5M8.5 8.5h7M8.5 12h4" /></>,
  list: <><path d="M9.5 7h9M9.5 12h9M9.5 17h6" /><path d="M5.5 7h.01M5.5 12h.01M5.5 17h.01" /></>,
  lines: <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />,
  checklist: <><path d="m4 6.5 1.5 1.5L8.5 5M4 12.5 5.5 14l3-3M4 18.5 5.5 20l3-3" /><path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20" /></>,
  clipboard: <><path d="M9 4h6v3H9z" /><path d="M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 12h7M8.5 16h5" /></>,
  calendar_check: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4M8.5 15l2 2 4-4" /></>,
  bookmark: <path d="M7 3h10v18l-5-4-5 4V3Z" />,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13M9 7h6" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 8.5 6 8.5-6" /></>,
  chat: <path d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3H5.5A2.5 2.5 0 0 1 3 14.5v-7A2.5 2.5 0 0 1 5.5 5Z" />,
  link: <path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 2a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1" transform="translate(0 2)" />,
  // A terminal window with its prompt.
  terminal: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M13 15h3.5" /></>,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  braces: <path d="M9 4C7 4 6.5 5 6.5 7v2.5C6.5 11 5.5 12 4 12c1.5 0 2.5 1 2.5 2.5V17c0 2 .5 3 2.5 3M15 4c2 0 2.5 1 2.5 3v2.5c0 1.5 1 2.5 2.5 2.5-1.5 0-2.5 1-2.5 2.5V17c0 2-.5 3-2.5 3" />,
  // Lucide's "settings" gear.
  gear: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></>,
  sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.4-.4-2.4 2.5-2.5Z" />,
  layers: <path d="M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />,
  skills: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /><path d="M16.5 4v6M13.5 7h6" /></>,
  dock: <><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 17h.01M12 17h.01M17 17h.01M8 4h8v6H8z" /></>,
  waveform: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  shield: <><path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z" /></>,
  text: <><path d="m4.5 19 4.5-13h2l4.5 13M6.8 14h6.4" /><path d="M18.5 3.5v4M16.5 5.5h4" /></>,

  // People, the pet and its day
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  user_plus: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6M18 4h3M19.5 2.5v3" /></>,
  heart: <path d="M20 9c0 5-8 10-8 10S4 14 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1Z" />,
  paw: <><path d="M12 20c-3 0-5-1.4-5-3.8 0-2 2.3-3.6 5-3.6s5 1.6 5 3.6c0 2.4-2 3.8-5 3.8Z" /><circle cx="5.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="19" cy="10" r="2" /></>,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-1V5a1.5 1.5 0 0 1 3 0v6m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4.2-2.3L4.5 15A1.5 1.5 0 0 1 7 13.4L8 15" />,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  // "互动" under the pet: a face for the menu of things to do with it.
  face: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9 10h.01M15 10h.01" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /><path d="M12 3V2" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M10 2h4M12 2v3" /></>,
  hourglass: <path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  rest: <><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z" /><path d="m16.5 5 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" /></>,
  sleep: <path d="M4 10h6l-6 7h6M14 4h6l-6 7h6" />,
  bed: <><path d="M3 18V7M3 15h18v6M21 18V9a2 2 0 0 0-2-2h-5v8M3 11h16a2 2 0 0 1 2 2" /><path d="M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></>,
  sparkle: <><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" /><path d="M19 16.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.3-.2-1.5-.8-2.1-2.2-2.3 1.4-.2 2-.8 2.2-2.2Z" /></>,
  feed: <><path d="M4 11h16l-1.4 8H5.4L4 11Z" /><path d="M8 11c.2-3.2 1.7-5 4-5s3.8 1.8 4 5" /><path d="M9 15h.01M12 15h.01M15 15h.01" /></>,
  carrot: <><path d="M7 10 4 7M9 8l1-4M12 8l4-4" /><path d="M8.2 9.2c2.8-2.1 6.1-2.1 8.2 0s2.1 5.4 0 8.2l-2.2 2.4a1.4 1.4 0 0 1-2.4-.8l-.2-1.5-1.5.2a1.4 1.4 0 0 1-1.6-1.6l.2-1.5-1.5-.2a1.4 1.4 0 0 1-.8-2.4l1.8-1.8Z" /></>,
  gift: <><path d="M3 10h18v11H3zM2 6h20v4H2zM12 6v15" /><path d="M12 6H8.5a2 2 0 1 1 2-2c0 1.2 1.5 2 1.5 2ZM12 6h3.5a2 2 0 1 0-2-2c0 1.2-1.5 2-1.5 2Z" /></>,
  // A wooden fish seen from the front: a round body with its wide slit.
  wooden_fish: <><path d="M3.5 13.5C3.5 9.4 7.3 6.5 12 6.5s8.5 2.9 8.5 7c0 3.9-3.8 6.5-8.5 6.5s-8.5-2.6-8.5-6.5Z" /><path d="M6.5 13.5c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2" /><path d="M6.5 13.5h11" /></>,
  mallet: <><path d="m14 4 6 6M12.5 5.5l6 6" /><path d="m4 20 9-9 3 3-9 9H4z" /><path d="m3 18 3 3" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? `ui-icon ${className}` : "ui-icon"} viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}
