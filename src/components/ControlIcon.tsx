import type { ControlIconPreset } from "../types";
import { Icon } from "../ui/icons";

/** The icon of a quick button, by its preset name. */
export function ControlIcon({ name }: { name: ControlIconPreset }) {
  return <Icon name={name} className="control-icon" />;
}

/** "互动" on the bar under the pet: the menu of actions. Not a preset, so it cannot be picked for another button. */
export function InteractIcon() {
  return <Icon name="face" className="control-icon" />;
}
