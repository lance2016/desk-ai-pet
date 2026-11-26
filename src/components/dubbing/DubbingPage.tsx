import { useEffect, useMemo, useRef, useState } from "react";
import { linesOf, progressOf } from "../../dubbing/clips";
import { DubPlayer } from "../../dubbing/DubPlayer";
import { EXPORT_FORMATS, loadDraft, saveDraft, type DubbingDraft, type ExportFormat } from "../../dubbing/DubbingStore";
import { MAX_SCRIPT_CHARS, splitScript } from "../../dubbing/script";
import { MAX_EXPORT_SECONDS, encodeWav, pcmSeconds, toSrt, totalSeconds } from "../../dubbing/wav";
import { cosyvoicePlatform, type ClonedVoice } from "../../platform/cosyvoice";
import { dialogPlatform } from "../../platform/dialog";
import { dubbingPlatform } from "../../platform/dubbing";
import { petWindow } from "../../platform/petWindow";
import { CLONED_VOICE_PREFIX, PERSONA_LIMITS } from "../../types";
import { PRESETS } from "../settings/VoiceSettings";
import { recordUse } from "../../usage/usage";
import { useDubbing } from "./useDubbing";
import "./DubbingPage.css";
import { Icon } from "../../ui/icons";

/** The voice used when none is chosen and there is no cloned one. */
const FALLBACK_VOICE = "冰糖";
const FORMAT_LABELS: Record<ExportFormat, string> = { m4a: "M4A", wav: "WAV" };

function duration(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${String(whole % 60).padStart(2, "0")} 秒`;
}

/** Plays one line, or every line in order; `index` is the line sounding now. */
type Playing = { all: boolean; index: number };

/** 「配音」: a script read in a chosen voice, line by line, and exported as one audio file with subtitles. */
export function DubbingPage() {
  const [draft, setDraft] = useState<DubbingDraft>(() => loadDraft());
  const [clones, setClones] = useState<ClonedVoice[] | null>(null);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [exporting, setExporting] = useState(false);
  const player = useRef<DubPlayer | null>(null);
  // The window is made when it opens and destroyed when it closes, so this runs once per opening.
  useEffect(() => { recordUse("dubbing"); }, []);

  useEffect(() => {
    document.documentElement.classList.add("dubbing-window");
    document.body.classList.add("dubbing-window");
    cosyvoicePlatform.listVoices().then(setClones).catch((reason: unknown) => {
      console.warn("Could not list cloned voices", reason);
      setClones([]);
    });
    return () => { void player.current?.close(); };
  }, []);

  const firstClone = clones?.[0] ? `${CLONED_VOICE_PREFIX}${clones[0].id}` : null;
  const voice = draft.voice || firstClone || FALLBACK_VOICE;
  const missingVoice = voice.startsWith(CLONED_VOICE_PREFIX) && clones !== null && !clones.some((clone) => `${CLONED_VOICE_PREFIX}${clone.id}` === voice);
  const texts = useMemo(() => splitScript(draft.text), [draft.text]);
  const lines = useMemo(() => linesOf(texts, voice, draft.style.trim()), [texts, voice, draft.style]);
  const dub = useDubbing(lines);
  const progress = progressOf(lines, dub.clips);
  const pieces = lines.map((line) => dub.clips.get(line.key)).map((clip) => (clip?.status === "ready" ? clip.pcm : null));
  const allReady = lines.length > 0 && pieces.every((pcm) => pcm !== null);
  const readyPieces = pieces.filter((pcm): pcm is Uint8Array => pcm !== null);
  /** The audio made so far, by its lines; it differs from what was last exported until it is exported again. */
  const madeKey = lines.filter((_, index) => pieces[index] !== null).map((line) => line.key).join("\n");
  const exportedKey = useRef("");
  const unsavedRef = useRef(false);
  unsavedRef.current = madeKey !== "" && madeKey !== exportedKey.current;

  // Closing destroys the window and the audio in it: ask first while some was made and not exported.
  useEffect(() => dubbingPlatform.onCloseRequested(async () => !unsavedRef.current || dialogPlatform.confirm({
    message: "关掉配音窗口？",
    detail: "已经生成的声音还没导出，关掉后就没了，要重新生成。稿子会留着。",
    action: "关掉",
  })), []);

  // New words or a new voice make what is playing out of date.
  useEffect(() => { player.current?.stop(); setPlaying(null); }, [lines]);

  const update = (change: Partial<DubbingDraft>) => {
    const next = { ...draft, ...change };
    setDraft(next);
    setNotice("");
    try { saveDraft(next); } catch (reason) { console.warn("Could not save the dubbing draft", reason); }
  };

  const play = (all: boolean, from: number) => {
    if (playing && playing.all === all && (all || playing.index === from)) { player.current?.stop(); setPlaying(null); return; }
    const chosen = all ? readyPieces : [pieces[from]].filter((pcm): pcm is Uint8Array => pcm !== null);
    player.current ??= new DubPlayer();
    setPlaying({ all, index: from });
    player.current.play(chosen, (index) => setPlaying({ all, index: all ? index : from }), () => setPlaying(null));
  };

  const exportAll = async () => {
    if (!allReady) return;
    if (totalSeconds(readyPieces) > MAX_EXPORT_SECONDS) { setNotice("超过 30 分钟了，分成几份导出吧。"); return; }
    setExporting(true);
    setNotice("");
    try {
      const audio = await dubbingPlatform.exportAudio(encodeWav(readyPieces), draft.format);
      if (!audio) return;
      exportedKey.current = madeKey;
      if (!draft.subtitles) { setNotice(`已导出：${audio}`); return; }
      const subtitles = await dubbingPlatform.exportSubtitles(toSrt(lines.map((line, index) => ({ text: line.text, pcm: readyPieces[index] }))));
      setNotice(`已导出：${audio}、${subtitles}`);
    } catch (reason) {
      console.error("Dubbing export failed", reason);
      setNotice(String(reason).replace(/^Error:\s*/, ""));
    } finally {
      setExporting(false);
    }
  };

  const generateLabel = dub.running ? "停止" : progress.missing + progress.failed > 0 ? `生成 ${progress.missing + progress.failed} 段` : "已全部生成";
  const summary = lines.length === 0
    ? "还没有稿子"
    : allReady
      ? `共 ${lines.length} 段，${duration(totalSeconds(readyPieces))}`
      : `已生成 ${progress.ready} / ${lines.length} 段${progress.failed ? `，${progress.failed} 段失败` : ""}`;

  return (
    <div className="dub-page">
      <header className="dub-toolbar">
        <label className="dub-field">
          <span>声音</span>
          <select className="ui-select ui-select--large" value={missingVoice ? "" : voice} onChange={(event) => update({ voice: event.currentTarget.value })}>
            {missingVoice && <option value="" disabled>已删除的声音</option>}
            {clones && clones.length > 0 && <optgroup label="克隆的声音">{clones.map((clone) => <option key={clone.id} value={`${CLONED_VOICE_PREFIX}${clone.id}`}>{clone.name}</option>)}</optgroup>}
            {PRESETS.map((group) => <optgroup key={group.label} label={group.label}>{group.voices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="dub-field dub-field--grow">
          <span>语气</span>
          <input className="ui-field" value={draft.style} maxLength={PERSONA_LIMITS.voiceStyle} placeholder={voice.startsWith(CLONED_VOICE_PREFIX) ? "留空保留录音里的感觉，例如：语速稍慢、像在讲解" : "例如：轻快、带点笑意，语速稍慢"} onChange={(event) => update({ style: event.currentTarget.value })} />
        </label>
      </header>

      <main className="dub-body">
        <section className="dub-card dub-script" aria-label="稿子">
          <textarea value={draft.text} maxLength={MAX_SCRIPT_CHARS} placeholder="把要配音的文字贴在这里，会按句子自动分段" onChange={(event) => update({ text: event.currentTarget.value })} />
          <small className="dub-count">{[...draft.text].length} / {MAX_SCRIPT_CHARS}</small>
        </section>

        <section className="dub-card dub-lines" aria-label="分段">
          {lines.length === 0
            ? <p className="dub-empty">贴上稿子后，每一句会出现在这里。生成后可以逐句试听，有一句不满意就改字，只重新生成这一句。</p>
            : <ol>
              {lines.map((line, index) => {
                const clip = dub.clips.get(line.key);
                const sounding = playing?.index === index;
                return (
                  <li key={`${index}-${line.key}`} className={sounding ? "dub-line is-playing" : "dub-line"}>
                    <span className="dub-line__number">{index + 1}</span>
                    <span className="dub-line__text">{line.text}</span>
                    <span className="dub-line__state">
                      {clip?.status === "making" && <span className="dub-spinner" aria-label="生成中" />}
                      {clip?.status === "failed" && <span className="dub-line__failed">失败</span>}
                      {clip?.status === "ready" && <>
                        <span className="dub-line__seconds">{pcmSeconds(clip.pcm).toFixed(1)} 秒</span>
                        <button type="button" className="dub-icon-button" aria-label={sounding && !playing?.all ? "停止试听" : "试听这一句"} onClick={() => play(false, index)}>
                          <Icon name={sounding && !playing?.all ? "stop" : "play"} />
                        </button>
                      </>}
                    </span>
                    {clip?.status === "failed" && <span className="dub-line__error">{clip.error}</span>}
                  </li>
                );
              })}
            </ol>}
        </section>
      </main>

      <footer className="dub-footer">
        <div className="dub-footer__status" role="status">
          {dub.problem
            ? <>{dub.problem.message}{dub.problem.settings && <button type="button" className="ui-link dub-text-link" onClick={() => void petWindow.openSettings("ai").catch((reason: unknown) => console.warn("Could not open settings", reason))}>去设置</button>}</>
            : notice || (missingVoice ? "原来选的克隆声音已经删除，换一个声音再生成。" : summary)}
        </div>
        <button type="button" className="ui-button ui-button--large" disabled={lines.length === 0 || missingVoice || (!dub.running && progress.missing + progress.failed === 0)} onClick={dub.running ? dub.stop : dub.generate}>{generateLabel}</button>
        <button type="button" className="ui-button ui-button--large" disabled={!allReady} onClick={() => play(true, 0)}>{playing?.all ? "停止播放" : "播放全部"}</button>
        <span className="dub-divider" />
        <select className="ui-select ui-select--large" aria-label="导出格式" value={draft.format} onChange={(event) => update({ format: event.currentTarget.value as ExportFormat })}>
          {EXPORT_FORMATS.map((format) => <option key={format} value={format}>{FORMAT_LABELS[format]}</option>)}
        </select>
        <label className="dub-check"><input type="checkbox" checked={draft.subtitles} onChange={(event) => update({ subtitles: event.currentTarget.checked })} />字幕</label>
        <button type="button" className="ui-button ui-button--large ui-button--primary" disabled={!allReady || exporting} onClick={() => void exportAll()}>{exporting ? "导出中…" : "导出…"}</button>
      </footer>
    </div>
  );
}
