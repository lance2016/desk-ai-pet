import { useState } from "react";
import { z } from "zod";
import { ai, toolOn, type ChatContext, type Skill, type Tool } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { loadSwitchedOff, saveToolOn } from "../../preferences/SkillPreferences";
import { CHAT_SKILLS } from "../../skills";
import { CopyButton } from "./actions/CopyButton";
import { contextNow, Switch } from "./SkillSettings";

const parametersSchema = z.object({
  properties: z.record(z.string(), z.object({ type: z.string().optional(), description: z.string().optional(), enum: z.array(z.string()).optional() })).optional(),
  required: z.array(z.string()).optional(),
});

/** Why a skill's tools are not sent even though they may be on, or null. */
function skillNote(skill: Skill, context: ChatContext): string | null {
  if (context.skillsOff?.includes(skill.id)) return "整组在「能力」里关着，下面的都不发";
  if (!(skill.available?.(context) ?? true)) return "当前角色用不了，下面的都不发";
  return null;
}

/** The arguments as a table: name, type, whether required, and what the model is told. */
function Parameters({ tool, context }: { tool: Tool; context: ChatContext }) {
  const parsed = parametersSchema.safeParse(tool.parameters(context));
  const properties = parsed.success ? Object.entries(parsed.data.properties ?? {}) : [];
  if (properties.length === 0) return <p className="tool-def__none">没有参数</p>;
  const required = parsed.data?.required ?? [];
  return <table className="tool-def__params">
    <thead><tr><th scope="col">参数</th><th scope="col">类型</th><th scope="col">必填</th><th scope="col">说明</th></tr></thead>
    <tbody>{properties.map(([key, field]) => <tr key={key}>
      <td><code>{key}</code></td>
      <td><code>{field.type ?? "—"}</code></td>
      <td>{required.includes(key) ? "是" : "否"}</td>
      <td>{field.description ?? ""}{field.enum && <span className="tool-def__enum">可选值：{field.enum.length > 0 ? field.enum.join("、") : "（当前没有）"}</span>}</td>
    </tr>)}</tbody>
  </table>;
}

function ToolRow({ tool, context, onToggle }: { tool: Tool; context: ChatContext; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const own = !context.toolsOff?.includes(tool.name);
  const needs = own && !toolOn(tool, context) ? (tool.requires ?? []).filter((name) => context.toolsOff?.includes(name)) : [];
  const bodyId = `tool-${tool.name}`;
  return <div className={open ? "tool-def is-open" : "tool-def"}>
    <div className="settings-row">
      <button type="button" className="tool-def__disclosure" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <svg className="tool-def__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        <span className="settings-row__body"><code className="tool-def__name">{tool.name}</code><span>{tool.label}</span></span>
      </button>
      {needs.length > 0 && <span className="settings-row__value">要先打开 <code>{needs.join("、")}</code></span>}
      <Switch label={tool.name} on={own} onChange={onToggle} />
    </div>
    {open && <div id={bodyId} className="tool-def__body">
      <p className="tool-def__description">{tool.description}</p>
      <Parameters tool={tool} context={context} />
    </div>}
  </div>;
}

/** 「工具定义」: every tool as the model reads it, in the order it is sent, each with its own switch. Developer mode only. */
export function ToolDefinitions({ packId, persona, actions, onError }: { packId: string; persona?: PetPersona; actions: readonly string[]; onError: (message: string | null) => void }) {
  const [off, setOff] = useState(loadSwitchedOff);
  const context = contextNow(actions, off);
  const sent = ai.preview(requestPreferences(packId, persona), context, CHAT_SKILLS).tools;
  const total = CHAT_SKILLS.reduce((count, skill) => count + skill.tools.length, 0);
  const toggle = (name: string) => {
    try { saveToolOn(name, off.tools.includes(name)); setOff(loadSwitchedOff()); onError(null); }
    catch (reason) { console.error("Could not save the tool switch", reason); onError("设置没能保存，请再试一次。"); }
  };
  return <div className="settings-section">
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>发给 AI 的工具</strong><span>和系统提示词一起发出，JSON 就是请求里的 <code>tools</code> 字段</span></div>
        <span className="settings-row__value">{sent.length} / {total} 个</span>
        <CopyButton className="settings-button settings-button--small" text={JSON.stringify(sent, null, 2)} onMessage={(message) => onError(message || null)}>复制 JSON</CopyButton>
      </div>
    </div>
    {CHAT_SKILLS.map((skill) => {
      const note = skillNote(skill, context);
      return <section key={skill.id}>
        <h2 className="settings-group-title tool-group-title">{skill.title}<code>{skill.id}</code>{note && <span>{note}</span>}</h2>
        <div className="settings-group">{skill.tools.map((tool) => <ToolRow key={tool.name} tool={tool} context={context} onToggle={() => toggle(tool.name)} />)}</div>
      </section>;
    })}
  </div>;
}
