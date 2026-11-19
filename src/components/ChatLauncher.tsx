import type { Ref } from "react";

const ICON = "/chat-launcher/bubble.png";

/**
 * The chat button beside the pet's head, on its left or right. After a copy in another app it bounces;
 * a click then offers what to do with the copied text, and otherwise opens the quick chat bar. Only reports the click.
 */
export function ChatLauncher({ side, hinting, onClick, ref }: { side: "left" | "right"; hinting: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const label = hinting ? "看看刚复制的内容" : "聊聊天";
  return (
    <button ref={ref} type="button" className={`chat-launcher chat-launcher--${side}${hinting ? " is-hinting" : ""}`} aria-label={label} title={label} onClick={onClick}>
      <img src={ICON} alt="" draggable={false} />
    </button>
  );
}
