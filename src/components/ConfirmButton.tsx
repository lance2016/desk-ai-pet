import { useEffect, useState, type ReactNode } from "react";

/** How long the button waits for the second click before it goes back. */
const CONFIRM_MS = 4_000;

interface Props {
  children: ReactNode;
  /** What the button says while waiting for the second click, e.g. "再点一次删除". */
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * The app's one way to confirm a step that cannot be undone: the first click
 * asks, a second click within a few seconds does it. `window.confirm` cannot be
 * used, because the dialog plugin turns it into an async function.
 */
export function ConfirmButton({ children, confirmLabel, onConfirm, className, disabled }: Props) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [asking]);
  useEffect(() => { if (disabled) setAsking(false); }, [disabled]);
  const classes = [className, asking ? "is-confirming" : ""].filter(Boolean).join(" ");
  return <button
    type="button"
    className={classes || undefined}
    disabled={disabled}
    onBlur={() => setAsking(false)}
    onClick={() => {
      if (!asking) { setAsking(true); return; }
      setAsking(false);
      onConfirm();
    }}
  >{asking ? confirmLabel : children}</button>;
}
