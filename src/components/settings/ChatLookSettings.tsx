import { useState, type ChangeEvent } from "react";
import { coverCrop, headCrop, topCrop, type PictureCrop } from "../../appearance/pictureCrop";
import { DEFAULT_CHAT_APPEARANCE, FRAME_ASPECT, MAX_DATA_URL_CHARS, loadChatAppearance, pictureFor, saveChatAppearance, type ChatAppearance, type ChatPicture } from "../../preferences/ChatAppearance";
import { CharacterAvatar } from "../CharacterAvatar";
import { PeekPicture } from "../PeekPicture";
import { PictureCropper } from "./PictureCropper";
import { shrinkImage } from "./shrinkImage";

/**
 * Longest side of an uploaded picture after shrinking; enough room to zoom in
 * when cropping. A transparent PNG can still be too large to keep, so smaller
 * sides are tried next.
 */
const UPLOAD_SIDES = [512, 384, 256] as const;
const ROWS = [
  { slot: "avatar", title: "头像", hint: "显示在聊天窗口和角色列表里" },
  { slot: "peek", title: "聊天小人", hint: "趴在聊天输入框上方" },
] as const;
type Slot = (typeof ROWS)[number]["slot"];

interface Editing { slot: Slot; picture: ChatPicture; src: string; crop: PictureCrop; fallback: PictureCrop }

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
function startingCrop(slot: Slot, fromAction: boolean, ratio: number): PictureCrop {
  if (!fromAction) return coverCrop(ratio, FRAME_ASPECT[slot]);
  return slot === "avatar" ? headCrop(ratio, FRAME_ASPECT.avatar) : topCrop(ratio, FRAME_ASPECT.peek);
}

interface Props {
  packId: string;
  actionImages: Record<string, string>;
  /** Called after a change, so lists showing the avatar can refresh. */
  onChange: () => void;
}

/**
 * Pictures used for the current character in the chat window: the character's
 * default picture, or one the user uploads and crops. The chat figure can also be hidden.
 */
export function ChatLookSettings({ packId, actionImages, onChange }: Props) {
  const [appearance, setAppearance] = useState(() => loadChatAppearance(packId));
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const update = (next: ChatAppearance) => {
    try { saveChatAppearance(packId, next); setAppearance(next); setStatus(""); onChange(); }
    catch (reason) { console.error("Could not save the chat pictures", reason); setStatus("没能保存：图片太多了，删掉几张自定义图标或头像再试。"); }
  };
  const set = (slot: Slot, picture: ChatPicture | "hidden") => update({ ...appearance, [slot]: picture });
  /** Opens the cropper on the slot's current picture, or on a picture that is not saved yet. */
  const edit = async (slot: Slot, picture: ChatPicture | "hidden") => {
    const shown = pictureFor(picture, actionImages);
    if (!shown || picture === "hidden") return;
    try {
      const fallback = startingCrop(slot, shown.fromAction, shown.crop?.ratio ?? await imageRatio(shown.src));
      setEditing({ slot, picture, src: shown.src, crop: shown.crop ?? fallback, fallback });
    } catch (reason) { console.error("Could not load the picture", reason); setStatus("图片加载失败，请换一张试试。"); }
  };
  // An upload is only saved once the user confirms how it is cropped.
  const upload = async (event: ChangeEvent<HTMLInputElement>, slot: Slot) => {
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

  return <article className="settings-card ai-settings look-settings">
    {ROWS.map(({ slot, title, hint }) => {
      const value = appearance[slot];
      const shown = pictureFor(value, actionImages);
      return <div className="look-row" key={slot}>
        <div className="look-row__head">
          {slot === "peek"
            ? <span className="look-row__preview look-row__preview--peek">{shown ? <PeekPicture picture={shown} className="look-row__peek" /> : "不显示"}</span>
            : <CharacterAvatar picture={shown} className="look-row__preview" />}
          <div><strong>{title}</strong><span>{hint}</span></div>
          {value !== "hidden" && <button type="button" className="look-row__reset" onClick={() => void edit(slot, value)}>调整</button>}
          <button type="button" className="look-row__reset" onClick={() => set(slot, DEFAULT_CHAT_APPEARANCE[slot])}>恢复默认</button>
        </div>
        <div className="look-choices" role="group" aria-label={`更换${title}`}>
          <label className="look-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event, slot)} /><span>上传图片</span></label>
          {slot === "peek" && <button type="button" aria-pressed={value === "hidden"} className={value === "hidden" ? "look-hide is-selected" : "look-hide"} onClick={() => set(slot, "hidden")}>不显示</button>}
        </div>
      </div>;
    })}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
    {editing && <PictureCropper title={editing.slot === "avatar" ? "调整头像" : "调整聊天小人"} src={editing.src} crop={editing.crop} fallback={editing.fallback} frameAspect={FRAME_ASPECT[editing.slot]} round={editing.slot === "avatar"}
      onCancel={() => setEditing(null)} onConfirm={(crop) => { set(editing.slot, { ...editing.picture, crop }); setEditing(null); }} />}
  </article>;
}
