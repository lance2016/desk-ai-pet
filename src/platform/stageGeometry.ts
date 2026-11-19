import type { DockSide } from "../types";

/**
 * Transparent room around the pet inside its window, in CSS pixels: the sides
 * keep the chat button and wide bubbles inside, the top holds a speech bubble,
 * the bottom the bar of quick buttons or the quick chat bar.
 * Multiples of the hit-mask cell, so the drawn mask lines up with its cells.
 */
export const STAGE_MARGIN = { side: 72, top: 76, bottom: 76 } as const;

/** Horizontal extent of a monitor, in logical screen pixels. */
export interface MonitorSpan {
  left: number;
  right: number;
}

/** A monitor's bounds, in logical screen pixels. */
export interface MonitorBounds extends MonitorSpan {
  top: number;
  bottom: number;
}

/** The window's frame, in logical screen pixels. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far the window sticks out of sight on each side: past the monitor on
 * the left and right, and past its usable area (menu bar, Dock) at the top and bottom.
 */
export interface OffscreenInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Vertical extent of a monitor, or of its usable area, in logical screen pixels. */
export interface MonitorRange {
  top: number;
  bottom: number;
}

export function stageSize(petWidth: number, petHeight: number): { width: number; height: number } {
  return {
    width: petWidth + STAGE_MARGIN.side * 2,
    height: STAGE_MARGIN.top + petHeight + STAGE_MARGIN.bottom,
  };
}

/**
 * The monitor under the middle of the pet, or the nearest one when it is
 * between monitors. macOS updates the window's own monitor a moment after a
 * move, so right after a drag it can still name the one the pet came from.
 */
export function monitorUnderPet<Monitor extends MonitorBounds>(frame: WindowBounds, monitors: readonly Monitor[]): Monitor | null {
  const x = frame.x + frame.width / 2;
  const y = frame.y + STAGE_MARGIN.top + (frame.height - STAGE_MARGIN.top - STAGE_MARGIN.bottom) / 2;
  const distance = (monitor: MonitorBounds) => Math.hypot(
    Math.max(monitor.left - x, 0, x - monitor.right),
    Math.max(monitor.top - y, 0, y - monitor.bottom),
  );
  return monitors.reduce<Monitor | null>((best, monitor) => (best === null || distance(monitor) < distance(best) ? monitor : best), null);
}

/** Window x that keeps the pet itself on the monitor. The empty margins may hang off screen. */
export function clampWindowX(x: number, windowWidth: number, monitor: MonitorSpan): number {
  const lowest = monitor.left - STAGE_MARGIN.side;
  const highest = monitor.right - windowWidth + STAGE_MARGIN.side;
  return Math.min(Math.max(lowest, highest), Math.max(lowest, x));
}

/** Window y that keeps the pet itself on the monitor. The bubble room above and the bar room below may hang off. */
export function clampWindowY(y: number, windowHeight: number, monitor: MonitorRange): number {
  const lowest = monitor.top - STAGE_MARGIN.top;
  const highest = monitor.bottom - windowHeight + STAGE_MARGIN.bottom;
  return Math.min(Math.max(lowest, highest), Math.max(lowest, y));
}

/** Whether another monitor sits right against `monitor` on `side`, so that edge is a seam, not a screen edge. */
function hasNeighbor(monitor: MonitorBounds, side: DockSide, others: readonly MonitorBounds[]): boolean {
  return others.some((other) => other !== monitor
    && (side === "left" ? Math.abs(other.right - monitor.left) < 1 : Math.abs(other.left - monitor.right) < 1)
    && other.top < monitor.bottom && other.bottom > monitor.top);
}

/**
 * The screen edge the pet has been pushed against or past, if any. An edge
 * where another monitor continues is not one: the pet is on its way across.
 */
export function dockSideAt(x: number, windowWidth: number, monitor: MonitorSpan | MonitorBounds, others: readonly MonitorBounds[] = []): DockSide | null {
  const bounded = "top" in monitor ? monitor : null;
  if (x + STAGE_MARGIN.side <= monitor.left) return bounded && hasNeighbor(bounded, "left", others) ? null : "left";
  if (x + windowWidth - STAGE_MARGIN.side >= monitor.right) return bounded && hasNeighbor(bounded, "right", others) ? null : "right";
  return null;
}

/** Window x that puts the pet flush against a screen edge. */
export function snappedWindowX(side: DockSide, windowWidth: number, monitor: MonitorSpan): number {
  return side === "left" ? monitor.left - STAGE_MARGIN.side : monitor.right - windowWidth + STAGE_MARGIN.side;
}

export function offscreenInsets(x: number, windowWidth: number, monitor: MonitorSpan): Pick<OffscreenInsets, "left" | "right"> {
  return {
    left: Math.max(0, monitor.left - x),
    right: Math.max(0, x + windowWidth - monitor.right),
  };
}

/** How far the window reaches under the menu bar or the Dock, or off the screen. */
export function verticalInsets(y: number, windowHeight: number, usable: MonitorRange): Pick<OffscreenInsets, "top" | "bottom"> {
  return {
    top: Math.max(0, usable.top - y),
    bottom: Math.max(0, y + windowHeight - usable.bottom),
  };
}
