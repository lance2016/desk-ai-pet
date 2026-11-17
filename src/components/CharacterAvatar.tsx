import { useState } from "react";
import { cropStyle } from "../appearance/pictureCrop";
import type { ShownPicture } from "../preferences/ChatAppearance";
import "./CharacterAvatar.css";

/** The round frame is square. */
const ROUND = 1;

/**
 * A round character picture. A saved crop places it exactly; otherwise full-body
 * action images are cropped to the head and uploads are shown whole.
 */
export function CharacterAvatar({ picture, className }: { picture: ShownPicture | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const shown = picture && picture.src !== broken ? picture : null;
  const framing = shown?.crop ? "character-avatar--cropped" : shown?.fromAction ? "character-avatar--head" : "";
  const classes = ["character-avatar", framing, className ?? ""].filter(Boolean).join(" ");
  return <span className={classes} aria-hidden="true">
    {shown ? <img src={shown.src} alt="" draggable={false} style={shown.crop ? cropStyle(shown.crop, ROUND) : undefined} onError={() => setBroken(shown.src)} /> : "✦"}
  </span>;
}
