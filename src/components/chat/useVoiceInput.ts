import { useEffect, useRef, useState } from "react";
import { startAudioCapture, type AudioCapture } from "../../platform/audioCapture";
import { mimoPlatform } from "../../platform/mimo";
import type { VoicePreferences } from "../../preferences/VoicePreferences";

export const MAX_RECORD_SECONDS = 120;
/** Shorter recordings hold no sentence worth sending. */
const MIN_RECORD_SECONDS = 0.3;
/** What `mimo_transcribe` fails with when the user cancelled; must match `CANCELLED` in `src-tauri/src/mimo.rs`. */
const TRANSCRIBE_CANCELLED = "cancelled";

type Audio = { base64: string; seconds: number };
export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

/** Why voice input stopped. `denied` gets a way to System Settings; `service` is a MiMo error to classify. */
export type VoiceProblem = { kind: "denied" | "mic" | "short"; message: string } | { kind: "service"; detail: string };

/** The microphone's own errors, in words the user can act on. */
function microphoneProblem(detail: string): VoiceProblem {
  if (/NotAllowed|denied/i.test(detail)) return { kind: "denied", message: "没有麦克风权限。在系统设置里允许 AI Pet 使用麦克风后再试。" };
  console.error("Could not start recording", detail);
  if (detail.includes("NotFound")) return { kind: "mic", message: "没有找到麦克风。接上麦克风后再试。" };
  if (detail.includes("NotReadable")) return { kind: "mic", message: "麦克风被别的应用占用了，关掉那个应用后再试。" };
  return { kind: "mic", message: "没能打开麦克风，请稍后再试。" };
}

interface Options {
  language: () => VoicePreferences["language"];
  /** A new attempt starts: clear the last error. */
  onAttempt: () => void;
  onText: (text: string) => void;
  onProblem: (problem: VoiceProblem) => void;
}

/**
 * Recording and transcription for the chat composer. Only one capture can
 * exist: the button is locked while the microphone starts, and a capture that
 * finishes starting after a cancel is stopped at once.
 */
export function useVoiceInput(options: Options) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [seconds, setSeconds] = useState(0);
  /** The recording whose transcription failed, so it can be tried again without speaking again. */
  const [retryAudio, setRetryAudio] = useState<Audio | null>(null);
  const capture = useRef<AudioCapture | null>(null);
  /** Set by a cancel while the microphone is still starting. */
  const aborted = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(MAX_RECORD_SECONDS, value + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const transcribe = async (audio: Audio) => {
    setPhase("transcribing");
    setRetryAudio(null);
    latest.current.onAttempt();
    try {
      latest.current.onText(await mimoPlatform.transcribe(audio.base64, latest.current.language()));
    } catch (reason) {
      const detail = String(reason);
      if (!detail.includes(TRANSCRIBE_CANCELLED)) {
        setRetryAudio(audio);
        latest.current.onProblem({ kind: "service", detail });
      }
    } finally { setPhase("idle"); }
  };

  const finish = async () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    setPhase("transcribing");
    let audio: Audio;
    try { audio = await current.stop(); } catch (reason) {
      console.error("Could not finish the recording", reason);
      setPhase("idle");
      latest.current.onProblem({ kind: "mic", message: "录音没能保存，请再录一次。" });
      return;
    }
    if (audio.seconds < MIN_RECORD_SECONDS) {
      setPhase("idle");
      latest.current.onProblem({ kind: "short", message: "录音太短了，请说一句完整的话。" });
      return;
    }
    await transcribe(audio);
  };

  const start = async () => {
    aborted.current = false;
    setPhase("starting");
    setRetryAudio(null);
    latest.current.onAttempt();
    let started: AudioCapture;
    try {
      // The limit only ends the capture it belongs to, never a later one.
      started = await startAudioCapture(() => { if (capture.current === started) { setSeconds(MAX_RECORD_SECONDS); void finish(); } });
    } catch (reason) {
      setPhase("idle");
      latest.current.onProblem(microphoneProblem(String(reason)));
      return;
    }
    if (aborted.current) { void started.stop().catch(() => {}); return; }
    capture.current = started;
    setSeconds(0);
    setPhase("recording");
  };

  /** Throws the recording away, or stops a microphone that is still starting. */
  const cancel = () => {
    aborted.current = true;
    const current = capture.current;
    capture.current = null;
    if (current) void current.stop().catch(() => {});
    setPhase((value) => (value === "transcribing" ? value : "idle"));
  };

  const cancelTranscription = () => {
    mimoPlatform.cancelTranscription().catch((reason: unknown) => console.warn("Could not cancel the transcription", reason));
  };

  // A recording must never outlive the chat page, e.g. when the character changes.
  useEffect(() => () => cancel(), []);

  return {
    phase,
    seconds,
    retryAudio,
    /** Starts recording, or stops it and transcribes what was said. */
    toggle: () => { if (phase === "recording") void finish(); else if (phase === "idle") void start(); },
    cancel,
    cancelTranscription,
    retry: () => { if (retryAudio && phase === "idle") void transcribe(retryAudio); },
    dropRetry: () => setRetryAudio(null),
  };
}
