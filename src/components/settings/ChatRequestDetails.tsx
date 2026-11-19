import { useState } from "react";
import type { ChatPreview, PromptSection } from "../../ai";
import { z } from "zod";
import { CHAT_RULE_IDS, CHAT_RULE_LIMIT, saveChatRule, type ChatRuleId } from "../../preferences/ChatRules";
import { ConfirmButton } from "../ConfirmButton";

const toolSchema = z.object({ function: z.object({ name: z.string(), description: z.string(), parameters: z.object({ properties: z.record(z.string(), z.object({ description: z.string().optional(), enum: z.array(z.string()).optional() })), required: z.array(z.string()).optional() }) }) });
const TOOL_NAMES: Record<string, string> = { add_reminder: "创建提醒", save_note: "保存备忘", play_action: "做动作", list_reminders: "查看提醒", list_notes: "查看备忘", review_today: "今日回顾" };
const FIELD_NAMES: Record<string, string> = { text: "内容", remind_at: "提醒时间", repeat: "重复方式", action: "动作" };
/** Where the parts the user cannot rewrite here come from. */
const SOURCES: Record<string, string> = {
  persona: "由角色名、性格、回复长度和你的称呼生成，在「回复方式」和角色页里改",
  date: "每次发送时按当前时间生成",
  instructions: "在「补充要求」里改",
};
const isRuleId = (id: string): id is ChatRuleId => (CHAT_RULE_IDS as readonly string[]).includes(id);

/** One part of the rules; a part with a default can be rewritten in place and put back. */
function PromptPart({ section, onChanged, onError }: { section: PromptSection; onChanged: () => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const rule = isRuleId(section.id) ? section.id : null;
  const custom = rule !== null && section.text !== section.default;
  const save = (value: string | null) => {
    if (!rule) return;
    try { saveChatRule(rule, value === section.default ? null : value); setDraft(null); onChanged(); }
    catch (reason) { console.error("Could not save the chat rule", reason); onError("这段规则没能保存，请再试一次。"); }
  };
  return <section className="ai-prompt-part">
    <div className="ai-prompt-part__head">
      <strong>{section.title}</strong>
      {custom && <span className="ai-prompt-part__badge">已修改</span>}
      {rule && draft === null && <button type="button" className="settings-button settings-button--small" onClick={() => setDraft(section.text)}>编辑</button>}
    </div>
    {draft === null
      ? <p className={section.text ? "ai-prompt-part__text" : "ai-prompt-part__text is-empty"}>{section.text || "这一段已删掉，不会发给 AI。"}</p>
      : <div className="ai-prompt-part__editor">
        <textarea aria-label={`编辑「${section.title}」`} value={draft} maxLength={CHAT_RULE_LIMIT} autoFocus onChange={(event) => setDraft(event.currentTarget.value)} />
        <div className="ai-prompt-part__actions">
          <span>{draft.length} / {CHAT_RULE_LIMIT}</span>
          {custom && <ConfirmButton className="settings-button settings-button--small" confirm={{ message: `把「${section.title}」恢复成默认？`, detail: "你改过的内容会被替换，不能撤销。", action: "恢复默认" }} onConfirm={() => save(null)}>恢复默认</ConfirmButton>}
          <button type="button" className="settings-button settings-button--small" onClick={() => setDraft(null)}>取消</button>
          <button type="button" className="settings-button settings-button--small settings-button--primary" disabled={draft === section.text} onClick={() => save(draft)}>保存</button>
        </div>
      </div>}
    {!rule && SOURCES[section.id] && <small className="ai-prompt-part__source">{SOURCES[section.id]}</small>}
  </section>;
}

/** The rules sent with every chat, part by part, and the tools the model may call. */
export function ChatRequestDetails({ preview, onChanged, onError }: { preview: ChatPreview; onChanged: () => void; onError: (message: string) => void }) {
  const tools = preview.tools.map((tool) => toolSchema.safeParse(tool));
  return <div className="ai-request-details">
    <p className="ai-request-details__note">按现在的角色和时间生成。查看清单时在本机展示结果，需要按条件查询或归纳时才会追加请求；打开下面的开发者模式，可以看到每次实际发出的内容。</p>
    <div className="ai-prompt-parts">{preview.sections.map((section) => <PromptPart key={section.id} section={section} onChanged={onChanged} onError={onError} />)}</div>
    <details className="ai-disclosure">
      <summary><span><strong>拼好的完整提示词</strong><small>上面各段按顺序连起来，就是 AI 收到的系统提示词</small></span></summary>
      <pre className="ai-prompt-full">{preview.prompt}</pre>
    </details>
    <details className="ai-disclosure">
      <summary><span><strong>AI 可以使用的能力</strong><small>每项能力会用到哪些信息</small></span></summary>
      <div className="ai-request-tools">{tools.map((result, index) => {
        if (!result.success) return <p key={index}>这项能力暂时无法显示详情。</p>;
        const tool = result.data.function;
        return <section key={`${tool.name}-${index}`} className="ai-request-tool">
          <h4>{TOOL_NAMES[tool.name] ?? tool.name}</h4><p>{tool.description}</p>
          <dl>{Object.entries(tool.parameters.properties).map(([key, field]) => <div key={key}><dt>{FIELD_NAMES[key] ?? key}{!tool.parameters.required?.includes(key) && <span>（可选）</span>}</dt><dd>{field.description ?? (field.enum ? `当前有 ${field.enum.length} 个可选动作，实际能否播放取决于宠物状态。` : "由 AI 根据聊天内容填写")}</dd></div>)}</dl>
        </section>;
      })}</div>
    </details>
  </div>;
}
