import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { addFact, editFact, FACT_LIMITS, loadFactLearning, loadFacts, removeFact, restoreFact, saveFactLearning, watchFacts, type Fact } from "../../facts/FactStore";
import { noteTime } from "../../notes/NoteStore";
import { changeFacts } from "../../worklog/store";
import { loadUserProfile, saveUserProfile, USER_PROFILE_LIMITS } from "../../preferences/UserProfile";
import { ConfirmButton } from "../ConfirmButton";
import { isComposing } from "../keyboard";
import { UNDO_MS } from "../../ui/feedback";

const SOURCE_LABELS: Record<Fact["source"], string> = { user: "你写的", chat: "聊天里记的" };
const UNSAVED = "记忆没能保存，请再试一次。";
/** Facts shown before "显示全部": the list may hold 50, which would run on for pages. */
const FACTS_SHOWN = 8;

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 「记忆」: what the pet knows about the user: the list, adding, editing, deleting and whether chats may add to it. */
export function FactSettings({ who }: { who: string }) {
  const [facts, setFacts] = useState(loadFacts);
  const [learning, setLearning] = useState(loadFactLearning);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [removed, setRemoved] = useState<Fact | null>(null);
  const [status, setStatus] = useState("");
  const [nickname, setNickname] = useState(() => loadUserProfile().nickname);
  const [profileStatus, setProfileStatus] = useState("");
  const full = facts.length >= FACT_LIMITS.items;

  useEffect(() => watchFacts(() => setFacts(loadFacts())), []);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  /** Every change here is the user's own, so it goes into the work log as theirs. */
  const change = (work: (list: Fact[]) => Fact[]): boolean => {
    try { setFacts(changeFacts(work, "user")); setStatus(""); return true; }
    catch (reason) { console.error("Could not save the facts", reason); setStatus(UNSAVED); return false; }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() && change((list) => addFact(list, { id: newId(), text: draft, source: "user" }, Date.now()))) setDraft("");
  };
  /** A rewritten fact is the user's from then on, so chats can no longer change it. */
  const saveEdit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editing) return;
    const before = facts.find((fact) => fact.id === editing.id);
    if (!editing.text.trim() || before?.text === editing.text.trim()) { setEditing(null); return; }
    if (change((list) => editFact(list, editing.id, editing.text, "user", Date.now()))) setEditing(null);
  };
  const editKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || isComposing(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setEditing(null);
  };
  const remove = (fact: Fact) => { if (change((list) => removeFact(list, fact.id))) setRemoved(fact); };
  const undo = () => { if (removed && change((list) => restoreFact(list, removed))) setRemoved(null); };
  const toggleLearning = () => {
    try { saveFactLearning(!learning); setLearning(!learning); }
    catch (reason) { console.error("Could not save the fact learning setting", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  const saveNickname = () => {
    try { saveUserProfile({ nickname }); setNickname(nickname.trim()); setProfileStatus(""); }
    catch (reason) {
      console.error("Could not save the nickname", reason);
      setProfileStatus(nickname.trim().length > USER_PROFILE_LIMITS.nickname ? `称呼最多 ${USER_PROFILE_LIMITS.nickname} 个字。` : "称呼没能保存，请再试一次。");
    }
  };
  const now = Date.now();
  // Newest first, so a fact just added or rewritten is in view while the list is folded.
  const newestFirst = [...facts].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, FACTS_SHOWN);

  return <div className="settings-section">
    <div className="settings-section__intro"><h2>关于你</h2><p>称呼和记忆每次聊天都会带上，所有角色共用</p></div>
    <article className="settings-card ai-settings"><label className="ai-preference">你的称呼<input className="ui-field" value={nickname} maxLength={USER_PROFILE_LIMITS.nickname} placeholder="例如：阿龙" onChange={(event) => setNickname(event.currentTarget.value)} onBlur={saveNickname} /></label>{profileStatus && <p className="ai-settings__status" role="status">{profileStatus}</p>}</article>
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>聊天时自动记住</strong><span>{learning ? `你在聊天里说起的偏好、习惯和长期安排，${who}会记下来` : "已关闭：不再记新的，已有的照常使用"}</span></div>
        <button type="button" role="switch" aria-label="聊天时自动记住" aria-checked={learning} className={learning ? "ui-switch is-on" : "ui-switch"} onClick={toggleLearning}><span /></button>
      </div>
    </div>
    <div className="settings-group-head">
      <h2 className="settings-group-title">已记住的事</h2>
      <span className="settings-group-head__count">{facts.length} / {FACT_LIMITS.items}</span>
      {facts.length > 0 && <ConfirmButton className="ui-button ui-button--small" confirm={{ message: "清空全部记忆？", detail: `你写的和聊天里记的都会删掉，${who}不再记得这些事。不能撤销。`, action: "清空" }} onConfirm={() => { if (change(() => [])) { setRemoved(null); setEditing(null); } }}>清空…</ConfirmButton>}
    </div>
    <div className="settings-group fact-settings">
      <form className="settings-row fact-add" onSubmit={add}>
        <input className="ui-field ui-field--small" aria-label="新的记忆" value={draft} maxLength={FACT_LIMITS.text} disabled={full} placeholder={full ? `最多 ${FACT_LIMITS.items} 条，删掉几条才能再加` : "写一件关于你的事，如：不吃香菜、每周三下午开例会"} onChange={(event) => setDraft(event.currentTarget.value)} />
        <button type="submit" className="ui-button ui-button--small" disabled={full || !draft.trim()}>添加</button>
      </form>
      {facts.length === 0
        ? <p className="fact-empty">还没有记忆。可以在上面写，也可以在聊天里说「记住，我不吃香菜」。</p>
        : <ul className="fact-list">{shown.map((fact) => <li key={fact.id} className="settings-row fact-row">
          {editing?.id === fact.id
            ? <form className="fact-edit" onSubmit={saveEdit}>
              <input className="ui-field ui-field--small" autoFocus aria-label="修改这条记忆" value={editing.text} maxLength={FACT_LIMITS.text} onChange={(event) => setEditing({ id: fact.id, text: event.currentTarget.value })} onKeyDown={editKeys} />
              <button type="submit" className="ui-button ui-button--small ui-button--primary" disabled={!editing.text.trim()}>保存</button>
              <button type="button" className="ui-button ui-button--small" onClick={() => setEditing(null)}>取消</button>
            </form>
            : <>
              <div className="settings-row__body"><strong className="fact-row__text">{fact.text}</strong><span>{SOURCE_LABELS[fact.source]} · {noteTime(fact.at, now)}</span></div>
              <div className="settings-button-row">
                <button type="button" className="ui-button ui-button--small" aria-label={`修改“${fact.text}”`} onClick={() => setEditing({ id: fact.id, text: fact.text })}>修改</button>
                <button type="button" className="ui-button ui-button--small" aria-label={`删除“${fact.text}”`} onClick={() => remove(fact)}>删除</button>
              </div>
            </>}
        </li>)}</ul>}
      {facts.length > FACTS_SHOWN && <button type="button" className="settings-more" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : `显示全部 ${facts.length} 条`}</button>}
    </div>
    {removed && <div className="fact-undo" role="status"><span>已删除“{removed.text}”</span><button type="button" onClick={undo}>撤销</button></div>}
    {status && <p className="ai-inline-status" role="status">{status}</p>}
    <p className="settings-footnote">你写的以你为准，{who}不会改动；聊天里记的会随新情况更新，你改过的就算你写的。记忆会发给 DeepSeek，不要写密码、证件号。</p>
  </div>;
}
