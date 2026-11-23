import type { Confirmation } from "../../platform/dialog";
import { ConfirmButton } from "../ConfirmButton";

interface Props {
  destination: string;
  onBack: () => void;
  disabled?: boolean;
  confirm?: Confirmation;
}

export function SettingsBackButton({ destination, onBack, disabled, confirm }: Props) {
  const content = <>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10 3.5-4.5 4.5 4.5 4.5" />
    </svg>
    返回{destination}
  </>;
  return confirm
    ? <ConfirmButton className="settings-back" disabled={disabled} confirm={confirm} onConfirm={onBack}>{content}</ConfirmButton>
    : <button type="button" className="settings-back" disabled={disabled} onClick={onBack}>{content}</button>;
}
