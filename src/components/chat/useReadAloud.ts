import { useCallback, useEffect, useRef, useState } from "react";
import { mimoPlatform } from "../../platform/mimo";
import { PcmAudioPlayer } from "../../platform/pcmAudioPlayer";
import { spokenText } from "./spokenText";

/** Waiting for the first sound, then playing it. */
export type ReadAloudPhase = "preparing" | "playing";
export interface ReadingReply { key: number; phase: ReadAloudPhase }

interface Options {
  /** The character's selected voice and how it should sound, read when a reply starts. */
  voice: () => { voice: string; style: string };
  /** The synthesis failed; `detail` is the native message. */
  onProblem: (detail: string) => void;
}

/**
 * Reads one chat reply aloud, one at a time: starting another stops the
 * one going, and the same reply again stops it. `key` tells the replies apart.
 */
export function useReadAloud({ voice, onProblem }: Options) {
  const [reading, setReading] = useState<ReadingReply | null>(null);
  const request = useRef<string | null>(null);
  const readingKey = useRef<number | null>(null);
  const player = useRef<PcmAudioPlayer | null>(null);
  const problem = useRef(onProblem);
  problem.current = onProblem;

  const clear = useCallback(() => {
    request.current = null;
    readingKey.current = null;
    setReading(null);
  }, []);

  const stop = useCallback(() => {
    const id = request.current;
    if (id) void mimoPlatform.cancelSpeech(id).catch((reason: unknown) => console.warn("Could not stop reading aloud", reason));
    clear();
    player.current?.stop();
  }, [clear]);

  useEffect(() => {
    let stopListening: (() => void) | null = null;
    let disposed = false;
    mimoPlatform.subscribeAudio((event) => {
      if (event.id !== request.current) return;
      if (event.kind === "chunk") player.current?.pushBase64(event.data);
      else if (event.kind === "done") player.current?.finish();
      else if (event.kind === "error") { clear(); player.current?.stop(); problem.current(event.data); }
    }).then((unlisten) => { if (disposed) unlisten(); else stopListening = unlisten; })
      .catch((reason: unknown) => console.warn("Could not listen for read-aloud audio", reason));
    return () => {
      disposed = true;
      stopListening?.();
      const id = request.current;
      if (id) void mimoPlatform.cancelSpeech(id).catch(() => {});
      request.current = null;
      void player.current?.close();
      player.current = null;
    };
  }, [clear]);

  const toggle = useCallback((key: number, text: string) => {
    if (readingKey.current === key) { stop(); return; }
    stop();
    // Created on the first click, which lets it make sound; it says when the sound starts and when it has all played.
    player.current ??= new PcmAudioPlayer(
      () => setReading((current) => (current ? { ...current, phase: "playing" } : current)),
      () => { if (request.current !== null) clear(); },
    );
    player.current.unlock();
    player.current.reset();
    const id = `read-${crypto.randomUUID()}`;
    request.current = id;
    readingKey.current = key;
    setReading({ key, phase: "preparing" });
    const { voice: name, style } = voice();
    mimoPlatform.startSynthesis(id, spokenText(text), name, style).catch((reason: unknown) => {
      if (request.current !== id) return;
      clear();
      player.current?.stop();
      problem.current(String(reason).replace(/^Error:\s*/, ""));
    });
  }, [clear, stop, voice]);

  return { reading, toggle, stop };
}
