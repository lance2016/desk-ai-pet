/** What both voice services stream: 24 kHz, 16-bit little-endian, mono. Same as `PcmAudioPlayer`. */
export const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const HEADER_BYTES = 44;
/** The pause put between pieces when they are played or exported together. */
export const GAP_SECONDS = 0.4;
/** The longest export; `MAX_AUDIO_BYTES` in `src-tauri/src/dubbing.rs` refuses anything longer. */
export const MAX_EXPORT_SECONDS = 30 * 60;

export interface SpokenPiece { text: string; pcm: Uint8Array }

export function decodeBase64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** One piece's audio from its streamed chunks. A chunk may end mid-sample; a last odd byte is dropped. */
export function joinPcm(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total - (total % BYTES_PER_SAMPLE));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.length, joined.length - offset));
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export const pcmSeconds = (pcm: Uint8Array) => pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE;

const gapBytes = () => Math.round(GAP_SECONDS * SAMPLE_RATE) * BYTES_PER_SAMPLE;

/** The pieces played one after another with `GAP_SECONDS` between them, in seconds. */
export function totalSeconds(pieces: readonly Uint8Array[]): number {
  if (pieces.length === 0) return 0;
  return pieces.reduce((sum, pcm) => sum + pcmSeconds(pcm), 0) + (pieces.length - 1) * GAP_SECONDS;
}

/** One WAV of all the pieces, with a short silence between them. */
export function encodeWav(pieces: readonly Uint8Array[]): Uint8Array {
  const gap = gapBytes();
  const dataBytes = pieces.reduce((sum, pcm) => sum + pcm.length, 0) + Math.max(0, pieces.length - 1) * gap;
  const wav = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  pieces.forEach((pcm, index) => {
    wav.set(pcm, offset);
    offset += pcm.length + (index < pieces.length - 1 ? gap : 0);
  });
  return wav;
}

function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** SubRip subtitles for the exported audio: one cue per piece, timed by the piece's own length. */
export function toSrt(pieces: readonly SpokenPiece[]): string {
  let start = 0;
  return pieces.map(({ text, pcm }, index) => {
    const end = start + pcmSeconds(pcm);
    const cue = `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${text.replace(/\s*\n\s*/g, " ")}\n`;
    start = end + GAP_SECONDS;
    return cue;
  }).join("\n");
}
