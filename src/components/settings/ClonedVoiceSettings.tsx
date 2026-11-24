import { useEffect, useState } from "react";
import { cosyvoicePlatform, type ClonedVoice } from "../../platform/cosyvoice";
import { forgetVoice } from "../../preferences/VoicePreferences";
import { CLONED_VOICE_PREFIX } from "../../types";
import { ConfirmButton } from "../ConfirmButton";
import { VoiceCloneSheet } from "./VoiceCloneSheet";

/** Must match `MAX_VOICES` in `src-tauri/src/cloned_voices.rs`. */
const MAX_CLONES = 10;

const describe = (voice: ClonedVoice) => {
  const added = new Date(voice.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  const duration = voice.seconds >= 1 ? `${Math.round(voice.seconds)} 秒 · ` : "";
  const status = voice.serviceStatus === "DEPLOYING" ? " · 云端处理中" : voice.serviceStatus === "UNDEPLOYED" ? " · 云端审核未通过" : "";
  return `${duration}${added}添加${status}`;
};

/** 「克隆的声音」: CosyVoice voice IDs and local source samples, shared by every character. */
export function ClonedVoiceSettings({ onOpenAI }: { onOpenAI: () => void }) {
  const [voices, setVoices] = useState<ClonedVoice[] | null>(null);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    cosyvoicePlatform.listVoices().then(setVoices).catch((reason: unknown) => {
      console.error("Could not list cloned voices", reason);
      setVoices([]);
      setStatus("读不到克隆的声音，请在 AI Pet 应用里打开设置。");
    });
    cosyvoicePlatform.keyStatus().then(setKeyConfigured).catch((reason: unknown) => {
      console.error("Could not read CosyVoice key status", reason);
      setKeyConfigured(false);
      setStatus("读不到阿里云百炼 API Key 配置，请在 AI Pet 应用里打开设置。");
    });
  }, []);

  const remove = async (voice: ClonedVoice) => {
    setStatus("");
    try {
      await cosyvoicePlatform.removeVoice(voice.id);
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
    setStatus(voice.serviceStatus === "DEPLOYING"
      ? `已提交「${voice.name}」的云端音色创建，阿里云审核或处理完成后即可试听。`
      : `已添加：${voice.name}。回到「AI 服务」，在「声音」里选它`);
  };
  const full = (voices?.length ?? 0) >= MAX_CLONES;

  return <div className="settings-section">
    <div className="settings-section__intro"><p>用阿里云百炼 CosyVoice 创建克隆音色，所有角色共用。在「AI 服务」的「声音」里选择</p></div>
    {keyConfigured === false && <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>先连接阿里云百炼</strong><span>需要中国内地（北京）地域的百炼 API Key，才能创建或删除云端音色</span></div><button type="button" className="settings-button settings-button--small" onClick={onOpenAI}>去配置</button></div></div>}
    <div className="settings-group">
      {voices?.length === 0 && <div className="settings-row"><div className="settings-row__body"><span>还没有克隆的声音</span></div></div>}
      {voices?.map((voice) => <div key={voice.id} className="settings-row">
        <div className="settings-row__body"><strong>{voice.name}</strong><span>{describe(voice)}</span></div>
        <ConfirmButton className="settings-button settings-button--small" disabled={Boolean(voice.serviceVoiceId && !keyConfigured)} confirm={{ message: `删除「${voice.name}」？`, detail: `${voice.serviceVoiceId ? "会从阿里云百炼删除克隆音色，并从这台电脑删除录音。" : "会从这台电脑删除原始录音。"}用它朗读的角色会换回原来的声音。`, action: "删除" }} onConfirm={() => void remove(voice)}>删除</ConfirmButton>
      </div>)}
      <div className="settings-row">
        <div className="settings-row__body"><strong>添加声音</strong><span>{full ? `最多 ${MAX_CLONES} 个，先删掉一个再加` : keyConfigured ? "建议录 10 到 20 秒，安静的地方、平常语速效果最好" : "配置阿里云百炼 API Key 后即可添加"}</span></div>
        <button type="button" className="settings-button settings-button--small" disabled={voices === null || full || !keyConfigured} onClick={() => { setStatus(""); setAdding(true); }}>添加…</button>
      </div>
    </div>
    {status && <p className="settings-footnote" role="status">{status}</p>}
    <p className="settings-footnote">只用你自己的声音，或者声音的主人同意你这样用。创建音色时，录音会上传并保存在阿里云百炼；原始录音留在本机、不进备份。删除云端音色需要保留可用的百炼 API Key。</p>
    {voices?.some((voice) => !voice.serviceVoiceId) && <p className="settings-footnote">旧版留下的录音会在第一次试听时自动上传到百炼创建 CosyVoice 音色；不想上传的话，请先删除这个声音。</p>}
    {adding && <VoiceCloneSheet onAdded={added} onClose={() => setAdding(false)} />}
  </div>;
}
