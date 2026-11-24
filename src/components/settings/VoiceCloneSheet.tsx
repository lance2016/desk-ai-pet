import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { startAudioCapture, type AudioCapture } from "../../platform/audioCapture";
import { cosyvoicePlatform, type ClonedVoice } from "../../platform/cosyvoice";
import { isComposing } from "../keyboard";
import { moveRadioChoice } from "./radioKeys";

/** Keep the captured sample within the same duration range accepted by the native command. */
const MAX_RECORD_SECONDS = 30;
const MIN_RECORD_SECONDS = 3;
/** Base64 of this stays under `MAX_SAMPLE_BASE64` in `src-tauri/src/cloned_voices.rs`. */
const MAX_FILE_BYTES = 3_000_000;
const NAME_LIMIT = 20;
const SCRIPT = "今天天气不错，我泡了一杯茶，打算把手头的事慢慢做完。等忙完了，再出去走一走，晒晒太阳。路上有风，也有树叶的声音，今天就先到这里吧。";

type Format = "wav" | "mp3";
type Sample = { base64: string; format: Format; seconds: number; from: string };
type Source = "record" | "file";

function fileFormat(file: File): Format | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".wav") || /wav/.test(file.type)) return "wav";
  if (name.endsWith(".mp3") || file.type === "audio/mpeg") return "mp3";
  return null;
}

const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
  reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
  reader.readAsDataURL(file);
});

/** How long the file plays, or 0 when WebKit cannot tell. */
const playLength = (file: File) => new Promise<number>((resolve) => {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  const done = (seconds: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(seconds) ? seconds : 0); };
  audio.onloadedmetadata = () => done(audio.duration);
  audio.onerror = () => done(0);
  audio.src = url;
});

const clock = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`;

/** The sheet that adds a cloned voice: a name, a sample recorded here or picked from a file, and the user's word that they may use it. */
export function VoiceCloneSheet({ onAdded, onClose }: { onAdded: (voice: ClonedVoice) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("record");
  const [sample, setSample] = useState<Sample | null>(null);
  const [recording, setRecording] = useState<"starting" | "on" | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const capture = useRef<AudioCapture | null>(null);
  /** Set when the sheet goes away, so a microphone that finishes starting afterwards is turned off. */
  const closed = useRef(false);
  const card = useRef<HTMLFormElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameField.current?.focus();
    return () => { closed.current = true; void capture.current?.stop().catch(() => {}); opener?.focus(); };
  }, []);
  useEffect(() => {
    if (recording !== "on") return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(MAX_RECORD_SECONDS, value + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const stopRecording = async () => {
    const current = capture.current;
    capture.current = null;
    if (!current) return;
    setRecording(null);
    try {
      const audio = await current.stop();
      if (audio.seconds < MIN_RECORD_SECONDS) { setProblem(`录音太短了，至少读 ${MIN_RECORD_SECONDS} 秒。`); return; }
      setSample({ base64: audio.base64, format: "wav", seconds: audio.seconds, from: "录音" });
    } catch (reason) {
      console.error("Could not finish the voice sample", reason);
      setProblem("录音没能保存，请再录一次。");
    }
  };
  const startRecording = async () => {
    setProblem(""); setSample(null); setSeconds(0); setRecording("starting");
    try {
      const started = await startAudioCapture(() => { if (capture.current === started) void stopRecording(); }, MAX_RECORD_SECONDS);
      if (closed.current) { void started.stop().catch(() => {}); return; }
      capture.current = started;
      setRecording("on");
    } catch (reason) {
      setRecording(null);
      const detail = String(reason);
      console.error("Could not start the voice sample", detail);
      setProblem(/NotAllowed|denied/i.test(detail) ? "没有麦克风权限。在系统设置里允许 AI Pet 使用麦克风，或者改用「选文件」。" : "没能打开麦克风，可以改用「选文件」。");
    }
  };
  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setProblem(""); setSample(null);
    const format = fileFormat(file);
    if (!format) { setProblem("只支持 wav 和 mp3 文件。"); return; }
    if (file.size > MAX_FILE_BYTES) { setProblem("文件太大了，剪成 30 秒以内、3 MB 以下再选。"); return; }
    try {
      const [base64, length] = await Promise.all([readBase64(file), playLength(file)]);
      if (length < MIN_RECORD_SECONDS || length > MAX_RECORD_SECONDS) {
        setProblem(`声音片段需要 ${MIN_RECORD_SECONDS} 到 ${MAX_RECORD_SECONDS} 秒；建议录 10 到 20 秒。`);
        return;
      }
      setSample({ base64, format, seconds: length, from: file.name });
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, "").slice(0, NAME_LIMIT));
    } catch (reason) {
      console.error("Could not read the voice file", reason);
      setProblem("这个文件读不出来，换一个试试。");
    }
  };
  const switchSource = (next: Source) => {
    if (recording) return;
    setSource(next); setSample(null); setProblem("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!sample || !consent || !name.trim()) return;
    setSaving(true); setProblem("");
    try { onAdded(await cosyvoicePlatform.addVoice(name.trim(), sample.base64, sample.format, sample.seconds)); }
    catch (reason) {
      console.error("Could not add a cloned voice", reason);
      const text = String(reason).replace(/^Error:\s*/, "");
      setProblem(/[一-鿿]/.test(text) ? text : "没能保存这个声音，请再试一次。");
      setSaving(false);
    }
  };
  // Esc closes like 取消, but not once there is a sample to lose: then only 取消 does. Tab stays inside the sheet.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { if (!isComposing(event) && !sample && !recording) { event.preventDefault(); onClose(); } return; }
    if (event.key !== "Tab" || !card.current) return;
    const focusable = Array.from(card.current.querySelectorAll<HTMLElement>("input, button, textarea, audio, select")).filter((item) => !item.hasAttribute("disabled"));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const ready = Boolean(sample && consent && name.trim()) && !saving && !recording;
  return <div className="voice-clone" role="dialog" aria-modal="true" aria-labelledby="voice-clone-title" onKeyDown={onKeyDown}>
    <form ref={card} className="voice-clone__card" onSubmit={(event) => void save(event)}>
      <h2 id="voice-clone-title">添加克隆声音</h2>
      <label className="voice-clone__field">名字<input className="ui-field ui-field--small" ref={nameField} value={name} maxLength={NAME_LIMIT} placeholder="例如：我的声音" onChange={(event) => setName(event.currentTarget.value)} /></label>
      <div className="ui-segmented voice-clone__source" role="radiogroup" aria-label="声音来源" onKeyDown={moveRadioChoice}>
        {([["record", "录一段"], ["file", "选文件"]] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={source === value} className={source === value ? "is-selected" : ""} disabled={Boolean(recording)} onClick={() => switchSource(value)}>{label}</button>)}
      </div>
      {source === "record" ? <div className="voice-clone__panel">
        <p>用平常说话的语气读这段：</p>
        <blockquote>{SCRIPT}</blockquote>
        <div className="voice-clone__row">
          {recording === "on"
            ? <button type="button" className="ui-button voice-clone__rec is-on" onClick={() => void stopRecording()}>停止录音</button>
            : <button type="button" className="ui-button voice-clone__rec" disabled={recording === "starting"} onClick={() => void startRecording()}>{sample ? "重录" : "开始录音"}</button>}
          {recording === "on" && <span className="voice-clone__clock" aria-live="off">{clock(seconds)} / {clock(MAX_RECORD_SECONDS)}</span>}
        </div>
      </div> : <div className="voice-clone__panel">
        <p>wav 或 mp3，3 MB 以内、3 到 30 秒；建议 10 到 20 秒。只有一个人在说话、没有背景音乐的片段效果最好。</p>
        <div className="voice-clone__row">
          <label className="ui-button voice-clone__file">选择文件…<input type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" onChange={(event) => void pickFile(event)} /></label>
          {sample && <span className="voice-clone__name">{sample.from}</span>}
        </div>
      </div>}
      {sample && <audio className="voice-clone__play" controls src={`data:${sample.format === "wav" ? "audio/wav" : "audio/mpeg"};base64,${sample.base64}`} aria-label="听一下这段声音" />}
      <label className="voice-clone__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} />这是我自己的声音，或者声音的主人同意我这样用</label>
      <p className="voice-clone__note">录音会上传到阿里云百炼创建 CosyVoice 音色，并保留在云端直到删除。原始片段也保存在本机、不进备份；朗读时会把文字发给阿里云合成。</p>
      {problem && <p className="voice-clone__problem" role="alert">{problem}</p>}
      <div className="voice-clone__actions">
        <button type="button" className="ui-button" onClick={onClose}>取消</button>
        <button type="submit" className="ui-button ui-button--primary" disabled={!ready}>{saving ? "正在创建音色…" : "添加"}</button>
      </div>
    </form>
  </div>;
}
