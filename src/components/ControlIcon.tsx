import type { ReactNode } from "react";
import type { ControlIconPreset } from "../types";

interface ControlIconProps {
  name: ControlIconPreset;
}

/** Small, consistent line icons for the pet's quick actions. */
export function ControlIcon({ name }: ControlIconProps) {
  const paths: Record<ControlIconPreset, ReactNode> = {
    feed: <><path d="M4 11h16l-1.4 8H5.4L4 11Z" /><path d="M8 11c.2-3.2 1.7-5 4-5s3.8 1.8 4 5" /><path d="M9 15h.01M12 15h.01M15 15h.01" /></>,
    carrot: <><path d="M7 10 4 7M9 8l1-4M12 8l4-4" /><path d="M8.2 9.2c2.8-2.1 6.1-2.1 8.2 0s2.1 5.4 0 8.2l-2.2 2.4a1.4 1.4 0 0 1-2.4-.8l-.2-1.5-1.5.2a1.4 1.4 0 0 1-1.6-1.6l.2-1.5-1.5-.2a1.4 1.4 0 0 1-.8-2.4l1.8-1.8Z" /></>,
    gift: <><path d="M3 10h18v11H3zM2 6h20v4H2zM12 6v15" /><path d="M12 6H8.5a2 2 0 1 1 2-2c0 1.2 1.5 2 1.5 2ZM12 6h3.5a2 2 0 1 0-2-2c0 1.2-1.5 2-1.5 2Z" /></>,
    wooden_fish: <><path d="M4 13c2.2-3.4 5.1-5.1 8-5.1s5.8 1.7 8 5.1c-2.2 3.4-5.1 5.1-8 5.1S6.2 16.4 4 13Z" /><path d="M12 11.5v3M10.5 13h3" /><path d="m16.5 5 3 2" /></>,
    mallet: <><path d="m14 4 6 6M12.5 5.5l6 6" /><path d="m4 20 9-9 3 3-9 9H4z" /><path d="m3 18 3 3" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /><path d="M12 3V2" /></>,
    rest: <><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z" /><path d="m16.5 5 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" /></>,
    bed: <><path d="M3 18V7M3 15h18v6M21 18V9a2 2 0 0 0-2-2h-5v8M3 11h16a2 2 0 0 1 2 2" /><path d="M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M10 2h4M12 2v3" /></>,
    hourglass: <><path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4" /></>,
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13M9 7h6" /></>,
    sparkle: <><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" /><path d="M19 16.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.3-.2-1.5-.8-2.1-2.2-2.3 1.4-.2 2-.8 2.2-2.2Z" /></>,
    chat: <><path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.4A7.5 7.5 0 1 1 20 12Z" /><path d="M9 12h.01M12.5 12h.01M16 12h.01" /></>,
    checklist: <><path d="m4 6.5 1.5 1.5L8.5 5M4 12.5 5.5 14l3-3M4 18.5 5.5 20l3-3" /><path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20" /></>,
    note: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5M8.5 8.5h7M8.5 12h4" /></>,
    clipboard: <><path d="M9 4h6v3H9z" /><path d="M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 12h7M8.5 16h5" /></>,
  };

  return (
    <svg className="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
