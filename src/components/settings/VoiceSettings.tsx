import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PetPersona } from "../../assets/Manifest";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { cosyvoicePlatform, type ClonedVoice } from "../../platform/cosyvoice";
import { loadVoicePreferences, resetVoicePreferences, saveVoicePreferences, voiceDefaults, type VoicePreferences } from "../../preferences/VoicePreferences";
import { CLONED_VOICE_PREFIX, PERSONA_LIMITS } from "../../types";
import { useReadAloud } from "../chat/useReadAloud";
import { Chevron } from "./Chevron";

/** MiMo's own voices, by the language they speak. */
export const PRESETS: readonly { label: string; voices: readonly [string, string][] }[] = [
  { label: "中文", voices: [["冰糖", "冰糖 · 女声"], ["茉莉", "茉莉 · 女声"], ["苏打", "苏打 · 男声"], ["白桦", "白桦 · 男声"]] },
  { label: "English", voices: [["Mia", "Mia · 女声"], ["Chloe", "Chloe · 女声"], ["Milo", "Milo · 男声"], ["Dean", "Dean · 男声"]] },
  { label: "其他", voices: [["mimo_default", "MiMo 默认"]] },
];
const PREVIEW_TEXT = "你好呀，今天过得怎么样？忙完手头的事，记得起来走一走。";
const PREVIEW_KEY = 0;
const NOT_SAVED = "声音没能保存，请再试一次。";

interface Props {
  packId: string;
  persona?: PetPersona;
  characterName: string;
  /** The icon of the cloned-voices page, drawn by the settings page. */
  clonesIcon: ReactNode;
  onOpenClones: () => void;
}

/** 「朗读声音」: the voice the current character reads replies in, and how it sounds. Each character keeps its own. */
export function VoiceSettings({ packId, persona, characterName, clonesIcon, onOpenClones }: Props) {
  const [preferences, setPreferences] = useState(() => loadVoicePreferences(packId, persona));
  const [clones, setClones] = useState<ClonedVoice[] | null>(null);
  const [status, setStatus] = useState("");
  const latest = useRef(preferences);
  latest.current = preferences;
  const defaults = voiceDefaults(persona);
  const defaultStyle = defaults.style;
  useEffect(() => {
    cosyvoicePlatform.listVoices().then(setClones).catch((reason: unknown) => console.warn("Could not list cloned voices", reason));
  }, []);

  const onProblem = useCallback((detail: string) => {
    const kind = classifyServiceError(detail);
    const cloned = latest.current.voice.startsWith(CLONED_VOICE_PREFIX);
    const service = cloned ? "CosyVoice" : "MiMo";
    console.warn(`${service} voice preview failed`, detail);
    setStatus(cloned && kind === "voice" ? detail : kind === "other" ? "试听没能完成，请稍后再试。" : serviceErrorMessage(service, kind));
  }, []);
  const voiceNow = useCallback(() => {
    const current = latest.current;
    // A persona's default delivery prompt can conflict with a clone's recorded voice and hurt similarity.
    const style = current.voice.startsWith(CLONED_VOICE_PREFIX) && current.style === defaultStyle ? "" : current.style;
    return { voice: current.voice, style };
  }, [defaultStyle]);
  const preview = useReadAloud({ voice: voiceNow, onProblem });

  const update = (next: VoicePreferences) => {
    preview.stop();
    try { saveVoicePreferences(packId, next); setPreferences(next); setStatus(""); }
    catch (reason) { console.error("Could not save voice preferences", reason); setStatus(NOT_SAVED); }
  };
  const reset = () => {
    preview.stop();
    try { resetVoicePreferences(packId); setPreferences(voiceDefaults(persona)); setStatus(""); }
    catch (reason) { console.error("Could not reset voice preferences", reason); setStatus(NOT_SAVED); }
  };

  const changed = preferences.voice !== defaults.voice || preferences.style !== defaults.style;
  const cloned = preferences.voice.startsWith(CLONED_VOICE_PREFIX);
  // A cloned voice that is gone still shows, so the menu never claims another voice is in use.
  const missing = cloned && clones !== null && !clones.some((voice) => `${CLONED_VOICE_PREFIX}${voice.id}` === preferences.voice);
  const phase = preview.reading?.phase;
  const previewLabel = phase === "preparing" ? "准备中…" : phase === "playing" ? "停止" : "试听";

  return <>
    <h2 className="settings-group-title">朗读声音</h2>
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>声音</strong><span>{characterName}读回复时用，每个角色各自设置</span><q className="voice-sample">{PREVIEW_TEXT}</q></div>
        <select className="ui-select" aria-label="声音" value={preferences.voice} onChange={(event) => update({ ...preferences, voice: event.currentTarget.value })}>
          {PRESETS.map((group) => <optgroup key={group.label} label={group.label}>{group.voices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}
          {clones && clones.length > 0 && <optgroup label="克隆的声音">{clones.map((voice) => <option key={voice.id} value={`${CLONED_VOICE_PREFIX}${voice.id}`}>{voice.name}</option>)}</optgroup>}
          {missing && <option value={preferences.voice} disabled>已删除的声音</option>}
        </select>
        <button type="button" className="ui-button ui-button--small voice-preview" aria-label={phase ? "停止试听" : "试听这个声音"} onClick={() => preview.toggle(PREVIEW_KEY, PREVIEW_TEXT)}>{previewLabel}</button>
      </div>
      <div className="settings-row voice-style">
        <label className="settings-row__body" htmlFor="voice-style"><strong>语气</strong><span>{cloned ? "克隆音色默认保留录音里的感觉，也可以在这里调整" : "一句话写清语速和情绪"}</span></label>
        <textarea className="ui-textarea" id="voice-style" value={cloned && preferences.style === defaultStyle ? "" : preferences.style} maxLength={PERSONA_LIMITS.voiceStyle} placeholder={cloned ? "留空保留录音音色；填写后调整语速和情绪" : "例如：轻快、带点笑意，语速稍慢"} onChange={(event) => update({ ...preferences, style: event.currentTarget.value })} />
        <span className="voice-style__foot">{changed ? <button type="button" className="ui-link" onClick={reset}>恢复{characterName}的默认声音</button> : <span />}<small>{preferences.style.length} / {PERSONA_LIMITS.voiceStyle}</small></span>
      </div>
      <button type="button" className="settings-row settings-link" onClick={onOpenClones}>{clonesIcon}<span className="settings-row__body"><strong>克隆的声音</strong><span>{clones?.length ? `已有 ${clones.length} 个，录一段或选个文件再加` : "录一段或选个文件，让角色用这个声音说话"}</span></span><Chevron /></button>
    </div>
    {status && <p className="settings-footnote" role="status">{status}</p>}
  </>;
}
