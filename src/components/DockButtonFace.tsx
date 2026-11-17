import { useEffect, useState } from "react";
import { loadAppearance } from "../appearance/AppearanceStore";
import type { AnimationEntry } from "../assets/Manifest";
import type { DockItem } from "../preferences/DockPreferences";
import { ActionThumbnail } from "./settings/ActionThumbnail";
import { ControlIconView } from "./ControlIconView";
import "./DockButtonFace.css";

/** The built-in buttons with their drawn illustration (`public/control-icons.png`) while they keep their default icon. */
function hasIllustration(item: Extract<DockItem, { kind: "control" }>): boolean {
  const icon = item.icon;
  if (typeof icon !== "string") return false;
  return (item.command === "chat_open" && icon === "chat")
    || (item.command === "today_open" && (icon === "checklist" || icon === "bell"))
    || (item.command === "notes_open" && icon === "note")
    || (item.command === "focus_toggle" && icon === "timer");
}

/** An action's own picture: the one the user put in its place, else the pack's. */
function ActionFace({ packId, action, resolveAsset }: { packId: string; action: AnimationEntry; resolveAsset: (file: string) => string }) {
  const [custom, setCustom] = useState<{ image: string; frames: number } | null>(null);
  useEffect(() => {
    let active = true;
    if (typeof indexedDB === "undefined") return;
    loadAppearance(packId, action.id)
      .then((appearance) => { if (active) setCustom(appearance ? { image: appearance.image, frames: appearance.frames } : null); })
      .catch((error: unknown) => console.warn(`Could not load the picture of ${action.id}`, error));
    return () => { active = false; };
  }, [packId, action.id]);
  return (
    <span className="control-action-face">
      <ActionThumbnail src={custom?.image ?? resolveAsset(action.file)} frames={custom?.frames ?? action.frames ?? 1} label={action.label ?? action.id} />
    </span>
  );
}

interface Props {
  item: DockItem;
  packId: string;
  actions: readonly AnimationEntry[];
  resolveAsset: (file: string) => string;
}

/**
 * What a dock button shows. The pet and the settings preview both use this,
 * so the preview always matches what is on the desktop.
 */
export function DockButtonFace({ item, packId, actions, resolveAsset }: Props) {
  if (item.kind === "action") {
    const action = actions.find((entry) => entry.id === item.id);
    return action ? <ActionFace packId={packId} action={action} resolveAsset={resolveAsset} /> : null;
  }
  if (hasIllustration(item)) return <span className={`control-illustration control-illustration--${item.command}`} aria-hidden="true" />;
  return <ControlIconView icon={item.icon} resolveAsset={resolveAsset} />;
}
