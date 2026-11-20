import { DEFAULT_CHAT_APPEARANCE, pictureFor } from "../../preferences/ChatAppearance";
import { CharacterAvatar } from "../CharacterAvatar";
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
  const { appearance, status, set, edit, upload, cropper } = useChatPictures(packId, actionImages, onChange);

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
          <div className="look-choices" role="group" aria-label={`更换${title}`}>
            <label className="look-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event, slot)} /><span>上传图片</span></label>
            {slot === "peek" && <button type="button" aria-pressed={value === "hidden"} className={value === "hidden" ? "look-hide is-selected" : "look-hide"} onClick={() => set(slot, "hidden")}>不显示</button>}
          </div>
          {value !== "hidden" && <button type="button" className="settings-button settings-button--small" onClick={() => void edit(slot)}>调整</button>}
          <button type="button" className="settings-button settings-button--small" onClick={() => set(slot, DEFAULT_CHAT_APPEARANCE[slot])}>恢复默认</button>
        </div>
      </div>;
    })}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
    {cropper}
  </article>;
}
