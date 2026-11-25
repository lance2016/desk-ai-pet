/** Room kept between a bubble and the edge of the screen: the bubbles' `max-width` leaves this much on each side. */
const EDGE_GAP = 8;
/** The tail stays this far from either end of the bubble, clear of its rounded corners (14px) and half its own width. */
const TAIL_INSET = 19;

export interface BubblePlacement {
  /** How far to move the bubble from the middle of the on-screen area, in CSS pixels. */
  shift: number;
  /** Where its tail goes, from the bubble's left edge. */
  tail: number;
}

/**
 * Puts a bubble of `width` over the pet at `petX`, inside the on-screen area from `areaLeft` to `areaRight`
 * where it sits centred to begin with. It moves only as far as the screen edge needs, and its tail moves
 * back by as much, so it still points at the pet.
 */
export function bubblePlacement(width: number, petX: number, areaLeft: number, areaRight: number): BubblePlacement {
  const start = areaLeft + (areaRight - areaLeft - width) / 2;
  const lowest = areaLeft + EDGE_GAP;
  const highest = Math.max(lowest, areaRight - EDGE_GAP - width);
  const left = Math.min(highest, Math.max(lowest, petX - width / 2));
  const tail = Math.min(width - TAIL_INSET, Math.max(TAIL_INSET, petX - left));
  return { shift: left - start, tail };
}
