import { GAP_SECONDS, SAMPLE_RATE } from "./wav";

/** A little ahead of now, so the first piece is not clipped. */
const START_DELAY_SECONDS = 0.05;

/** Plays finished pieces one after another, with the same pause the export puts between them. */
export class DubPlayer {
  private context: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  /** `onPiece` is told which piece is sounding; `onEnd` when the last one has finished. */
  play(pieces: readonly Uint8Array[], onPiece: (index: number) => void, onEnd: () => void): void {
    this.stop();
    if (pieces.length === 0) { onEnd(); return; }
    // Made on the first click, which lets it make sound.
    const context = (this.context ??= new AudioContext({ sampleRate: SAMPLE_RATE }));
    void context.resume();
    let at = context.currentTime + START_DELAY_SECONDS;
    pieces.forEach((pcm, index) => {
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.length);
      const samples = new Float32Array(pcm.length / 2);
      for (let sample = 0; sample < samples.length; sample++) samples[sample] = view.getInt16(sample * 2, true) / 32768;
      const buffer = context.createBuffer(1, Math.max(1, samples.length), SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(at);
      this.sources.push(source);
      this.timers.push(setTimeout(() => onPiece(index), (at - context.currentTime) * 1000));
      at += buffer.duration + GAP_SECONDS;
    });
    const last = this.sources[this.sources.length - 1];
    last.onended = () => { this.stop(); onEnd(); };
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* not started or already ended */ }
      source.disconnect();
    }
    this.sources = [];
  }

  async close(): Promise<void> {
    this.stop();
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}
