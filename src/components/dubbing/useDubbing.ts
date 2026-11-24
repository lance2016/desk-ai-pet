import { useCallback, useEffect, useRef, useState } from "react";
import { classifyServiceError, isKeyProblem, serviceErrorMessage } from "../../chat/serviceErrors";
import { type Clip, type Clips, type Line, nextLines, withoutStale } from "../../dubbing/clips";
import { decodeBase64, joinPcm } from "../../dubbing/wav";
import { mimoPlatform } from "../../platform/mimo";
import { CLONED_VOICE_PREFIX } from "../../types";

/** Lines synthesized at once. Fewer wastes the waiting; more runs into the services' rate limits. */
const MAX_PARALLEL = 3;

/** What went wrong for the whole run, and whether the fix is in settings. */
export interface DubbingProblem { message: string; settings: boolean }

/** Turns a service's message into one the user can act on. */
function describe(detail: string, voice: string): { message: string; settings: boolean } {
  const kind = classifyServiceError(detail);
  const service = voice.startsWith(CLONED_VOICE_PREFIX) ? "CosyVoice" : "MiMo";
  // A cloned voice's own message (still under review, deleted) already says what to do.
  const message = kind === "voice" ? detail : serviceErrorMessage(service, kind);
  return { message, settings: isKeyProblem(kind) };
}

/**
 * Makes audio for the script's lines through the read-aloud commands, a few at a time.
 * Audio stays in memory for as long as the window is open; a line whose words, voice or
 * delivery change needs new audio, the others keep theirs.
 */
export function useDubbing(lines: readonly Line[]) {
  const [clips, setClipsState] = useState<Clips>(() => new Map());
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<DubbingProblem | null>(null);
  const clipsRef = useRef(clips);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const runningRef = useRef(false);
  /** Requests in flight by id: which line, and the audio received so far. */
  const requests = useRef(new Map<string, { line: Line; chunks: Uint8Array[] }>());
  /** `settle` starts the next lines through `pump`, and `pump` reports a failed start through `settle`. */
  const settleRef = useRef<(id: string, outcome: Uint8Array | string | null) => void>(() => {});

  const setClips = useCallback((change: (current: Clips) => Clips) => {
    clipsRef.current = change(clipsRef.current);
    setClipsState(clipsRef.current);
  }, []);

  const halt = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    for (const id of requests.current.keys()) {
      void mimoPlatform.cancelSpeech(id).catch((reason: unknown) => console.warn("Could not stop a dubbing request", reason));
    }
    requests.current.clear();
    setClips((current) => new Map([...current].filter(([, clip]) => clip.status !== "making")));
  }, [setClips]);

  const pump = useCallback(() => {
    if (!runningRef.current) return;
    const todo = nextLines(linesRef.current, clipsRef.current, requests.current.size, MAX_PARALLEL);
    if (todo.length === 0 && requests.current.size === 0) {
      runningRef.current = false;
      setRunning(false);
      return;
    }
    for (const line of todo) {
      const id = `read-${crypto.randomUUID()}`;
      requests.current.set(id, { line, chunks: [] });
      setClips((current) => new Map(current).set(line.key, { status: "making" }));
      mimoPlatform.startSynthesis(id, line.text, line.voice, line.style).catch((reason: unknown) => settleRef.current(id, String(reason).replace(/^Error:\s*/, "")));
    }
  }, [setClips]);

  /** Ends one request with its audio, an error message, or nothing when it was cancelled. */
  const settle = useCallback((id: string, outcome: Uint8Array | string | null) => {
    const request = requests.current.get(id);
    if (!request) return;
    requests.current.delete(id);
    const { line } = request;
    if (typeof outcome === "string") {
      const failure = describe(outcome, line.voice);
      console.warn("Dubbing a line failed", outcome);
      if (failure.settings) {
        // Every other line would fail the same way.
        setProblem(failure);
        halt();
        return;
      }
      setClips((current) => new Map(current).set(line.key, { status: "failed", error: failure.message }));
    } else if (outcome === null || outcome.length === 0) {
      const clip: Clip | null = outcome === null ? null : { status: "failed", error: "没有生成出声音，再试一次。" };
      setClips((current) => {
        const next = new Map(current);
        if (clip) next.set(line.key, clip); else next.delete(line.key);
        return next;
      });
    } else {
      setClips((current) => new Map(current).set(line.key, { status: "ready", pcm: outcome }));
    }
    pump();
  }, [halt, pump, setClips]);
  settleRef.current = settle;

  useEffect(() => {
    let stopListening: (() => void) | null = null;
    let disposed = false;
    mimoPlatform.subscribeAudio((event) => {
      const request = requests.current.get(event.id);
      if (!request) return;
      if (event.kind === "chunk") request.chunks.push(decodeBase64(event.data));
      else if (event.kind === "done") settle(event.id, joinPcm(request.chunks));
      else if (event.kind === "error") settle(event.id, event.data);
      else settle(event.id, null);
    }).then((unlisten) => { if (disposed) unlisten(); else stopListening = unlisten; })
      .catch((reason: unknown) => console.warn("Could not listen for dubbing audio", reason));
    return () => {
      disposed = true;
      stopListening?.();
      for (const id of requests.current.keys()) void mimoPlatform.cancelSpeech(id).catch(() => {});
      requests.current.clear();
    };
  }, [settle]);

  /** Makes the lines that have no audio yet, trying failed ones again. */
  const generate = useCallback(() => {
    setProblem(null);
    setClips((current) => withoutStale(current, linesRef.current, { failed: true }));
    runningRef.current = true;
    setRunning(true);
    pump();
  }, [pump, setClips]);

  return { clips, running, problem, generate, stop: halt };
}
