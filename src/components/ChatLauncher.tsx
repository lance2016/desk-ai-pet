import type { Ref } from "react";

const ICON = "/chat-launcher/bubble.png";

const LABELS = { copied: "看看刚复制的内容", spoke: "回它一句" };

interface ChatLauncherProps {
  side: "left" | "right";
  hinting: "copied" | "spoke" | null;
  /** Something is said above the pet: the button keeps clear of the bubble. */
  aside: boolean;
  /** On its way out: it fades and takes no clicks. */
  leaving: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The chat button beside the pet's head, on its left or right. It bounces after a copy in another app, or after
 * the pet said something by itself: a click then offers what to do with the copied text, or opens the quick chat
 * bar onto that line. Otherwise it just opens the bar. Only reports the click.
 */
export function ChatLauncher({ side, hinting, aside, leaving, onClick, ref }: ChatLauncherProps) {
  const label = hinting ? LABELS[hinting] : "聊聊天";
  // It bounces once the bubble is gone, not beside it: the line itself is the thing to read first.
  return (
    <button ref={ref} type="button" className={`chat-launcher chat-launcher--${side} pet-tip${hinting && !aside ? " is-hinting" : ""}${aside ? " is-aside" : ""}${leaving ? " is-leaving" : ""}`} aria-label={label} data-tip={label} onClick={onClick}>
      <img src={ICON} alt="" draggable={false} />
    </button>
  );
}
