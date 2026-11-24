/**
 * Stands in for `:hover` in the pet window: marks the element under the cursor and
 * everything around it with `data-hover`, and the styles match that instead.
 *
 * WebKit updates `:hover` only in the key window, and the pet's panel is not the key
 * window until it is clicked: the hover look lagged or stayed on the last button
 * clicked while the cursor was on another. The native side reports where the cursor
 * is (`petWindow.onPointerMoved`), so the page finds what is under it itself.
 * An attribute, not a class: React rewrites `className` on every render and would drop it.
 */
export const HOVER_ATTRIBUTE = "data-hover";

/** The parts of a DOM element the mark needs. */
export interface Markable {
  readonly parentElement: Markable | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface HoverMark {
  /** The cursor is at `x`, `y` in the window, in CSS pixels. */
  at(x: number, y: number): void;
  /** The cursor has left the pet. */
  clear(): void;
}

export function createHoverMark(find: (x: number, y: number) => Markable | null): HoverMark {
  let marked: Markable[] = [];
  const mark = (target: Markable | null) => {
    const chain: Markable[] = [];
    for (let element = target; element; element = element.parentElement) chain.push(element);
    for (const element of marked) if (!chain.includes(element)) element.removeAttribute(HOVER_ATTRIBUTE);
    for (const element of chain) if (!marked.includes(element)) element.setAttribute(HOVER_ATTRIBUTE, "");
    marked = chain;
  };
  return { at: (x, y) => mark(find(x, y)), clear: () => mark(null) };
}
