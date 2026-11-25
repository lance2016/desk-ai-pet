import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createCustomCharacter, DEFAULT_PACK_ID, type CatalogEntry } from "../../assets/PackCatalog";
import { saveActiveCharacter } from "../../preferences/CharacterPreferences";
import { PERSONA_LIMITS } from "../../types";
import { isComposing } from "../keyboard";

const STORAGE_FULL = "没能保存：这台电脑上给 AI Pet 的存储空间满了。删掉几张自定义图片再试。";

interface Props {
  /** The built-in characters a new one can borrow its looks from. */
  looks: CatalogEntry[];
  onCreated: () => void;
  onClose: () => void;
}

/** 「新建角色…」 as a sheet over the character page, so the form opens where it was asked for. */
export function NewCharacterSheet({ looks, onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const [base, setBase] = useState(DEFAULT_PACK_ID);
  const [problem, setProblem] = useState("");
  const card = useRef<HTMLFormElement>(null);

  const create = (event: FormEvent) => {
    event.preventDefault();
    try {
      const character = createCustomCharacter({ base, name, personality });
      onCreated();
      saveActiveCharacter(character.id);
      onClose();
    } catch (reason) {
      console.error("Could not create the character", reason);
      const text = String(reason);
      setProblem(text.includes("At most") ? "角色数量已经到上限了，先删掉一个不用的角色。" : text.includes("ZodError") || text.includes("name") ? `名字要 1 到 ${PERSONA_LIMITS.name} 个字。` : STORAGE_FULL);
    }
  };
  // Esc closes like 取消; Tab stays inside the sheet.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { if (!isComposing(event)) { event.preventDefault(); onClose(); } return; }
    if (event.key !== "Tab" || !card.current) return;
    const focusable = Array.from(card.current.querySelectorAll<HTMLElement>("input, button, textarea, select")).filter((item) => !item.hasAttribute("disabled"));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="voice-clone" role="dialog" aria-modal="true" aria-labelledby="new-character-title" onKeyDown={onKeyDown}>
    <form ref={card} className="voice-clone__card" onSubmit={create}>
      <h2 id="new-character-title">新建角色</h2>
      <p>先借用一个现有形象，之后可以在动作库换成自己的图</p>
      <label className="voice-clone__field">名字<input className="ui-field ui-field--small" value={name} maxLength={PERSONA_LIMITS.name} autoFocus placeholder="例如：阿橘" onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label className="voice-clone__field">性格<textarea className="ui-textarea" value={personality} maxLength={PERSONA_LIMITS.personality} placeholder="例如：慵懒、爱撒娇的橘猫，说话常带“喵”" onChange={(event) => setPersonality(event.currentTarget.value)} /></label>
      {looks.length > 1 && <label className="voice-clone__field">形象<select className="ui-select" value={base} onChange={(event) => setBase(event.currentTarget.value)}>{looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
      {problem && <p role="status">{problem}</p>}
      <div className="voice-clone__actions">
        <button type="button" className="ui-button" onClick={onClose}>取消</button>
        <button type="submit" className="ui-button ui-button--primary" disabled={!name.trim()}>创建并切换</button>
      </div>
    </form>
  </div>;
}
