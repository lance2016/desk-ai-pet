import type { EventBus } from "../core/EventBus";
import { petWindow } from "../platform/petWindow";
import type { PetEvents } from "../types";
import { recordUse, type UsageFeature } from "./usage";

/** The popovers by window label (`POPOVERS` in `src-tauri/src/lib.rs`). */
const PANELS: Record<string, UsageFeature> = {
  today: "panel_today", notes: "panel_notes", links: "panel_links", coding: "panel_coding", translation: "panel_translation",
};

/** Counts the uses the pet window hears about on its bus, and every panel opened. Returns a function that stops. */
export function watchUsage(bus: EventBus<PetEvents>): () => void {
  const stops = [
    bus.on("pet.petted", () => recordUse("petted")),
    bus.on("pet.greeting", () => recordUse("greeting")),
    petWindow.onPanelShown((label) => {
      const feature = PANELS[label];
      if (feature) recordUse(feature);
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
