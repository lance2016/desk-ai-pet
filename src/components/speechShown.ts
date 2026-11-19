/**
 * What the bubble above the pet shows. A passing line borrows it for a moment and the
 * standing one comes back after; but a question the user just asked for by pressing
 * something shows at once. A quick chat answer has the bubble to itself.
 */
export function speechShown<Alert extends { immediate?: boolean }>(line: string | null, alert: Alert | null, hasReply: boolean): { line: string | null; standing: Alert | null } {
  if (hasReply) return { line: null, standing: null };
  if (alert?.immediate) return { line: null, standing: alert };
  return line === null ? { line: null, standing: alert } : { line, standing: null };
}
