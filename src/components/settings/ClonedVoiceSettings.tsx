import { useEffect, useState } from "react";
import { mimoPlatform, type ClonedVoice } from "../../platform/mimo";
import { forgetVoice } from "../../preferences/VoicePreferences";
import { CLONED_VOICE_PREFIX } from "../../types";
import { ConfirmButton } from "../ConfirmButton";
import { VoiceCloneSheet } from "./VoiceCloneSheet";

/** Must match `MAX_VOICES` in `src-tauri/src/mimo_voices.rs`. */
const MAX_CLONES = 10;

const describe = (voice: ClonedVoice) => {
  const added = new Date(voice.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  return voice.seconds >= 1 ? `${Math.round(voice.seconds)} 秒 · ${added}添加` : `${added}添加`;
};

/** 「克隆的声音」: the samples MiMo clones voices from, shared by every character. */
export function ClonedVoiceSettings() {
  const [voices, setVoices] = useState<ClonedVoice[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    mimoPlatform.listVoices().then(setVoices).catch((reason: unknown) => {
      console.error("Could not list cloned voices", reason);
      setVoices([]);
      setStatus("读不到克隆的声音，请在 AI Pet 应用里打开设置。");
    });
  }, []);

  const remove = async (voice: ClonedVoice) => {
    setStatus("");
    try {
      await mimoPlatform.removeVoice(voice.id);
      forgetVoice(`${CLONED_VOICE_PREFIX}${voice.id}`);
      setVoices((current) => current?.filter((item) => item.id !== voice.id) ?? null);
      setStatus(`已删除：${voice.name}`);
    } catch (reason) {
      console.error("Could not delete a cloned voice", reason);
      setStatus("没能删除，请再试一次。");
    }
  };
  const added = (voice: ClonedVoice) => {
    setAdding(false);
    setVoices((current) => [...(current ?? []), voice]);
    setStatus(`已添加：${voice.name}。回到「AI 服务」，在「声音」里选它`);
  };
  const full = (voices?.length ?? 0) >= MAX_CLONES;

  return <div className="settings-section">
    <div className="settings-section__intro"><p>MiMo 会照着这段声音朗读。所有角色共用，在「AI 服务」的「声音」里选</p></div>
    <div className="settings-group">
      {voices?.length === 0 && <div className="settings-row"><div className="settings-row__body"><span>还没有克隆的声音</span></div></div>}
      {voices?.map((voice) => <div key={voice.id} className="settings-row">
        <div className="settings-row__body"><strong>{voice.name}</strong><span>{describe(voice)}</span></div>
        <ConfirmButton className="settings-button settings-button--small" confirm={{ message: `删除「${voice.name}」？`, detail: "这段声音会从这台电脑上删掉。用它朗读的角色会换回自己原来的声音。", action: "删除" }} onConfirm={() => void remove(voice)}>删除</ConfirmButton>
      </div>)}
      <div className="settings-row">
        <div className="settings-row__body"><strong>添加声音</strong><span>{full ? `最多 ${MAX_CLONES} 个，先删掉一个再加` : "几秒到半分钟就够，安静的地方、平常的语速效果最好"}</span></div>
        <button type="button" className="settings-button settings-button--small" disabled={voices === null || full} onClick={() => { setStatus(""); setAdding(true); }}>添加…</button>
      </div>
    </div>
    {status && <p className="settings-footnote" role="status">{status}</p>}
    <p className="settings-footnote">只用你自己的声音，或者声音的主人同意你这样用。声音片段只存在这台电脑上，每次用它朗读时会和文字一起发给小米 MiMo；备份里不含这些声音。</p>
    {adding && <VoiceCloneSheet onAdded={added} onClose={() => setAdding(false)} />}
  </div>;
}
