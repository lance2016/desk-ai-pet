import { useState, type ReactNode } from "react";
import { dialogPlatform, type Confirmation } from "../platform/dialog";

interface Props {
  children: ReactNode;
  /** The native alert shown before the step runs. */
  confirm: Confirmation;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * The app's one way to confirm a step that cannot be undone: a native alert asks
 * first, as Mac apps do. Only for ordinary windows (settings, chat): an alert
 * activates the app, which the popover panels must not do.
 */
export function ConfirmButton({ children, confirm, onConfirm, className, disabled }: Props) {
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    try {
      if (await dialogPlatform.confirm(confirm)) onConfirm();
    } catch (reason) {
      console.error("Could not ask for confirmation", reason);
    } finally {
      setAsking(false);
    }
  };
  return <button type="button" className={className} disabled={disabled || asking} onClick={() => void ask()}>{children}</button>;
}
