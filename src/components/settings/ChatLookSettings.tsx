import { chosenPeek, DEFAULT_CHAT_APPEARANCE, pictureFor } from "../../preferences/ChatAppearance";
import { CharacterAvatar } from "../CharacterAvatar";
import { ConfirmButton } from "../ConfirmButton";
import { PeekPicture } from "../PeekPicture";
import { useChatPictures } from "./useChatPictures";

const ROWS = [
  { slot: "avatar", title: "头像", hint: "显示在聊天窗口和角色列表里" },
  { slot: "peek", title: "聊天小人", hint: "趴在聊天输入框上方" },
] as const;

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
  const { appearance, status, set, setPeekHidden, edit, upload, cropper } = useChatPictures(packId, actionImages, onChange);

  return <article className="settings-card ai-settings look-settings">
    {ROWS.map(({ slot, title, hint }) => {
      const value = appearance[slot];
      const hidden = slot === "peek" && chosenPeek(appearance) === "hidden";
      const shown = hidden ? null : pictureFor(value, actionImages);
      const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_CHAT_APPEARANCE[slot]);
      const reset = () => set(slot, DEFAULT_CHAT_APPEARANCE[slot]);
      return <div className="look-row" key={slot}>
        <div className="look-row__head">
          {slot === "peek"
            ? <span className="look-row__preview look-row__preview--peek">{shown ? <PeekPicture picture={shown} className="look-row__peek" /> : "不显示"}</span>
            : <CharacterAvatar picture={shown} className="look-row__preview" />}
          <div><strong>{title}</strong><span>{hint}</span></div>
          <div className="look-choices" role="group" aria-label={`更换${title}`}>
            <label className="look-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event, slot)} /><span>上传图片</span></label>
            {slot === "peek" && <button type="button" aria-pressed={hidden} className={hidden ? "look-hide is-selected" : "look-hide"} onClick={() => setPeekHidden(!hidden)}>不显示</button>}
          </div>
          {!hidden && value !== "hidden" && <button type="button" className="settings-button settings-button--small" onClick={() => void edit(slot)}>调整</button>}
          {/* An uploaded picture is gone once replaced, so that one asks first; the character's own pictures can always be picked again. */}
          {value !== "hidden" && "dataUrl" in value
            ? <ConfirmButton className="text-link" confirm={{ message: `恢复默认的${title}？`, detail: "上传的图片会被删掉，换回角色自己的图片。", action: "恢复默认" }} onConfirm={reset}>恢复默认</ConfirmButton>
            : <button type="button" className="text-link" disabled={isDefault} onClick={reset}>恢复默认</button>}
        </div>
      </div>;
    })}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
    {cropper}
  </article>;
}
