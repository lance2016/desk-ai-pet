import { z } from "zod";
import type { AnimationEntry, PetControl } from "../assets/Manifest";
import type { UserControlIcon } from "../components/ControlIconView";
import { CONTROL_ICON_PRESETS } from "../types";
import { canShortcut } from "./ActionPreferences";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

/**
 * The bar under the pet: one ordered list of buttons. App
 * buttons (today, notes) exist for every character; chat has its own button
 * beside the pet (`ChatLauncher`), so a saved chat button is dropped. The character's own
 * buttons come from its manifest; actions are added from the action library.
 */
const BROADCAST_CHANNEL = "ai-pet:dock";
const dockKey = (packId: string) => characterKey(packId, CHARACTER_DATA.dock);
const MAX_LABEL_CHARS = 12;
const MAX_ENTRIES = 120;
const CUSTOM_ICON_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

export type DockCommand = PetControl["command"] | "today_open" | "notes_open";

/** A button's defaults, before the user's changes. */
export interface DockControl {
  id: string;
  label: string;
  icon: UserControlIcon;
  command: DockCommand;
}

export type DockItem =
  | (DockControl & { kind: "control"; enabled: boolean })
  | { kind: "action"; id: string; enabled: boolean };

/** Buttons every character has. Ids cannot clash with manifest control ids, which are a fixed enum. */
export const APP_CONTROLS: readonly DockControl[] = [
  { id: "today", label: "提醒", icon: "bell", command: "today_open" },
  { id: "notes", label: "备忘", icon: "note", command: "notes_open" },
];

/** Defaults the app buttons had before; saved ones that still match them follow the new defaults. */
const FORMER_DEFAULTS: Record<string, { label: string; icon?: string }> = {
  today: { label: "今日", icon: "checklist" },
  notes: { label: "速记" },
};

export const DOCK_LIMITS = { label: MAX_LABEL_CHARS } as const;

/** Every button the dock may show for a character, app buttons first. */
export function dockControls(manifestControls: readonly PetControl[]): DockControl[] {
  return [...APP_CONTROLS, ...manifestControls];
}

const iconSchema = z.union([
  z.enum(CONTROL_ICON_PRESETS),
  z.object({ file: z.string().min(1).refine((file) => !file.startsWith("/") && !file.includes("\\") && !file.includes(":") && !file.split("/").includes(".."), "must be a relative path inside the asset pack") }),
  z.object({ dataUrl: z.string().max(700_000).regex(CUSTOM_ICON_DATA_URL) }),
]);
const entrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("control"), id: z.string().min(1).max(40), label: z.string().trim().min(1).max(MAX_LABEL_CHARS), icon: iconSchema, enabled: z.boolean() }),
  z.object({ kind: z.literal("action"), id: z.string().min(1).max(100), enabled: z.boolean() }),
]);
const entriesSchema = z.array(entrySchema).max(MAX_ENTRIES);
type Entry = z.infer<typeof entrySchema>;

/** The settings saved before the dock was one list: control overrides with an order, and a list of action ids. */
const legacyControlsSchema = z.array(z.object({ id: z.string().min(1), label: z.string().min(1).max(MAX_LABEL_CHARS), icon: iconSchema, enabled: z.boolean(), order: z.number().int().nonnegative() }));
const legacyActionsSchema = z.array(z.string().min(1).max(100));

function parseStored<T>(schema: z.ZodType<T>, raw: string | null, what: string): T | null {
  if (raw === null) return null;
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn(`Ignoring invalid ${what}`, error);
    return null;
  }
}

function legacyEntries(packId: string, storage: Storage): Entry[] {
  const controls = parseStored(legacyControlsSchema, storage.getItem(characterKey(packId, CHARACTER_DATA.controlPreferences)), "control preferences") ?? [];
  const actions = parseStored(legacyActionsSchema, storage.getItem(characterKey(packId, CHARACTER_DATA.actionShortcuts)), "action shortcuts") ?? [];
  return [
    ...APP_CONTROLS.map((control): Entry => ({ kind: "control", id: control.id, label: control.label, icon: control.icon, enabled: true })),
    ...[...controls].sort((a, b) => a.order - b.order).map(({ id, label, icon, enabled }): Entry => ({ kind: "control", id, label, icon, enabled })),
    ...actions.map((id): Entry => ({ kind: "action", id, enabled: true })),
  ];
}

/** Saved entries applied to what the character has now. Unknown entries are dropped; new buttons are appended. */
function resolve(entries: readonly Entry[], controls: readonly DockControl[], actions: readonly AnimationEntry[]): DockItem[] {
  const seen = new Set<string>();
  const items: DockItem[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    if (entry.kind === "control") {
      const control = controls.find((item) => item.id === entry.id);
      if (!control) continue;
      const former = FORMER_DEFAULTS[entry.id];
      const label = entry.label === former?.label ? control.label : entry.label;
      const icon = typeof entry.icon === "string" && entry.icon === former?.icon ? control.icon : entry.icon;
      items.push({ ...control, kind: "control", label, icon, enabled: entry.enabled });
    } else {
      const action = actions.find((item) => item.id === entry.id);
      if (!action || !canShortcut(action)) continue;
      items.push(entry);
    }
    seen.add(key);
  }
  const added = controls.filter((control) => !seen.has(`control:${control.id}`)).map((control): DockItem => ({ ...control, kind: "control", enabled: true }));
  return [...items, ...added];
}

/** Places on the bar under the pet; it has to fit a narrow window. */
export const BAR_SLOTS = 5;

/**
 * Which of the shown buttons sit on the bar under the pet, in order, and which wait in the "互动" menu:
 * every action, and the buttons past the bar's room. The menu takes a place on the bar while it has anything.
 */
export function barLayout(shown: readonly DockItem[]): { bar: Extract<DockItem, { kind: "control" }>[]; menu: DockItem[] } {
  const controls = shown.filter((item): item is Extract<DockItem, { kind: "control" }> => item.kind === "control");
  const actions = shown.filter((item) => item.kind === "action");
  const room = actions.length === 0 && controls.length <= BAR_SLOTS ? BAR_SLOTS : BAR_SLOTS - 1;
  return { bar: controls.slice(0, room), menu: [...controls.slice(room), ...actions] };
}

export function loadDock(packId: string, controls: readonly DockControl[], actions: readonly AnimationEntry[], storage: Storage = window.localStorage): DockItem[] {
  const saved = parseStored(entriesSchema, storage.getItem(dockKey(packId)), "dock preferences");
  return resolve(saved ?? legacyEntries(packId, storage), controls, actions);
}

/** Saves the list as shown. A blank label falls back to the button's default. */
export function saveDock(packId: string, items: readonly DockItem[], storage: Storage = window.localStorage): void {
  const entries = entriesSchema.parse(items.map((item): Entry => (item.kind === "action"
    ? { kind: "action", id: item.id, enabled: item.enabled }
    : { kind: "control", id: item.id, label: item.label.trim() || (APP_CONTROLS.find((control) => control.id === item.id)?.label ?? item.id), icon: item.icon, enabled: item.enabled })));
  storage.setItem(dockKey(packId), JSON.stringify(entries));
  broadcast();
}

/** Forgets the user's changes, including settings saved by older versions. */
export function resetDock(packId: string, storage: Storage = window.localStorage): void {
  for (const name of [CHARACTER_DATA.dock, CHARACTER_DATA.controlPreferences, CHARACTER_DATA.actionShortcuts]) storage.removeItem(characterKey(packId, name));
  broadcast();
}

/** Shows or hides an action. Showing one that is not in the dock adds it at the end; hiding keeps its place. */
export function setDockAction(items: readonly DockItem[], actionId: string, enabled: boolean): DockItem[] {
  if (items.some((item) => item.kind === "action" && item.id === actionId)) {
    return items.map((item) => (item.kind === "action" && item.id === actionId ? { ...item, enabled } : item));
  }
  return enabled ? [...items, { kind: "action", id: actionId, enabled: true }] : [...items];
}

export function subscribeDock(packId: string, listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === dockKey(packId) || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(BROADCAST_CHANNEL);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}

function broadcast(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(BROADCAST_CHANNEL);
  channel.postMessage("changed");
  channel.close();
}
