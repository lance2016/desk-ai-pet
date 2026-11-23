import { useState, type CSSProperties, type ReactNode } from "react";
import { z } from "zod";
import type { ChatContext, Skill } from "../../ai";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { CHAT_RULE_LIMIT, loadChatRules, saveChatRule, type ChatRuleId } from "../../preferences/ChatRules";
import { loadReadLinks, saveReadLinks } from "../../preferences/ReadLinkPreferences";
import { loadSkillsOff, saveSkillOn } from "../../preferences/SkillPreferences";
import { CHAT_SKILLS } from "../../skills";
import { ConfirmButton } from "../ConfirmButton";
import { Chevron } from "./Chevron";

const NOT_SAVED = "设置没能保存，请再试一次。";

/** Each skill's tile on the 「能力」 page, as the rows of System Settings wear them. */
const ICONS: Record<ChatRuleId, { tile: string; glyph: ReactNode }> = {
  memory: { tile: "--tile-orange", glyph: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></> },
  lookup: { tile: "--tile-blue", glyph: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></> },
  remember: { tile: "--tile-purple", glyph: <path d="M7 3h10v18l-5-4-5 4V3Z" /> },
  quiet: { tile: "--tile-indigo", glyph: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" /> },
  actions: { tile: "--tile-pink", glyph: <><path d="M12 20c-3 0-5-1.4-5-3.8 0-2 2.3-3.6 5-3.6s5 1.6 5 3.6c0 2.4-2 3.8-5 3.8Z" /><circle cx="5.5" cy="10" r="2" /><circle cx="10" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="19" cy="10" r="2" /></> },
};

const parametersSchema = z.object({
  properties: z.record(z.string(), z.object({ description: z.string().optional(), enum: z.array(z.string()).optional() })).optional(),
  required: z.array(z.string()).optional(),
});

const findSkill = (id: ChatRuleId): Skill | undefined => CHAT_SKILLS.find((skill) => skill.id === id);
export const skillTitle = (id: ChatRuleId): string => findSkill(id)?.title ?? "能力";

/** The context a chat would get now, so rules and availability read as they would in a chat. */
const contextNow = (actions: readonly string[], off: readonly ChatRuleId[]): ChatContext => chatContext(Date.now(), actions, currentChatFacts(), null, off);

/** Why a skill the user left on is not offered anyway, or null when it is. */
function blocker(skill: Skill, context: ChatContext): string | null {
  const needed = (skill.requires ?? []).filter((id) => context.skillsOff?.includes(id));
  if (needed.length > 0) return `要先打开「${needed.map(skillTitle).join("」「")}」`;
  if (!(skill.available?.(context) ?? true)) return "当前角色用不了";
  return null;
}

function SkillIcon({ id }: { id: ChatRuleId }) {
  const { tile, glyph } = ICONS[id];
  return <span className="settings-nav__icon" style={{ "--tile": `var(${tile})` } as CSSProperties}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyph}</svg>
  </span>;
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={on} className={on ? "toggle is-on" : "toggle"} onClick={onChange}><span /></button>;
}

/** 「能力」: what the pet may do in a chat, each opening its own page, and reading webpages. */
export function SkillList({ actions, onOpen, onError }: { actions: readonly string[]; onOpen: (id: ChatRuleId) => void; onError: (message: string | null) => void }) {
  const [off] = useState(loadSkillsOff);
  const [readLinks, setReadLinks] = useState(loadReadLinks);
  const context = contextNow(actions, off);
  const toggleReadLinks = () => {
    try { saveReadLinks(!readLinks); setReadLinks(!readLinks); onError(null); }
    catch (reason) { console.error("Could not save link reading preference", reason); onError(NOT_SAVED); }
  };
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>聊天时能做的事</h2><p>所有角色共用。关掉的能力不会交给 AI，你让它做时它会告诉你在这里打开</p></div>
    <div className="settings-group">
      {CHAT_SKILLS.map((skill) => {
        const status = off.includes(skill.id) ? "已关闭" : blocker(skill, context) ? "用不了" : null;
        return <button key={skill.id} type="button" className="settings-row settings-link" onClick={() => onOpen(skill.id)}>
          <SkillIcon id={skill.id} />
          <span className="settings-row__body"><strong>{skill.title}</strong><span>{skill.summary}</span></span>
          {status && <span className="settings-row__value">{status}</span>}
          <Chevron />
        </button>;
      })}
    </div>
    <h2 className="settings-group-title">联网</h2>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row__body"><strong>读网页链接</strong><span>在完整聊天里发网页链接时，交给 DeepSeek 读</span></div><Switch label="读网页链接" on={readLinks} onChange={toggleReadLinks} /></div>
    </div>
  </div>;
}

/** The rules of one skill, as written for the model; the user may rewrite them and put the default back. */
function SkillRules({ id, fallback, onError }: { id: ChatRuleId; fallback: string; onError: (message: string | null) => void }) {
  const [custom, setCustom] = useState(() => loadChatRules()[id]);
  const [draft, setDraft] = useState<string | null>(null);
  const text = custom === undefined ? fallback : custom.trim();
  const changed = text !== fallback;
  const save = (value: string | null) => {
    try { saveChatRule(id, value === fallback ? null : value); setCustom(loadChatRules()[id]); setDraft(null); onError(null); }
    catch (reason) { console.error("Could not save the chat rule", reason); onError("规则没能保存，请再试一次。"); }
  };
  return <div className="settings-card skill-rules">
    <div className="skill-rules__head">
      <span>每次聊天都会带上，告诉 AI 什么时候用、怎么用</span>
      {changed && <span className="ai-prompt-part__badge">已修改</span>}
      {draft === null && <button type="button" className="settings-button settings-button--small" onClick={() => setDraft(text)}>编辑</button>}
    </div>
    {draft === null
      ? <p className="skill-rules__text">{text || "规则已清空，AI 只按工具说明来用"}</p>
      : <div className="ai-prompt-part__editor">
        <textarea aria-label="编辑使用规则" value={draft} maxLength={CHAT_RULE_LIMIT} autoFocus onChange={(event) => setDraft(event.currentTarget.value)} />
        <div className="ai-prompt-part__actions">
          <span>{draft.length} / {CHAT_RULE_LIMIT}</span>
          {changed && <ConfirmButton className="settings-button settings-button--small" confirm={{ message: "把使用规则恢复成默认？", detail: "你改过的内容会被替换，不能撤销。", action: "恢复默认" }} onConfirm={() => save(null)}>恢复默认</ConfirmButton>}
          <button type="button" className="settings-button settings-button--small" onClick={() => setDraft(null)}>取消</button>
          <button type="button" className="settings-button settings-button--small settings-button--primary" disabled={draft === text} onClick={() => save(draft)}>保存</button>
        </div>
      </div>}
  </div>;
}

/** The tools as the model reads them: names, descriptions and arguments. Developer mode only. */
function ToolDefinitions({ skill, context }: { skill: Skill; context: ChatContext }) {
  return <details className="ai-disclosure ai-disclosure--standalone">
    <summary><span><strong>给 AI 的工具说明</strong><small>开发者模式才显示，原样发给 AI</small></span></summary>
    <div className="ai-request-tools">{skill.tools.map((tool) => {
      const parameters = parametersSchema.safeParse(tool.parameters(context));
      const properties = parameters.success ? Object.entries(parameters.data.properties ?? {}) : [];
      return <section key={tool.name} className="ai-request-tool">
        <h4>{tool.name}</h4><p>{tool.description}</p>
        {properties.length > 0 && <dl>{properties.map(([key, field]) => <div key={key}><dt>{key}{!parameters.data?.required?.includes(key) && <span>（可选）</span>}</dt><dd>{field.description ?? (field.enum ? `可选值：${field.enum.join("、")}` : "")}</dd></div>)}</dl>}
      </section>;
    })}</div>
  </details>;
}

/** One skill's page: whether chats may use it, what it can do, and its rules. */
export function SkillDetail({ id, actions, developer, onError }: { id: ChatRuleId; actions: readonly string[]; developer: boolean; onError: (message: string | null) => void }) {
  const [off, setOff] = useState(loadSkillsOff);
  const skill = findSkill(id);
  if (!skill) return null;
  const context = contextNow(actions, off);
  const on = !off.includes(id);
  const why = on ? blocker(skill, context) : null;
  const toggle = () => {
    try { saveSkillOn(id, !on); setOff(loadSkillsOff()); onError(null); }
    catch (reason) { console.error("Could not save the skill switch", reason); onError(NOT_SAVED); }
  };
  return <div className="settings-section">
    <div className="settings-group">
      <div className="settings-row"><SkillIcon id={id} /><div className="settings-row__body"><strong>聊天时可以用</strong><span>{why ?? skill.summary}</span></div><Switch label="聊天时可以用" on={on} onChange={toggle} /></div>
    </div>
    <h2 className="settings-group-title">能做的事</h2>
    <div className="settings-group skill-tools">
      {skill.tools.map((tool) => <div key={tool.name} className="settings-row"><div className="settings-row__body"><strong>{tool.label}</strong></div>{developer && <code className="settings-row__value">{tool.name}</code>}</div>)}
    </div>
    <h2 className="settings-group-title">使用规则</h2>
    <SkillRules key={id} id={id} fallback={skill.rules(context)} onError={onError} />
    {developer && <ToolDefinitions skill={skill} context={context} />}
  </div>;
}
