import type { Confirmation } from "../../platform/dialog";
import { ConfirmButton } from "../ConfirmButton";
import { Icon } from "../../ui/icons";

interface Props {
  destination: string;
  onBack: () => void;
  disabled?: boolean;
  confirm?: Confirmation;
}

export function SettingsBackButton({ destination, onBack, disabled, confirm }: Props) {
  const content = <>
    <Icon name="chevron_left" />
    返回{destination}
  </>;
  return confirm
    ? <ConfirmButton className="settings-back" disabled={disabled} confirm={confirm} onConfirm={onBack}>{content}</ConfirmButton>
    : <button type="button" className="settings-back" disabled={disabled} onClick={onBack}>{content}</button>;
}
