import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { petWindow, type ScreenPoint } from "../platform/petWindow";
import type { HitRegion } from "../types";

/** A press that moves farther than this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Bit of `PointerEvent.buttons` that is set while the primary button is held. */
const PRIMARY_BUTTON_MASK = 1;
/**
 * Let go after holding the pet still this long, and it was a pat, not a click. Settled on release, so a
 * press that pauses and then pulls is only a drag.
 */
const LONG_PRESS_MS = 500;

interface Press {
  screenX: number;
  screenY: number;
  region: HitRegion;
  /** When the button went down (`Date.now()`). */
  at: number;
}

/** Where the cursor and the window were when the drag began, both read from the native side. */
interface Anchor {
  cursor: ScreenPoint;
  window: ScreenPoint;
}

interface Drag {
  /** Null until both positions have been read. */
  anchor: Anchor | null;
  /** Animation frame that will move the window next. */
  frame: number | null;
  /** The move being applied, so the last one can wait for it. */
  moving: Promise<void> | null;
  /** The cursor moved again while `moving` was under way: follow it once more when it is done. */
  behind: boolean;
}

function reportMoveError(error: unknown): void {
  console.error("Failed to move the window", error);
}

/** Puts the window where the cursor has carried it since the drag began. */
async function followCursor(anchor: Anchor): Promise<void> {
  const cursor = await petWindow.getCursor();
  if (!cursor) return;
  await petWindow.setPosition({ x: anchor.window.x + cursor.x - anchor.cursor.x, y: anchor.window.y + cursor.y - anchor.cursor.y });
}

interface PetStageProps {
  runtime: PetRuntime | null;
  /** The element the renderer mounts its canvas into. */
  hostRef: RefObject<HTMLDivElement | null>;
}

export function PetStage({ runtime, hostRef }: PetStageProps) {
  const press = useRef<Press | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !runtime) return;
    const observer = new ResizeObserver(() => runtime.resize(host.clientWidth, host.clientHeight));
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef, runtime]);

  const beginDrag = () => {
    if (!runtime) return;
    const started: Drag = { anchor: null, frame: null, moving: null, behind: false };
    drag.current = started;
    runtime.bus.emit("pet.drag_started", {});
    // Read together, so the pet keeps the spot under the cursor where it was picked up.
    Promise.all([petWindow.getCursor(), petWindow.getPosition()])
      .then(([cursor, window]) => {
        // Ignore the answer if this drag has already ended.
        if (drag.current === started && cursor && window) drag.current = { ...started, anchor: { cursor, window } };
      })
      .catch(reportMoveError);
  };

  /** Moves the window at most once per frame and one move at a time, always to where the cursor is now. */
  const moveDrag = () => {
    const current = drag.current;
    if (!current?.anchor || current.frame !== null) return;
    if (current.moving) {
      drag.current = { ...current, behind: true };
      return;
    }
    const { anchor } = current;
    const frame = requestAnimationFrame(() => {
      const moving = followCursor(anchor)
        .catch(reportMoveError)
        .finally(() => {
          const latest = drag.current;
          if (latest?.moving !== moving) return;
          drag.current = { ...latest, moving: null, behind: false };
          if (latest.behind) moveDrag();
        });
      if (drag.current?.frame === frame) drag.current = { ...drag.current, frame: null, moving };
    });
    drag.current = { ...current, frame };
  };

  const endDrag = async () => {
    const finished = drag.current;
    if (!runtime || !finished) return;
    drag.current = null;
    try {
      if (finished.frame !== null) cancelAnimationFrame(finished.frame);
      await finished.moving;
      if (finished.anchor) await followCursor(finished.anchor);
      await petWindow.constrainToMonitor();
      runtime.bus.emit("pet.drag_ended", { dockSide: await petWindow.dockSide() });
      void petWindow.bringPanelsAlong().catch((error: unknown) => console.warn("Could not bring the panels along", error));
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
    press.current = { screenX: event.screenX, screenY: event.screenY, region, at: Date.now() };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      // The release was missed: without the button held, the pet must not stick to the cursor.
      if ((event.buttons & PRIMARY_BUTTON_MASK) === 0) { void endDrag(); return; }
      moveDrag();
      return;
    }
    const start = press.current;
    if (!start) return;
    // A release can still be missed. A move without the primary button held
    // must not turn that stale press into a drag.
    if ((event.buttons & PRIMARY_BUTTON_MASK) === 0) {
      press.current = null;
      return;
    }
    if (Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY) < DRAG_THRESHOLD_PX) return;
    press.current = null;
    beginDrag();
  };

  const onPointerUp = () => {
    if (drag.current) {
      void endDrag();
      return;
    }
    const start = press.current;
    if (!runtime || !start) return;
    press.current = null;
    if (Date.now() - start.at >= LONG_PRESS_MS) runtime.bus.emit("pet.petted", {});
    else runtime.bus.emit("pet.clicked", { region: start.region });
  };

  /** The press was taken away (for example by the system): finish without a click. */
  const onPointerCancel = () => {
    press.current = null;
    void endDrag();
  };

  /** The menu itself is opened by the app root; here the press must not turn into a pat. */
  const onContextMenu = () => {
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
