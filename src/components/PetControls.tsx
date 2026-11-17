import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { dockControls, loadDock, subscribeDock, type DockItem } from "../preferences/DockPreferences";
import { STAGE_MARGIN, type OffscreenInsets } from "../platform/stageGeometry";
import { petWindow } from "../platform/petWindow";
import { DockButtonFace } from "./DockButtonFace";

type DockControlItem = Extract<DockItem, { kind: "control" }>;
const DOCK_BUTTON_SIZE_PX = 36;
const MIN_DOCK_BUTTON_SIZE_PX = 30;
const DOCK_ICON_SIZE_RATIO = 0.5;
const CONTROL_CLICK_GUARD_MS = 500;

interface PetControlsProps {
  runtime: PetRuntime;
  visible: boolean;
  offscreenInsets: OffscreenInsets;
  /** The floating controls, measured button by button for the clickable area. */
  ref?: Ref<HTMLDivElement>;
}

export function PetControls({ runtime, visible, offscreenInsets, ref }: PetControlsProps) {
  const snapshot = useSyncExternalStore(runtime.state.subscribe, runtime.state.get);
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
      case "chat_open": runtime.bus.emit("pet.chat_requested", {}); break;
      case "today_open": void petWindow.openToday().catch((error) => console.error("Failed to open today", error)); break;
      case "notes_open": void petWindow.openNotes().catch((error) => console.error("Failed to open notes", error)); break;
      case "focus_toggle": runtime.bus.emit("pet.focus_toggled", {}); break;
      case "feed": runtime.bus.emit("pet.fed", {}); break;
      case "wooden_fish": runtime.bus.emit("pet.wooden_fish", {}); break;
      case "sleep_toggle": runtime.bus.emit(sleeping ? "pet.wake_up" : "pet.sleep", {}); break;
    }
  };

  const enabledItems = items.filter((item) => item.enabled);
  const leftGutter = Math.max(0, STAGE_MARGIN.side - offscreenInsets.left);
  const rightGutter = Math.max(0, STAGE_MARGIN.side - offscreenInsets.right);
  const canUseBothRails = leftGutter >= MIN_DOCK_BUTTON_SIZE_PX && rightGutter >= MIN_DOCK_BUTTON_SIZE_PX;
  const singleRail = leftGutter >= rightGutter ? "left" : "right";
  const buttonSize = canUseBothRails
    ? Math.min(DOCK_BUTTON_SIZE_PX, leftGutter, rightGutter)
    : Math.min(DOCK_BUTTON_SIZE_PX, singleRail === "left" ? leftGutter : rightGutter);
  const leftItems = canUseBothRails
    ? enabledItems.filter((_, index) => index % 2 === 0)
    : singleRail === "left" ? enabledItems : [];
  const rightItems = canUseBothRails
    ? enabledItems.filter((_, index) => index % 2 === 1)
    : singleRail === "right" ? enabledItems : [];
  const controlStyle = {
    "--dock-button-size": `${buttonSize}px`,
    "--dock-icon-size": `${Math.max(12, Math.round(buttonSize * DOCK_ICON_SIZE_RATIO))}px`,
  } as CSSProperties;

  const renderItem = (item: DockItem, index: number, all: DockItem[], side: "left" | "right") => {
    const position = all.length <= 1 ? 0 : index / (all.length - 1);
    const gutter = side === "left" ? leftGutter : rightGutter;
    const inset = Math.round(position * Math.min(18, Math.max(0, gutter - buttonSize)));
    const style = { alignSelf: side === "left" ? "flex-end" : "flex-start", marginInline: `${inset}px` } as CSSProperties;
    if (item.kind === "action") {
      const action = runtime.manifest.animations.find((entry) => entry.id === item.id);
      if (!action || !runtime.registry.has(action.id)) return null;
      const label = action.label ?? action.id;
      return (
        <button key={`action:${action.id}`} className="controls__action controls__action--picture" style={style} type="button" aria-label={label} title={label} onClick={() => runtime.bus.emit("pet.action_requested", { id: action.id })}>
          <DockButtonFace item={item} packId={packId} actions={runtime.manifest.animations} resolveAsset={runtime.resolveAsset} />
        </button>
      );
    }

    const label = labelOf(item);
    // Nothing is greyed out while the pet sleeps: the character's own buttons wake it up first.
    const active = item.command === "focus_toggle" && focusPhase === "focusing";
    return (
      <button
        key={item.id}
        style={style}
        className={`controls__action${item.command === "chat_open" ? " controls__action--primary" : ""}${active ? " is-active" : ""}`}
        type="button"
        aria-pressed={item.command === "focus_toggle" ? active : undefined}
        aria-label={label}
        title={item.command === "chat_open" ? `${label}（点一下宠物也可以）` : label}
        onClick={() => emitControl(item)}
      >
        <DockButtonFace item={item} packId={packId} actions={runtime.manifest.animations} resolveAsset={runtime.resolveAsset} />
      </button>
    );
  };

  return (
    <div className="floating-controls-area">
      <div
        ref={ref}
        className={`controls${visible ? " is-visible" : ""}${canUseBothRails ? "" : ` controls--single-${singleRail}`}`}
        style={controlStyle}
        aria-hidden={!visible}
        role="group"
        aria-label="宠物快捷按钮"
      >
        <div className="controls__rail controls__rail--left">
          <div className="controls__actions">{leftItems.map((item, index) => renderItem(item, index, leftItems, "left"))}</div>
        </div>
        <div className="controls__rail controls__rail--right">
          <div className="controls__actions">{rightItems.map((item, index) => renderItem(item, index, rightItems, "right"))}</div>
        </div>
      </div>
    </div>
  );
}
