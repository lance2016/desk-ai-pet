import { z } from "zod";
import { ACTIVITY_STATES, ALERT_ICONS, type ActivityUpdate } from "../types";

/** How long a report's parts may be, so one always fits the chip and the bubble. */
export const ACTIVITY_LIMITS = { id: 64, label: 12, text: 120 } as const;

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
}) satisfies z.ZodType<ActivityUpdate>;
