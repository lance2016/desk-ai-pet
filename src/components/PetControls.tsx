import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { barLayout, dockControls, loadDock, subscribeDock, type DockCommand, type DockItem } from "../preferences/DockPreferences";
import { linksEnabled, subscribeLinks } from "../links/LinkStore";
import { petWindow } from "../platform/petWindow";
import { InteractIcon } from "./ControlIcon";
import { ControlIconView } from "./ControlIconView";
import { DockButtonFace } from "./DockButtonFace";
import { recordUse } from "../usage/usage";

type DockControlItem = Extract<DockItem, { kind: "control" }>;
const CONTROL_CLICK_GUARD_MS = 500;
/** How much higher the middle button rests than the two at the ends. */
const ARC_RISE_PX = 4;
/** The character's own buttons go into the pet menu too; reminders, notes and focus have menu items already. */
const MENU_COMMANDS: ReadonlySet<DockCommand> = new Set(["feed", "wooden_fish", "sleep_toggle"]);
/** During a focus round only the ways to jot down a stray thought stay on the bar. */
const FOCUS_COMMANDS: ReadonlySet<DockCommand> = new Set(["notes_open", "today_open"]);

interface PetControlsProps {
  runtime: PetRuntime;
  /** The mouse is on the pet: the bar shows fully; otherwise it stays faint. */
  awake: boolean;
  /** Hidden unless `awake`: pushed up onto the pet's legs (the window hangs off the bottom of the screen), or during a focus round. */
  tucked?: boolean;
  /** A focus round is on: only notes and reminders. */
  focusing?: boolean;
  /** On its way out: it fades and takes no clicks. */
  leaving?: boolean;
  /** The bar and its menu, measured for the clickable area. */
  ref?: Ref<HTMLDivElement>;
}

/**
 * The floating controls under the pet: the buttons that fit, and "互动" for the actions and the rest.
 * Only reports what was pressed; the pet decides what to do.
 */
export function PetControls({ runtime, awake, tucked, focusing, leaving, ref }: PetControlsProps) {
  const snapshot = useSyncExternalStore(runtime.state.subscribe, runtime.state.get);
  const showLinks = useSyncExternalStore(subscribeLinks, linksEnabled);
  const packId = runtime.manifest.id;
  const [items, setItems] = useState(() => loadDock(packId, dockControls(runtime.manifest.controls), runtime.manifest.animations));
  const sleeping = snapshot.activity === "sleeping";
  const lastClicks = useRef<Record<string, number>>({});
  const focusPhase = useSyncExternalStore(runtime.focus.subscribe, runtime.focus.get).phase;
  useEffect(() => {
    const reload = () => setItems(loadDock(packId, dockControls(runtime.manifest.controls), runtime.manifest.animations));
    const stopDock = subscribeDock(packId, reload);
    // A renamed or deleted action of the user's changes the dock too.
    const stopActions = runtime.bus.on("pet.actions.changed", reload);
    return () => { stopDock(); stopActions(); };
  }, [runtime, packId]);

  /** Toggle buttons say what pressing them will do now. */
  const labelOf = (control: DockControlItem): string => {
    if (control.command === "sleep_toggle" && sleeping) return "唤醒";
    if (control.command === "focus_toggle" && focusPhase === "focusing") return "停止专注";
    if (control.command === "focus_toggle" && focusPhase === "resting") return "再来一轮";
    return control.label;
  };

  const emitControl = (control: DockControlItem) => {
    const now = Date.now();
    if (now - (lastClicks.current[control.command] ?? -Infinity) < CONTROL_CLICK_GUARD_MS) return;
    lastClicks.current[control.command] = now;
    switch (control.command) {
      case "today_open": void petWindow.openToday().catch((error) => console.error("Failed to open today", error)); break;
      case "notes_open": void petWindow.openNotes().catch((error) => console.error("Failed to open notes", error)); break;
      case "coding_open": void petWindow.openCoding().catch((error) => console.error("Failed to open the coding sessions", error)); break;
      case "links_open": void petWindow.openLinks().catch((error) => console.error("Failed to open links", error)); break;
      case "settings_open": void petWindow.openSettings().catch((error) => console.error("Failed to open settings", error)); break;
      case "focus_toggle": runtime.bus.emit("pet.focus_toggled", {}); break;
      case "feed": recordUse("quick_action"); runtime.bus.emit("pet.fed", {}); break;
      case "wooden_fish": recordUse("quick_action"); runtime.bus.emit("pet.wooden_fish", {}); break;
      case "sleep_toggle": recordUse("quick_action"); runtime.bus.emit(sleeping ? "pet.wake_up" : "pet.sleep", {}); break;
    }
  };
  /** An action button, in the bar's menu or the pet menu. Not the action library's preview, which asks the bus directly. */
  const playAction = (id: string) => {
    recordUse("quick_action");
    runtime.bus.emit("pet.action_requested", { id });
  };

  const enabledItems = items.filter((item) => item.enabled && (showLinks || item.kind !== "control" || item.command !== "links_open"));
  // The same buttons under "动作" in the pet menu, for when the mouse cannot reach the bar.
  const menuItems = enabledItems.flatMap((item): Array<[string, string]> => {
    if (item.kind === "action") {
      const action = runtime.manifest.animations.find((entry) => entry.id === item.id);
      return action && runtime.registry.has(action.id) ? [[`action:${action.id}`, action.label ?? action.id]] : [];
    }
    return MENU_COMMANDS.has(item.command) ? [[`control:${item.id}`, labelOf(item)]] : [];
  });
  const menuKey = JSON.stringify(menuItems);
  useEffect(() => {
    void petWindow.syncDockMenu(menuItems).catch((error: unknown) => console.warn("Could not update the pet menu's actions", error));
  }, [menuKey]); // The key stands for the items: a new array every render must not resend them.
  const pressFromMenu = (key: string) => {
    const item = enabledItems.find((entry) => `${entry.kind}:${entry.id}` === key);
    if (item?.kind === "action") playAction(item.id);
    else if (item) emitControl(item);
  };
  const pressFromMenuRef = useRef(pressFromMenu);
  pressFromMenuRef.current = pressFromMenu;
  useEffect(() => petWindow.onDockMenu((key) => pressFromMenuRef.current(key)), []);
  const shown = enabledItems.filter((item) => (item.kind === "control" ? !focusing || FOCUS_COMMANDS.has(item.command) : !focusing && runtime.registry.has(item.id)));
  const { bar, menu } = barLayout(shown);
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu is a quick pick: it closes once the mouse leaves the pet or the bar goes away.
  useEffect(() => { if (!awake || !shown.length) setMenuOpen(false); }, [awake, shown.length]);
  // A press anywhere but the bar closes it too, like any menu: on the pet, on a bubble.
  useEffect(() => {
    if (!menuOpen) return;
    const onPress = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest(".pet-bar"))) setMenuOpen(false); };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [menuOpen]);
  const pick = (run: () => void) => { setMenuOpen(false); run(); };
  const actionLabel = (id: string) => runtime.manifest.animations.find((entry) => entry.id === id)?.label ?? id;

  /** How high each button rests: the middle highest, the ends level, so five read as an arc rather than a zigzag. */
  const count = bar.length + (menu.length > 0 ? 1 : 0);
  const restOf = (index: number): CSSProperties => {
    const middle = (count - 1) / 2;
    const rise = middle === 0 ? 0 : ARC_RISE_PX * (1 - ((index - middle) / middle) ** 2);
    return { "--rest-y": `${-Math.round(rise * 2) / 2}px` } as CSSProperties;
  };
  const firstBar = menu.length > 0 ? 1 : 0;

  const controlButton = (item: DockControlItem, index: number) => {
    const label = labelOf(item);
    // Nothing is greyed out while the pet sleeps: the character's own buttons wake it up first.
    return (
      <button key={item.id} type="button" className="pet-bar__item pet-tip" style={restOf(firstBar + index)} aria-label={label} data-tip={label} onClick={() => pick(() => emitControl(item))}>
        <ControlIconView icon={item.icon} resolveAsset={runtime.resolveAsset} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="dock-area">
      <div ref={ref} className={`pet-bar${awake ? " is-awake" : ""}${tucked ? " is-tucked" : ""}${leaving ? " is-leaving" : ""}`} role="toolbar" aria-label="宠物快捷按钮">
        {menu.length > 0 && (
          // The menu grows from its own button, not from the middle of the bar.
          <span className="pet-bar__anchor">
            <button type="button" className={`pet-bar__item pet-tip${menuOpen ? " is-active" : ""}`} style={restOf(0)} aria-label="互动" data-tip="互动" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <InteractIcon />
              <span>互动</span>
            </button>
            {menuOpen && (
              <div className="pet-bar__menu" role="menu" aria-label="互动">
                {menu.map((item) => item.kind === "control"
                  ? <button key={`control:${item.id}`} type="button" role="menuitem" onClick={() => pick(() => emitControl(item))}><ControlIconView icon={item.icon} resolveAsset={runtime.resolveAsset} /><span>{labelOf(item)}</span></button>
                  : <button key={`action:${item.id}`} type="button" role="menuitem" onClick={() => pick(() => playAction(item.id))}><span className="pet-bar__face"><DockButtonFace item={item} packId={packId} actions={runtime.manifest.animations} resolveAsset={runtime.resolveAsset} /></span><span>{actionLabel(item.id)}</span></button>)}
              </div>
            )}
          </span>
        )}
        {bar.map(controlButton)}
      </div>
    </div>
  );
}
