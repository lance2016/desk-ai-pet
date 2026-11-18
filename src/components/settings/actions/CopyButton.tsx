import { useEffect, useState, type ReactNode } from "react";

/** How long the button says it copied. */
const COPIED_HINT_MS = 1_600;

interface Props {
  /** What lands on the clipboard. */
  text: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Tells the page what to show: why copying failed, or nothing once it worked. */
  onMessage: (message: string) => void;
}

/** A button that copies a piece of text and says so for a moment. */
export function CopyButton({ text, children, className, title, onMessage }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onMessage("");
    } catch (error) {
      console.error("Could not copy to the clipboard", error);
      onMessage("没能复制到剪贴板，请再试一次。");
    }
  };

  return <button type="button" className={["copy-button", className].filter(Boolean).join(" ")} title={title} onClick={() => void copy()}>{copied ? "已复制" : children}</button>;
}
