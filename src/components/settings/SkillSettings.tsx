import { useState, type CSSProperties } from "react";
import { offeredTools, type ChatContext, type Skill } from "../../ai";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { loadChatRules, saveChatRule, type ChatRuleId } from "../../preferences/ChatRules";
import { loadReadLinks, saveReadLinks } from "../../preferences/ReadLinkPreferences";
import { loadSwitchedOff, saveSkillOn, saveToolOn, type SwitchedOff } from "../../preferences/SkillPreferences";
import { ConfirmButton } from "../ConfirmButton";
import { CHAT_SKILLS } from "../../skills";
import { Icon, type IconName } from "../../ui/icons";

const NOT_SAVED = "设置没能保存，请再试一次。";

/** Each skill's tile on the 「能力」 page, as the rows of System Settings wear them. */
const ICONS: Record<ChatRuleId, { tile: string; glyph: IconName }> = {
  reminders: { tile: "--ui-tile-orange", glyph: "bell" },
  notes: { tile: "--ui-tile-yellow", glyph: "note" },
  review: { tile: "--ui-tile-green", glyph: "calendar_check" },
  remember: { tile: "--ui-tile-purple", glyph: "bookmark" },
  quiet: { tile: "--ui-tile-indigo", glyph: "moon" },
  actions: { tile: "--ui-tile-pink", glyph: "paw" },
};

/** The context a chat would get now, so availability reads as it would in a chat. */
export const contextNow = (actions: readonly string[], off: SwitchedOff): ChatContext => chatContext(Date.now(), actions, currentChatFacts(), null, off);

/** Why a skill the user left on does nothing for this character, or null when it can work. */
const unavailable = (skill: Skill, context: ChatContext): string | null => ((skill.available?.(context) ?? true) ? null : "当前角色用不了");

/**
 * What developer mode changed in a skill, in the user's words, or null when nothing. These keep
 * working after developer mode is switched off, so the page says so and offers the way back.
 */
function changes(skill: Skill, context: ChatContext, rewritten: boolean): string | null {
  const closed = skill.tools.length - offeredTools(skill, context).length;
  const parts = [rewritten ? "规则改写过" : "", closed === skill.tools.length ? "操作全关了" : closed > 0 ? `关了 ${closed} 项操作` : ""].filter(Boolean);
  return parts.length ? `开发者模式里${parts.join("、")}` : null;
}

function SkillIcon({ id }: { id: ChatRuleId }) {
  const { tile, glyph } = ICONS[id];
  return <span className="settings-nav__icon" style={{ "--tile": `var(${tile})` } as CSSProperties}>
    <Icon name={glyph} />
  </span>;
}

export function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={on} className={on ? "ui-switch is-on" : "ui-switch"} onClick={onChange}><span /></button>;
}

/** 「能力」: what the pet may do in a chat, one switch each, and reading webpages. */
export function SkillList({ actions, onError }: { actions: readonly string[]; onError: (message: string | null) => void }) {
  const [off, setOff] = useState(loadSwitchedOff);
  const [readLinks, setReadLinks] = useState(loadReadLinks);
  const [rules, setRules] = useState(loadChatRules);
  /** Puts back the skill's own rule and turns its tools on again, as a new install has them. */
  const restore = (skill: Skill) => {
    try {
      saveChatRule(skill.id, null);
      for (const tool of skill.tools) if (off.tools.includes(tool.name)) saveToolOn(tool.name, true);
      setRules(loadChatRules()); setOff(loadSwitchedOff()); onError(null);
    } catch (reason) { console.error("Could not restore the skill", reason); onError(NOT_SAVED); }
  };
  const context = contextNow(actions, off);
  const toggle = (id: ChatRuleId) => {
    try { saveSkillOn(id, off.skills.includes(id)); setOff(loadSwitchedOff()); onError(null); }
    catch (reason) { console.error("Could not save the skill switch", reason); onError(NOT_SAVED); }
  };
  const toggleReadLinks = () => {
    try { saveReadLinks(!readLinks); setReadLinks(!readLinks); onError(null); }
    catch (reason) { console.error("Could not save link reading preference", reason); onError(NOT_SAVED); }
  };
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>聊天时能做的事</h2><p>所有角色共用。关掉的事 AI 不会去做，你让它做时它会告诉你在这里打开</p></div>
    <div className="settings-group">
      {CHAT_SKILLS.map((skill) => {
        const on = !off.skills.includes(skill.id);
        const note = on ? unavailable(skill, context) : null;
        const changed = changes(skill, context, rules[skill.id] !== undefined);
        return <div key={skill.id} className="settings-row">
          <SkillIcon id={skill.id} />
          <div className="settings-row__body"><strong>{skill.title}</strong><span>{skill.summary}</span>
            {changed && <span className="skill-row__changed">{changed}<ConfirmButton className="ui-link" confirm={{ message: `把「${skill.title}」恢复默认？`, detail: "改写过的规则换回默认，单独关掉的操作重新打开。", action: "恢复默认" }} onConfirm={() => restore(skill)}>恢复默认</ConfirmButton></span>}
          </div>
          {note && <span className="settings-row__value">{note}</span>}
          <Switch label={skill.title} on={on} onChange={() => toggle(skill.id)} />
        </div>;
      })}
    </div>
    <h2 className="settings-group-title">联网</h2>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row__body"><strong>读网页链接</strong><span>在完整聊天里发网页链接时，交给 DeepSeek 读</span></div><Switch label="读网页链接" on={readLinks} onChange={toggleReadLinks} /></div>
    </div>
  </div>;
}
