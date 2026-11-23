import { useState, type ChangeEvent, type ReactNode } from "react";
import { coverCrop, headCrop, topCrop, type PictureCrop } from "../../appearance/pictureCrop";
import { DEFAULT_CHAT_APPEARANCE, FRAME_ASPECT, MAX_DATA_URL_CHARS, loadChatAppearance, pictureFor, saveChatAppearance, type ChatAppearance, type ChatPicture } from "../../preferences/ChatAppearance";
import { PictureCropper } from "./PictureCropper";
import { shrinkImage } from "./shrinkImage";

/**
 * Longest side of an uploaded picture after shrinking; enough room to zoom in
 * when cropping. A transparent PNG can still be too large to keep, so smaller
 * sides are tried next.
 */
const UPLOAD_SIDES = [512, 384, 256] as const;
const CROPPER_TITLES = { avatar: "调整头像", peek: "调整聊天小人" } as const;

export type ChatPictureSlot = keyof typeof CROPPER_TITLES;

interface Editing { slot: ChatPictureSlot; picture: ChatPicture; src: string; crop: PictureCrop; fallback: PictureCrop }

/** Height over width of an image, read by loading it. */
function imageRatio(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalHeight / image.naturalWidth);
    image.onerror = () => reject(new Error("Could not load the picture"));
    image.src = src;
  });
}

/** How a picture is framed before the user adjusts it: action images keep the old framing, uploads fill the frame. */
function startingCrop(slot: ChatPictureSlot, fromAction: boolean, ratio: number): PictureCrop {
  if (!fromAction) return coverCrop(ratio, FRAME_ASPECT[slot]);
  return slot === "avatar" ? headCrop(ratio, FRAME_ASPECT.avatar) : topCrop(ratio, FRAME_ASPECT.peek);
}

/**
 * The current character's chat pictures and the cropper that changes them, shared by the
 * "形象" card and the big portrait on the character page. Render `cropper` somewhere on the page.
 */
export function useChatPictures(packId: string, actionImages: Record<string, string>, onChange: () => void) {
  const [appearance, setAppearance] = useState(() => loadChatAppearance(packId));
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const update = (next: ChatAppearance) => {
    try { saveChatAppearance(packId, next); setAppearance(next); setStatus(""); onChange(); }
    catch (reason) { console.error("Could not save the chat pictures", reason); setStatus("没能保存：图片太多了，删掉几张自定义图标或头像再试。"); }
  };
  const set = (slot: ChatPictureSlot, picture: ChatPicture | "hidden") => update({ ...appearance, [slot]: picture });
  /** Turns the chat figure off or on; its picture stays. The old "hidden" kept none, so it comes back as the default. */
  const setPeekHidden = (hidden: boolean) => update({ ...appearance, peekHidden: hidden, ...(appearance.peek === "hidden" ? { peek: DEFAULT_CHAT_APPEARANCE.peek } : {}) });
  /** Opens the cropper on the slot's current picture. */
  const edit = async (slot: ChatPictureSlot) => {
    const picture = appearance[slot];
    const shown = pictureFor(picture, actionImages);
    if (!shown || picture === "hidden") return;
    try {
      const fallback = startingCrop(slot, shown.fromAction, shown.crop?.ratio ?? await imageRatio(shown.src));
      setEditing({ slot, picture, src: shown.src, crop: shown.crop ?? fallback, fallback });
    } catch (reason) { console.error("Could not load the picture", reason); setStatus("图片加载失败，请换一张试试。"); }
  };
  // An upload is only saved once the user confirms how it is cropped.
  const upload = async (event: ChangeEvent<HTMLInputElement>, slot: ChatPictureSlot) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      let shrunk = await shrinkImage(file, UPLOAD_SIDES[0]);
      for (const side of UPLOAD_SIDES.slice(1)) {
        if (shrunk.dataUrl.length <= MAX_DATA_URL_CHARS) break;
        shrunk = await shrinkImage(file, side);
      }
      const { dataUrl, ratio } = shrunk;
      if (dataUrl.length > MAX_DATA_URL_CHARS) { setStatus("这张图片太复杂了，存不下。换一张简单些的图片试试。"); return; }
      const fallback = coverCrop(ratio, FRAME_ASPECT[slot]);
      setEditing({ slot, picture: { dataUrl }, src: dataUrl, crop: fallback, fallback });
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "图片处理失败，请换一张试试。"); }
  };

  // Keyed by the picture, so choosing another one inside the cropper starts it afresh.
  const cropper: ReactNode = editing && <PictureCropper key={editing.src} title={CROPPER_TITLES[editing.slot]} src={editing.src} crop={editing.crop} fallback={editing.fallback} frameAspect={FRAME_ASPECT[editing.slot]} round={editing.slot === "avatar"}
    onReplace={(event) => void upload(event, editing.slot)}
    onCancel={() => setEditing(null)} onConfirm={(crop) => {
      // A new chat figure is meant to be seen, so choosing one turns the figure back on.
      update({ ...appearance, [editing.slot]: { ...editing.picture, crop }, ...(editing.slot === "peek" ? { peekHidden: false } : {}) });
      setEditing(null);
    }} />;

  return { appearance, status, set, setPeekHidden, edit, upload, cropper };
}
