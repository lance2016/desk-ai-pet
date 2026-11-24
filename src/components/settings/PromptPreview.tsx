import { useEffect, useState } from "react";
import { ai, type PromptSection } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { CHAT_RULE_IDS, CHAT_RULE_LIMIT, saveChatRule, type ChatRuleId } from "../../preferences/ChatRules";
import { loadSwitchedOff } from "../../preferences/SkillPreferences";
import { CHAT_SKILLS } from "../../skills";
import { ConfirmButton } from "../ConfirmButton";
import { CopyButton } from "./actions/CopyButton";
import { moveRadioChoice } from "./radioKeys";
import { contextNow } from "./SkillSettings";

/** Where each fixed part of the prompt comes from, so a developer knows where to change it. */
const SOURCES: Record<string, string> = {
  persona: "来自「角色设定」的名字、性格、回复长度，和「记忆」里你的称呼",
  date: "按现在的时间自动生成",
  facts: "来自「记忆」",
  opening: "宠物先开口的聊天才有",
  off: "按「能力」和「工具定义」里的开关自动生成",
  instructions: "来自「角色设定」的补充要求",
};
const VIEWS = [["parts", "分段"], ["raw", "原文"]] as const;
type View = (typeof VIEWS)[number][0];

const isRule = (id: string): id is ChatRuleId => CHAT_RULE_IDS.some((rule) => rule === id);
const chars = (text: string) => [...text].length;

/** One editable part: the app's wording or the user's, rewritten in place. */
function RuleEditor({ id, section, onSaved, onError }: { id: ChatRuleId; section: PromptSection & { default: string }; onSaved: () => void; onError: (message: string | null) => void }) {
  const [draft, setDraft] = useState(section.text);
  const save = (value: string | null) => {
    try { saveChatRule(id, value === section.default ? null : value); onError(null); onSaved(); }
    catch (reason) { console.error("Could not save the chat rule", reason); onError("规则没能保存，请再试一次。"); }
  };
  return <div className="ai-prompt-part__editor">
    <textarea aria-label={`编辑「${section.title}」的规则`} value={draft} maxLength={CHAT_RULE_LIMIT} autoFocus onChange={(event) => setDraft(event.currentTarget.value)} />
    <div className="ai-prompt-part__actions">
      <span>{draft.length} / {CHAT_RULE_LIMIT}</span>
      {section.text !== section.default && <ConfirmButton className="ui-button ui-button--small" confirm={{ message: `把「${section.title}」的规则恢复成默认？`, detail: "你改过的内容会被替换，不能撤销。", action: "恢复默认" }} onConfirm={() => save(null)}>恢复默认</ConfirmButton>}
      <button type="button" className="ui-button ui-button--small" onClick={onSaved}>取消</button>
      <button type="button" className="ui-button ui-button--small ui-button--primary" disabled={draft === section.text} onClick={() => save(draft)}>保存</button>
    </div>
  </div>;
}

function Part({ section, onChanged, onError }: { section: PromptSection; onChanged: () => void; onError: (message: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const rule = isRule(section.id) && section.default !== null ? { id: section.id, section: { ...section, default: section.default } } : null;
  const changed = rule !== null && section.text !== section.default;
  const source = rule ? `「能力」里的一项，规则可以改写` : SOURCES[section.id] ?? "";
  return <section className="settings-card prompt-part">
    <div className="prompt-part__head">
      <div className="prompt-part__title"><h3>{section.title}</h3><span>{source}</span></div>
      {changed && <span className="ai-prompt-part__badge">已修改</span>}
      <span className="settings-row__value">{chars(section.text)} 字</span>
      {rule && !editing && <button type="button" className="ui-button ui-button--small" onClick={() => setEditing(true)}>编辑</button>}
    </div>
    {rule && editing
      ? <RuleEditor id={rule.id} section={rule.section} onSaved={() => { setEditing(false); onChanged(); }} onError={onError} />
      : <p className="prompt-part__text">{section.text || "已清空，AI 只按工具说明来用"}</p>}
  </section>;
}

/** 「提示词」: the system prompt a chat would send right now, part by part or as one text. Developer mode only. */
export function PromptPreview({ packId, persona, actions, onError }: { packId: string; persona?: PetPersona; actions: readonly string[]; onError: (message: string | null) => void }) {
  const [view, setView] = useState<View>("parts");
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  // Memories and switches change in other windows: build it again when settings comes back to the front.
  useEffect(() => { window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  const preview = (() => {
    try { return ai.preview(requestPreferences(packId, persona), contextNow(actions, loadSwitchedOff()), CHAT_SKILLS); }
    catch (reason) { console.error("Could not preview the chat prompt", reason); return null; }
  })();
  if (!preview) return <div className="settings-section"><p className="ai-log-empty">没能拼出提示词，请在桌面应用中重试。</p></div>;
  return <div className="settings-section">
    <div className="prompt-toolbar">
      <p>按当前角色、时间和开关拼出来，每次聊天开头发给 AI 的就是这些。共 {chars(preview.prompt)} 字</p>
      <div className="segmented" role="radiogroup" aria-label="显示方式" onKeyDown={moveRadioChoice}>
        {VIEWS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={view === value} className={view === value ? "is-selected" : ""} onClick={() => setView(value)}>{label}</button>)}
      </div>
    </div>
    {view === "parts"
      ? preview.sections.filter((section) => section.text || section.default !== null).map((section) => <Part key={section.id} section={section} onChanged={refresh} onError={onError} />)
      : <section className="settings-card prompt-part">
        <div className="prompt-part__head"><div className="prompt-part__title"><h3>系统提示词</h3><span>各段按顺序拼接，原样发出</span></div><CopyButton className="ui-button ui-button--small" text={preview.prompt} onMessage={(message) => onError(message || null)}>复制</CopyButton></div>
        <pre className="ai-prompt-full prompt-part__raw">{preview.prompt}</pre>
      </section>}
  </div>;
}
