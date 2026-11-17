import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { petWindow, type ScreenPoint } from "../platform/petWindow";
import type { HitRegion } from "../types";

/** A press that moves farther than this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Bit of `PointerEvent.buttons` that is set while the primary button is held. */
const PRIMARY_BUTTON_MASK = 1;
/** Holding the pet still this long pats it instead of clicking (which opens the chat bar). */
const LONG_PRESS_MS = 500;

interface Press {
  screenX: number;
  screenY: number;
  region: HitRegion;
  /** Set once holding still has patted the pet; letting go is then not a click. */
  petted: boolean;
}

interface Drag {
  /** Cursor position when the press began. */
  start: ScreenPoint;
  /** Window position when the drag began; null until it has been read. */
  origin: ScreenPoint | null;
  /** Newest window position that still has to be applied. */
  pending: ScreenPoint | null;
  /** Animation frame that will apply `pending`. */
  frame: number | null;
}

function reportMoveError(error: unknown): void {
  console.error("Failed to move the window", error);
}

interface PetStageProps {
  runtime: PetRuntime | null;
  /** The element the renderer mounts its canvas into. */
  hostRef: RefObject<HTMLDivElement | null>;
}

export function PetStage({ runtime, hostRef }: PetStageProps) {
  const press = useRef<Press | null>(null);
  const drag = useRef<Drag | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = () => {
    if (longPress.current !== null) clearTimeout(longPress.current);
    longPress.current = null;
  };
  useEffect(() => cancelLongPress, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !runtime) return;
    const observer = new ResizeObserver(() => runtime.resize(host.clientWidth, host.clientHeight));
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef, runtime]);

  const beginDrag = (from: Press) => {
    if (!runtime) return;
    const started: Drag = { start: { x: from.screenX, y: from.screenY }, origin: null, pending: null, frame: null };
    drag.current = started;
    runtime.bus.emit("pet.drag_started", {});
    petWindow
      .getPosition()
      .then((origin) => {
        // Ignore the answer if this drag has already ended.
        if (drag.current === started) drag.current = { ...started, origin };
      })
      .catch(reportMoveError);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current?.origin) return;
    const pending = {
      x: current.origin.x + event.screenX - current.start.x,
      y: current.origin.y + event.screenY - current.start.y,
    };
    // Move the window at most once per frame, always to the newest position.
    const frame =
      current.frame ??
      requestAnimationFrame(() => {
        const latest = drag.current;
        if (!latest?.pending) return;
        drag.current = { ...latest, frame: null };
        petWindow.setPosition(latest.pending).catch(reportMoveError);
      });
    drag.current = { ...current, pending, frame };
  };

  const endDrag = async () => {
    const finished = drag.current;
    if (!runtime || !finished) return;
    drag.current = null;
    try {
      if (finished.frame !== null) cancelAnimationFrame(finished.frame);
      if (finished.pending) await petWindow.setPosition(finished.pending);
      await petWindow.constrainToMonitor();
      runtime.bus.emit("pet.drag_ended", { dockSide: await petWindow.dockSide() });
    } catch (error) {
      reportMoveError(error);
      runtime.bus.emit("pet.drag_ended", { dockSide: null });
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Control-click is the Mac right click: it opens the menu, not a pat.
    if (!runtime || event.button !== 0 || event.ctrlKey) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const region = runtime.hitTest(event.clientX - bounds.left, event.clientY - bounds.top);
    if (!region) return;
    // Keep receiving moves and the release even when the cursor leaves the window.
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { screenX: event.screenX, screenY: event.screenY, region, petted: false };
    cancelLongPress();
    longPress.current = setTimeout(() => {
      longPress.current = null;
      const held = press.current;
      if (!held) return;
      press.current = { ...held, petted: true };
      runtime.bus.emit("pet.petted", {});
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      // The release was missed: without the button held, the pet must not stick to the cursor.
      if ((event.buttons & PRIMARY_BUTTON_MASK) === 0) { void endDrag(); return; }
      moveDrag(event);
      return;
    }
    const start = press.current;
    if (!start) return;
    // A release can still be missed. A move without the primary button held
    // must not turn that stale press into a drag.
    if ((event.buttons & PRIMARY_BUTTON_MASK) === 0) {
      cancelLongPress();
      press.current = null;
      return;
    }
    if (Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY) < DRAG_THRESHOLD_PX) return;
    // Still a drag after a pat: people often press, pause and then pull.
    cancelLongPress();
    press.current = null;
    beginDrag(start);
  };

  const onPointerUp = () => {
    cancelLongPress();
    if (drag.current) {
      void endDrag();
      return;
    }
    const start = press.current;
    if (!runtime || !start) return;
    press.current = null;
    if (!start.petted) runtime.bus.emit("pet.clicked", { region: start.region });
  };

  /** The press was taken away (for example by the system): finish without a click. */
  const onPointerCancel = () => {
    cancelLongPress();
    press.current = null;
    void endDrag();
  };

  /** The menu itself is opened by the app root; here the press must not turn into a pat. */
  const onContextMenu = () => {
    cancelLongPress();
    press.current = null;
  };

  return (
    <div
      ref={hostRef}
      className="stage"
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
