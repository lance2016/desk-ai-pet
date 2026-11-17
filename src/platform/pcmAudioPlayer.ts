const SAMPLE_RATE = 24_000;
const START_BUFFER_SAMPLES = 2_880;

/** Schedules streamed MiMo PCM chunks against one playback clock to avoid per-chunk gaps. */
export class PcmAudioPlayer {
  private readonly context: AudioContext;
  private readonly pending: Float32Array<ArrayBuffer>[] = [];
  private readonly sources = new Set<AudioBufferSourceNode>();
  private pendingSamples = 0;
  private nextStart = 0;
  private started = false;
  private receiving = true;
  private carry: number | null = null;

  constructor(private readonly onStart: () => void, private readonly onIdle: () => void) {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
  }

  unlock(): void { void this.context.resume(); }

  pushBase64(encoded: string): void {
    const raw = atob(encoded);
    const byteLength = raw.length + (this.carry === null ? 0 : 1);
    const sampleCount = Math.floor(byteLength / 2);
    if (!sampleCount) { if (raw.length) this.carry = raw.charCodeAt(0); return; }
    const pcm = new DataView(new ArrayBuffer(sampleCount * 2));
    let sourceIndex = 0;
    let targetIndex = 0;
    if (this.carry !== null) { pcm.setUint8(0, this.carry); pcm.setUint8(1, raw.charCodeAt(0)); this.carry = null; sourceIndex = 1; targetIndex = 2; }
    const remaining = raw.length - sourceIndex;
    const evenBytes = remaining - (remaining % 2);
    for (let index = 0; index < evenBytes; index++) { pcm.setUint8(targetIndex + index, raw.charCodeAt(sourceIndex + index)); }
    if (evenBytes !== remaining) this.carry = raw.charCodeAt(raw.length - 1);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) samples[index] = pcm.getInt16(index * 2, true) / 32768;
    if (!this.started) {
      this.pending.push(samples);
      this.pendingSamples += samples.length;
      if (this.pendingSamples >= START_BUFFER_SAMPLES) this.flushPending();
    } else this.schedule(samples);
  }

  finish(): void {
    this.receiving = false;
    if (this.pendingSamples) this.flushPending();
    this.notifyIdle();
  }

  reset(): void {
    this.stop();
    this.receiving = true;
    this.started = false;
    this.nextStart = this.context.currentTime;
  }

  stop(): void {
    this.receiving = false;
    this.pending.length = 0;
    this.pendingSamples = 0;
    this.carry = null;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.nextStart = this.context.currentTime;
    this.notifyIdle();
  }

  async close(): Promise<void> { this.stop(); await this.context.close().catch(() => {}); }

  private flushPending(): void {
    if (!this.pendingSamples) return;
    this.started = true;
    this.onStart();
    for (const samples of this.pending.splice(0)) this.schedule(samples);
    this.pendingSamples = 0;
  }

  private schedule(samples: Float32Array<ArrayBuffer>): void {
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    const start = Math.max(this.context.currentTime + 0.02, this.nextStart);
    this.nextStart = start + buffer.duration;
    source.onended = () => { this.sources.delete(source); source.disconnect(); this.notifyIdle(); };
    source.start(start);
  }

  private notifyIdle(): void { if (!this.receiving && !this.pendingSamples && this.sources.size === 0) this.onIdle(); }
}
