/** Frame ranges are one-based and inclusive; missing limits cover the whole action. */
export function isLayerVisible(layer: { startFrame?: number; endFrame?: number }, frameIndex: number, frameCount: number): boolean {
  const frame = frameIndex + 1;
  return frame >= (layer.startFrame ?? 1) && frame <= (layer.endFrame ?? frameCount);
}

/** Timed layers restart with their first visible main frame; legacy layers keep their original clock. */
export function layerElapsedSeconds(layer: { startFrame?: number }, elapsed: number, frames: number, fps: number, loop: boolean): number {
  if (layer.startFrame === undefined) return elapsed;
  const cycle = frames / fps;
  const mainElapsed = loop && cycle > 0 ? elapsed % cycle : elapsed;
  return Math.max(0, mainElapsed - (layer.startFrame - 1) / fps);
}

export function layerMotionProgress(layer: { startFrame?: number; endFrame?: number }, elapsed: number, frames: number, fps: number, fallback: number): number {
  if (layer.startFrame === undefined) return fallback;
  const visibleFrames = Math.max(1, (layer.endFrame ?? frames) - layer.startFrame + 1);
  return Math.min(1, elapsed / (visibleFrames / fps));
}
