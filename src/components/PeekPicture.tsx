import { cropStyle } from "../appearance/pictureCrop";
import { FRAME_ASPECT, type ShownPicture } from "../preferences/ChatAppearance";

/**
 * The character peeking over the chat composer, in a 78 × 64 box. A saved crop places it
 * exactly; otherwise an action image shows its top and an upload stands whole on the bottom edge.
 */
export function PeekPicture({ picture, className }: { picture: ShownPicture; className: string }) {
  const framing = picture.crop ? "peek-picture--cropped" : picture.fromAction ? "peek-picture--top" : "peek-picture--whole";
  return <span className={`peek-picture ${framing} ${className}`} aria-hidden="true">
    <img src={picture.src} alt="" draggable={false} style={picture.crop ? cropStyle(picture.crop, FRAME_ASPECT.peek) : undefined} />
  </span>;
}
