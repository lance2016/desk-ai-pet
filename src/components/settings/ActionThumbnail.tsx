import { useEffect, useRef } from "react";

/** Shows a complete first frame, including tall and wide artwork. */
export function ActionThumbnail({ src, frames, label }: { src: string; frames: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || !ref.current) return;
      const canvas = ref.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      const width = image.naturalWidth / frames;
      const height = image.naturalHeight;
      const scale = Math.min(canvas.width / width, canvas.height / height) * 0.94;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, width, height, (canvas.width - width * scale) / 2, canvas.height - height * scale, width * scale, height * scale);
    };
    image.src = src;
    return () => { cancelled = true; image.onload = null; };
  }, [src, frames]);
  return <canvas ref={ref} width={400} height={400} role="img" aria-label={`${label}动作素材`} />;
}
