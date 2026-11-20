import { useState, type ChangeEvent, type FormEvent } from "react";
import { createCustomCharacter, DEFAULT_PACK_ID, type CatalogEntry } from "../../assets/PackCatalog";
import { saveActiveCharacter } from "../../preferences/CharacterPreferences";
import { characterName } from "../../preferences/ChatPreferences";
import { loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { systemPlatform } from "../../platform/system";
import { characterPackageFileName, characterPackageText, createCharacterPackage, importCharacterPackage, MAX_CHARACTER_PACKAGE_BYTES, parseCharacterPackage, renameCharacterPackage, summarizeCharacterPackage, uniqueCharacterName, type CharacterPackage, type CharacterPackageSummary } from "../../storage/CharacterPackage";
import { PERSONA_LIMITS } from "../../types";
import { listAppearances } from "../../appearance/AppearanceStore";
import { CharacterAvatar } from "../CharacterAvatar";

interface Props {
  packId: string;
  catalog: CatalogEntry[];
  onCatalogChange: () => void;
  onOpenProfile: () => void;
}

const EMPTY_DRAFT = { name: "", personality: "", base: DEFAULT_PACK_ID };
const STORAGE_FULL = "没能保存：这台电脑上给 AI Pet 的存储空间满了。删掉几张自定义图片再试。";
type Area = "list" | "create" | "transfer";

/** Select, create, import and export characters. Character-specific preferences live on the detail page. */
export function CharacterSettings({ packId, catalog, onCatalogChange, onOpenProfile }: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [message, setMessage] = useState<{ area: Area; text: string } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ characterPackage: CharacterPackage; summary: CharacterPackageSummary; name: string } | null>(null);
  const looks = catalog.filter((entry) => !entry.custom);
  const current = catalog.find((entry) => entry.id === packId);
  const currentName = current ? characterName(packId, current.name) : "当前角色";
  const say = (area: Area, text: string) => setMessage({ area, text });
  const note = (area: Area) => message?.area === area && <p className="ai-settings__status" role="status">{message.text}</p>;

  const switchTo = (id: string) => {
    if (id === packId) return;
    try { saveActiveCharacter(id); }
    catch (reason) { console.error("Could not switch characters", reason); say("list", "没能切换角色，请再试一次。"); }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    try {
      const character = createCustomCharacter({ base: draft.base, name: draft.name, personality: draft.personality });
      onCatalogChange();
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      setMessage(null);
      saveActiveCharacter(character.id);
    } catch (reason) {
      console.error("Could not create the character", reason);
      const text = String(reason);
      say("create", text.includes("At most") ? "角色数量已经到上限了，先删掉一个不用的角色。" : text.includes("ZodError") || text.includes("name") ? `名字要 1 到 ${PERSONA_LIMITS.name} 个字。` : STORAGE_FULL);
    }
  };

  const exportCharacter = async () => {
    if (!current?.custom || transferBusy) return;
    setTransferBusy(true);
    try {
      const characterPackage = createCharacterPackage(packId, await listAppearances());
      const saved = await systemPlatform.saveCharacterPackage(characterPackageText(characterPackage), characterPackageFileName(currentName));
      if (saved) say("transfer", `已导出「${currentName}」角色包。`);
      else setMessage(null);
    } catch (reason) {
      console.error("Could not export the character", reason);
      say("transfer", String(reason).includes("too large") ? "角色包超过 80 MB，删掉不需要的动作图层后再导出。" : "角色包没能导出，请换一个保存位置再试。");
    } finally { setTransferBusy(false); }
  };

  const selectCharacterPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_CHARACTER_PACKAGE_BYTES) { say("transfer", "这个角色包超过 80 MB，无法导入。"); return; }
    try {
      const characterPackage = parseCharacterPackage(await file.text());
      const summary = summarizeCharacterPackage(characterPackage);
      const taken = catalog.map((entry) => characterName(entry.id, entry.name));
      setPendingImport({ characterPackage, summary, name: uniqueCharacterName(summary.name, taken) });
      setMessage(null);
    } catch (reason) {
      console.warn("Rejected a character package", reason);
      say("transfer", "这个文件不是有效的 AI Pet 角色包，或者已经损坏。");
    }
  };

  const importCharacter = async () => {
    if (!pendingImport || transferBusy) return;
    setTransferBusy(true);
    let id: string;
    try { id = await importCharacterPackage(renameCharacterPackage(pendingImport.characterPackage, pendingImport.name)); }
    catch (reason) {
      console.error("Could not import the character", reason);
      const text = String(reason);
      say("transfer", text.includes("At most") ? "角色数量已经到上限了，先删掉一个不用的角色。" : "角色包没能导入，现有角色没有改动。请确认基础形象可用后再试。");
      setTransferBusy(false);
      return;
    }
    setPendingImport(null);
    onCatalogChange();
    try { saveActiveCharacter(id); }
    catch (reason) { console.error("Imported the character but could not switch to it", reason); say("transfer", "角色已经导入，请在角色列表里手动切换过去。"); }
    finally { setTransferBusy(false); }
  };

  return <div className="settings-section">
    <div className="settings-section__intro"><h2>我的角色</h2><p>切换会同步更换桌面上的角色；每个角色的设定和聊天记录分开保存</p></div>
    {current && <div className="settings-group character-current">
      <div className="settings-row">
        <CharacterAvatar picture={pictureFor(loadChatAppearance(packId).avatar, current.actionImages)} className="character-current__portrait" />
        <div className="settings-row__body"><strong>{currentName}</strong><span>正在桌面使用 · {current.custom ? "自建角色" : "内置角色"}</span></div>
        <button type="button" className="settings-button settings-button--small" onClick={onOpenProfile}>编辑角色设定</button>
      </div>
    </div>}

    <div className="character-grid">
      {catalog.map((entry) => <button key={entry.id} type="button" className={entry.id === packId ? "character-tile is-current" : "character-tile"} aria-pressed={entry.id === packId} onClick={() => switchTo(entry.id)}>
        <CharacterAvatar picture={pictureFor(loadChatAppearance(entry.id).avatar, entry.actionImages)} className="character-tile__portrait" />
        <strong>{characterName(entry.id, entry.name)}</strong>
        <small>{entry.id === packId ? "使用中" : entry.custom ? "自建角色" : "内置角色"}</small>
      </button>)}
      <button type="button" className={creating ? "character-tile character-tile--new is-current" : "character-tile character-tile--new"} onClick={() => { setCreating(true); setMessage(null); }}>
        <span className="character-tile__portrait">+</span><strong>新建角色</strong><small>起名字、定性格</small>
      </button>
    </div>
    {note("list")}

    {creating && <>
      <div className="settings-section__intro settings-section__intro--spaced"><h2>新建角色</h2><p>先借用一个现有形象，之后可以在动作库换成自己的图</p></div>
      <form className="settings-card ai-settings" onSubmit={create}>
        <label className="ai-preference">名字<input value={draft.name} maxLength={PERSONA_LIMITS.name} autoFocus placeholder="例如：阿橘" onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
        <label className="ai-preference">性格<textarea value={draft.personality} maxLength={PERSONA_LIMITS.personality} placeholder="例如：慵懒、爱撒娇的橘猫，说话常带“喵”" onChange={(event) => setDraft({ ...draft, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {draft.personality.length} / {PERSONA_LIMITS.personality}</small></label>
        {looks.length > 1 && <label className="ai-preference">形象<select value={draft.base} onChange={(event) => setDraft({ ...draft, base: event.currentTarget.value })}>{looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <div className="ai-settings__actions"><button type="button" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); setMessage(null); }}>取消</button><button type="submit" className="is-primary" disabled={!draft.name.trim()}>创建并切换</button></div>
        {note("create")}
      </form>
    </>}

    <div className="settings-section__intro settings-section__intro--spaced"><h2>导入与导出</h2><p>把自建角色带到另一台电脑</p></div>
    <article className="settings-card ai-settings">
      <div className="settings-row">
        <div className="settings-row__body"><strong>导出当前角色</strong><span>{current?.custom ? "包含角色设定、动作图片和快捷按钮，不含聊天记录" : "内置角色不用导出"}</span></div>
        <button type="button" className="settings-button settings-button--small" disabled={!current?.custom || transferBusy} onClick={() => void exportCharacter()}>{transferBusy ? "处理中…" : "导出角色包"}</button>
      </div>
      <div className="settings-row">
        <div className="settings-row__body"><strong>导入角色包</strong><span>会新增一个角色，不影响现有的</span></div>
        <label className={transferBusy ? "settings-button settings-button--small icon-upload is-disabled" : "settings-button settings-button--small icon-upload"}>
          <input type="file" accept="application/json,.json" disabled={transferBusy} onChange={(event) => void selectCharacterPackage(event)} />选择文件…
        </label>
      </div>
      {pendingImport && <div className="settings-row backup-confirm" role="alertdialog" aria-label="确认导入角色包">
        <div className="settings-row__body"><strong>导入「{pendingImport.summary.name}」？</strong><span>{pendingImport.name !== pendingImport.summary.name && `已经有叫「${pendingImport.summary.name}」的角色，导入后会改名为「${pendingImport.name}」。`}将新增一个角色，包含动作图片 {pendingImport.summary.actions} 张、自定义动作 {pendingImport.summary.customActions} 个、带图层的动作 {pendingImport.summary.layeredActions} 个。</span></div>
        <div className="settings-button-row"><button type="button" className="settings-button settings-button--small" disabled={transferBusy} onClick={() => setPendingImport(null)}>取消</button><button type="button" className="settings-button settings-button--small" disabled={transferBusy} onClick={() => void importCharacter()}>{transferBusy ? "正在导入…" : "导入并切换"}</button></div>
      </div>}
      {note("transfer")}
    </article>
  </div>;
}
