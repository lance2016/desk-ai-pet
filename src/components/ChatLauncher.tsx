import type { Ref } from "react";
import type { ChatLauncher as LauncherStyle } from "../preferences/DisplayPreferences";

const ICONS: Record<Exclude<LauncherStyle, "none">, string> = { corner: "/chat-launcher/corner.png", head: "/chat-launcher/head.png" };

/**
 * The chat button beside the pet. After a copy in another app it lights up; a click then offers
 * what to do with the copied text, and otherwise opens the quick chat bar. Only reports the click.
 */
export function ChatLauncher({ style, hinting, onClick, ref }: { style: Exclude<LauncherStyle, "none">; hinting: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const label = hinting ? "看看刚复制的内容" : "聊聊天";
  return (
    <button ref={ref} type="button" className={`chat-launcher chat-launcher--${style}${hinting ? " is-hinting" : ""}`} aria-label={label} title={label} onClick={onClick}>
      <img src={ICONS[style]} alt="" draggable={false} />
    </button>
  );
}
