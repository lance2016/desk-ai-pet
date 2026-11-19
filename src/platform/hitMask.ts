import type { OpaqueMask } from "../renderer/PetRenderer";
import { petWindow } from "./petWindow";

/** Side of one hit-mask cell in CSS pixels. */
export const HIT_CELL_PX = 4;

/** A rectangle in CSS pixels, relative to the window. */
export interface MaskRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface HitMaskInput {
  /** Side of one cell in CSS pixels. */
  cell: number;
  columns: number;
  rows: number;
  /** Where the pet is drawn. */
  drawn: OpaqueMask | null;
  /** Cells between the window's top-left corner and the drawn mask's. */
  offset?: { columns: number; rows: number };
  /** Cells to grow the drawn area by, so small motions stay clickable. */
  grow: number;
  /** Extra areas that take mouse input, such as the controls. */
  rects: MaskRect[];
}

/** Builds the window's hit mask: the drawn pet, grown a little, plus the given rectangles. */
export function composeHitMask({ cell, columns, rows, drawn, offset = { columns: 0, rows: 0 }, grow, rects }: HitMaskInput): boolean[] {
  const cells = Array.from({ length: columns * rows }, () => false);
  const mark = (column: number, row: number) => {
    if (column >= 0 && column < columns && row >= 0 && row < rows) cells[row * columns + column] = true;
  };

  if (drawn) {
    drawn.cells.forEach((opaque, index) => {
      if (!opaque) return;
      const column = offset.columns + (index % drawn.columns);
      const row = offset.rows + Math.floor(index / drawn.columns);
      for (let dy = -grow; dy <= grow; dy += 1) {
        for (let dx = -grow; dx <= grow; dx += 1) mark(column + dx, row + dy);
      }
    });
  }

  for (const rect of rects) {
    const lastColumn = Math.ceil(rect.right / cell) - 1;
    const lastRow = Math.ceil(rect.bottom / cell) - 1;
    for (let row = Math.floor(rect.top / cell); row <= lastRow; row += 1) {
      for (let column = Math.floor(rect.left / cell); column <= lastColumn; column += 1) mark(column, row);
    }
  }
  return cells;
}

/**
 * Makes only `element` take the mouse, for when the pet itself could not be
 * drawn (a load error, a crash): otherwise the transparent window keeps
 * whatever mask it had, and the message under it cannot be clicked.
 */
/** How far the drawn part of `mask` stays from the top, right and bottom of the view, in pixels; null when nothing is drawn. */
export function drawnInsets(mask: OpaqueMask, cell: number): { top: number; right: number; bottom: number } | null {
  let top = mask.rows;
  let right = -1;
  let bottom = -1;
  mask.cells.forEach((drawn, index) => {
    if (!drawn) return;
    const row = Math.floor(index / mask.columns);
    top = Math.min(top, row);
    right = Math.max(right, index % mask.columns);
    bottom = Math.max(bottom, row);
  });
  if (right < 0) return null;
  return { top: top * cell, right: (mask.columns - 1 - right) * cell, bottom: (mask.rows - 1 - bottom) * cell };
}

export function maskToElement(element: Element | null): void {
  if (!element || !petWindow.isNative) return;
  const columns = Math.ceil(window.innerWidth / HIT_CELL_PX);
  const rows = Math.ceil(window.innerHeight / HIT_CELL_PX);
  const cells = composeHitMask({ cell: HIT_CELL_PX, columns, rows, drawn: null, grow: 0, rects: [element.getBoundingClientRect()] });
  petWindow.setHitMask(HIT_CELL_PX, columns, cells).catch((error: unknown) => console.error("Failed to update the clickable area", error));
}
