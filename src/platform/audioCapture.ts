export type AudioCapture = { stop: () => Promise<{ base64: string; seconds: number }> };

/**
 * Records from the microphone until stopped, or until `maxSeconds` have been recorded, when `onLimit` is called.
 * `cleanUp` turns on the system's echo cancelling, noise suppression and gain control: good for speech
 * recognition, but they strip breath and overtones, so voice samples for cloning are recorded without them.
 */
export async function startAudioCapture(onLimit: () => void, maxSeconds = 120, cleanUp = true): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前系统暂不支持录音。");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: cleanUp, noiseSuppression: cleanUp, autoGainControl: cleanUp } });
  let context: AudioContext;
  try { context = new AudioContext({ sampleRate: 24_000 }); }
  catch { stream.getTracks().forEach((track) => track.stop()); throw new Error("无法初始化录音设备。"); }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let sampleCount = 0;
  const maxSamples = context.sampleRate * maxSeconds;
  let ended = false;
  processor.onaudioprocess = (event) => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (ended) return;
    const input = event.inputBuffer.getChannelData(0);
    const remaining = maxSamples - sampleCount;
    const count = Math.min(input.length, remaining);
    if (count > 0) { chunks.push(input.slice(0, count)); sampleCount += count; }
    if (sampleCount >= maxSamples) { ended = true; onLimit(); }
  };
  source.connect(processor);
  processor.connect(context.destination);
  const stop = async () => {
    ended = true;
    processor.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
    const bytes = new Uint8Array(44 + sampleCount * 2);
    const view = new DataView(bytes.buffer);
    const put = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
    put(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); put(8, "WAVE"); put(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, context.sampleRate, true);
    view.setUint32(28, context.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    put(36, "data"); view.setUint32(40, sampleCount * 2, true);
    let outputOffset = 44;
    for (const chunk of chunks) {
      for (let index = 0; index < chunk.length; index++) {
        const sample = Math.max(-1, Math.min(1, chunk[index]));
        view.setInt16(outputOffset, sample < 0 ? sample * 32768 : sample * 32767, true);
        outputOffset += 2;
      }
    }
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { base64: btoa(binary), seconds: sampleCount / context.sampleRate };
  };
  return { stop };
}
