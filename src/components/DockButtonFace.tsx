import { useEffect, useState } from "react";
import { loadAppearance } from "../appearance/AppearanceStore";
import type { AnimationEntry } from "../assets/Manifest";
import { isCustomCharacter } from "../assets/PackCatalog";
import { ControlIcon } from "./ControlIcon";
import type { DockItem } from "../preferences/DockPreferences";
import { ActionThumbnail } from "./settings/actions/ActionThumbnail";
import { ControlIconView } from "./ControlIconView";
import "./DockButtonFace.css";

/** An action's own picture: the one the user put in its place, else the pack's. A custom character never shows a borrowed one. */
function ActionFace({ packId, action, resolveAsset }: { packId: string; action: AnimationEntry; resolveAsset: (file: string) => string }) {
  /** Undefined while reading, so a borrowed picture never flashes first. */
  const [custom, setCustom] = useState<{ image: string; frames: number } | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    if (typeof indexedDB === "undefined") { setCustom(null); return; }
    loadAppearance(packId, action.id)
      .then((appearance) => { if (active) setCustom(appearance ? { image: appearance.image, frames: appearance.frames } : null); })
      .catch((error: unknown) => { console.warn(`Could not load the picture of ${action.id}`, error); if (active) setCustom(null); });
    return () => { active = false; };
  }, [packId, action.id]);
  if (custom === undefined) return <span className="control-action-face" />;
  if (custom === null && isCustomCharacter(packId)) return <ControlIcon name="sparkle" />;
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
  return <ControlIconView icon={item.icon} resolveAsset={resolveAsset} />;
}
