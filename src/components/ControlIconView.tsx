import type { ControlIconPreset } from "../types";
import { ControlIcon } from "./ControlIcon";

export type UserControlIcon = ControlIconPreset | { file: string } | { dataUrl: string };

interface ControlIconViewProps {
  icon: UserControlIcon;
  resolveAsset?: (file: string) => string;
}

export function ControlIconView({ icon, resolveAsset }: ControlIconViewProps) {
  if (typeof icon === "string") return <ControlIcon name={icon} />;
  const src = "dataUrl" in icon ? icon.dataUrl : resolveAsset?.(icon.file) ?? "";
  return <img className="control-icon" src={src} alt="" />;
}
