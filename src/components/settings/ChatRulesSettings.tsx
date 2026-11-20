import { useState } from "react";
import { ai, type ChatPreview } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { CHAT_SKILLS } from "../../skills";
import { ChatRequestDetails } from "./ChatRequestDetails";

/** The rules every character shares, previewed with the current character's settings filled in. */
export function ChatRulesSettings({ packId, persona, actions }: { packId: string; persona?: PetPersona; actions: string[] }) {
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const showPreview = () => {
    setPreviewError("");
    try { setPreview(ai.preview(requestPreferences(packId, persona), chatContext(Date.now(), actions, currentChatFacts()), CHAT_SKILLS)); }
    catch (reason) { console.error("Could not preview chat request", reason); setPreviewError("没能生成预览，请在桌面应用中重试。"); }
  };
  return <div className="settings-card ai-preview"><div className="ai-preview__head"><div><strong>规则与能力</strong><span>每次聊天都会带上，可逐段调整</span></div><button type="button" className="settings-button settings-button--small" onClick={showPreview}>{preview ? "刷新预览" : "查看和修改"}</button></div>{previewError && <p role="status">{previewError}</p>}{preview && <ChatRequestDetails preview={preview} onChanged={showPreview} onError={setPreviewError} />}</div>;
}
