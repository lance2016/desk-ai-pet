import { describe, expect, it } from "vitest";
import { GAP_SECONDS, SAMPLE_RATE, encodeWav, joinPcm, pcmSeconds, toSrt } from "./wav";

const silence = (seconds: number) => new Uint8Array(Math.round(seconds * SAMPLE_RATE) * 2);

describe("joinPcm", () => {
  it("joins streamed chunks and drops a dangling half sample", () => {
    const pcm = joinPcm([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)]);
    expect([...pcm]).toEqual([1, 2, 3, 4]);
  });
});

describe("encodeWav", () => {
  it("writes a 24 kHz 16-bit mono header and pauses between pieces", () => {
    const wav = encodeWav([Uint8Array.of(1, 0, 2, 0), Uint8Array.of(3, 0)]);
    const view = new DataView(wav.buffer);
    const gapBytes = Math.round(GAP_SECONDS * SAMPLE_RATE) * 2;
    const dataBytes = 4 + gapBytes + 2;
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 16))).toBe("WAVEfmt ");
    expect(view.getUint32(4, true)).toBe(36 + dataBytes);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(wav.length).toBe(44 + dataBytes);
    expect([...wav.slice(44, 48)]).toEqual([1, 0, 2, 0]);
    expect([...wav.slice(44 + 4 + gapBytes)]).toEqual([3, 0]);
  });
});

describe("toSrt", () => {
  it("times each piece by its own length plus the pauses before it", () => {
    const srt = toSrt([{ text: "第一句。", pcm: silence(1.5) }, { text: "第二句\n换行", pcm: silence(61) }]);
    const secondStart = 1.5 + GAP_SECONDS;
    const at = (seconds: number) => {
      const ms = Math.round(seconds * 1000);
      const pad = (value: number, size = 2) => String(value).padStart(size, "0");
      return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
    };
    expect(srt).toBe(`1\n00:00:00,000 --> 00:00:01,500\n第一句。\n\n2\n${at(secondStart)} --> ${at(secondStart + 61)}\n第二句 换行\n`);
  });
});

describe("pcmSeconds", () => {
  it("counts two bytes per sample", () => {
    expect(pcmSeconds(silence(2))).toBe(2);
  });
});
