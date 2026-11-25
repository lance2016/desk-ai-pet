/**
 * How long 撤销 stays up after something is deleted or moved aside, in every window: long enough to
 * read what happened and reach the button. Failures are not timed: they stay as red text until the
 * next thing the user does.
 */
export const UNDO_MS = 6_000;
