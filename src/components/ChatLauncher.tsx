import type { Ref } from "react";

const ICON = "/chat-launcher/bubble.png";

const LABELS = { copied: "看看刚复制的内容", spoke: "回它一句" };

/**
 * The chat button beside the pet's head, on its left or right. It bounces after a copy in another app, or after
 * the pet said something by itself: a click then offers what to do with the copied text, or opens the quick chat
 * bar onto that line. Otherwise it just opens the bar. Only reports the click.
 */
export function ChatLauncher({ side, hinting, onClick, ref }: { side: "left" | "right"; hinting: "copied" | "spoke" | null; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const label = hinting ? LABELS[hinting] : "聊聊天";
  return (
    <button ref={ref} type="button" className={`chat-launcher chat-launcher--${side}${hinting ? " is-hinting" : ""}`} aria-label={label} data-label={label} title={label} onClick={onClick}>
      <img src={ICON} alt="" draggable={false} />
    </button>
  );
}
