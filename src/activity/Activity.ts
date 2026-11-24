import { z } from "zod";
import { ACTIVITY_STATES, ALERT_ICONS, type ActivityUpdate } from "../types";

/** How long a report's parts may be, so one always fits the chip and the bubble. */
export const ACTIVITY_LIMITS = { id: 64, label: 12, text: 120, opens: 8 } as const;

/**
 * A report from outside the pet window (a native event, another program). Whatever
 * receives one checks it with this before putting it on the bus as `pet.activity`.
 */
export const activityUpdateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_.:-]*$/).max(ACTIVITY_LIMITS.id),
  state: z.enum(ACTIVITY_STATES),
  label: z.string().trim().min(1).max(ACTIVITY_LIMITS.label),
  icon: z.enum(ALERT_ICONS),
  text: z.string().trim().min(1).max(ACTIVITY_LIMITS.text).optional(),
  cancellable: z.boolean().optional(),
  noChip: z.boolean().optional(),
  opens: z.string().trim().min(1).max(ACTIVITY_LIMITS.opens).optional(),
  keep: z.boolean().optional(),
}) satisfies z.ZodType<ActivityUpdate>;

const MINUTE_MS = 60_000;

/** How long something has run, for a small label: nothing under a minute, then "4 分", "1 小时 5 分". */
export function elapsedText(ms: number): string | null {
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} 分`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} 小时` : `${Math.floor(minutes / 60)} 小时 ${rest} 分`;
}
