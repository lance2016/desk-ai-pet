import { z } from "zod";
import type { ChatPreview } from "../../platform/chat";

const toolSchema = z.object({ function: z.object({ name: z.string(), description: z.string(), parameters: z.object({ properties: z.record(z.string(), z.object({ description: z.string().optional(), enum: z.array(z.string()).optional() })), required: z.array(z.string()).optional() }) }) });
const TOOL_NAMES: Record<string, string> = { add_reminder: "创建提醒", save_note: "保存备忘", play_action: "做动作" };
const FIELD_NAMES: Record<string, string> = { text: "内容", remind_at: "提醒时间", repeat: "重复方式", action: "动作" };

/** Shows the actual native request in words, without exposing a JSON schema. */
export function ChatRequestDetails({ preview }: { preview: ChatPreview }) {
  const tools = preview.tools.map((tool) => toolSchema.safeParse(tool));
  return <div className="ai-request-details">
    <p className="ai-request-details__note">这是按当前角色和时间生成的预览，不包含聊天记录；实际聊天时的时间和可用动作可能不同。</p>
    <details className="ai-disclosure">
      <summary><span><strong>对话规则</strong><small>查看发送给 AI 的完整提示词</small></span></summary>
      <div className="ai-prompt-text">{preview.prompt.split("\n").filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </details>
    <details className="ai-disclosure">
      <summary><span><strong>AI 可以使用的能力</strong><small>查看每项能力会用到哪些信息</small></span></summary>
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
