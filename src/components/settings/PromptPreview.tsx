import { useState } from "react";
import { ai, type ChatPreview } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { loadSkillsOff } from "../../preferences/SkillPreferences";
import { CHAT_SKILLS } from "../../skills";

/** The system prompt and tools a chat would send right now, put together from the current character, time and skill switches. */
export function PromptPreview({ packId, persona, actions }: { packId: string; persona?: PetPersona; actions: readonly string[] }) {
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [problem, setProblem] = useState("");
  const show = () => {
    setProblem("");
    try { setPreview(ai.preview(requestPreferences(packId, persona), chatContext(Date.now(), actions, currentChatFacts(), null, loadSkillsOff()), CHAT_SKILLS)); }
    catch (reason) { console.error("Could not preview chat request", reason); setProblem("没能生成预览，请在桌面应用中重试。"); }
  };
  return <div className="settings-card ai-preview">
    <div className="ai-preview__head">
      <div><strong>现在的提示词</strong><span>按当前角色、时间和能力开关拼出来，聊天时发给 AI 的就是这些</span></div>
      <button type="button" className="settings-button settings-button--small" onClick={show}>{preview ? "刷新" : "生成"}</button>
    </div>
    {problem && <p role="status">{problem}</p>}
    {preview && <>
      <p>系统提示词</p>
      <pre className="ai-prompt-full">{preview.prompt}</pre>
      <p>工具定义（{preview.tools.length} 个）</p>
      <pre className="ai-prompt-full">{JSON.stringify(preview.tools, null, 2)}</pre>
    </>}
  </div>;
}
