import { z } from "zod";

const KEY = "ai-pet:companion-preferences:v1";
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  night: z.boolean(), rest: z.boolean(), welcomeBack: z.boolean(), nightDuringQuiet: z.boolean().default(false),
  morningGreeting: z.boolean().default(true), morningTime: timeSchema.default("08:00"),
  headsUp: z.boolean().default(true), followUp: z.boolean().default(true),
  nightTime: timeSchema,
  restMinutes: z.number().int().min(30).max(240),
});
export type CompanionPreferences = z.infer<typeof schema>;
export const DEFAULT_COMPANION: CompanionPreferences = { night: true, rest: true, welcomeBack: true, nightDuringQuiet: false, morningGreeting: true, morningTime: "08:00", headsUp: true, followUp: true, nightTime: "23:30", restMinutes: 90 };

export function loadCompanionPreferences(storage: Storage = window.localStorage): CompanionPreferences {
  try { const raw = storage.getItem(KEY); return raw ? schema.parse(JSON.parse(raw)) : DEFAULT_COMPANION; }
  catch (error) { console.warn("Ignoring invalid companion preferences", error); return DEFAULT_COMPANION; }
}

export function saveCompanionPreferences(value: CompanionPreferences, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(schema.parse(value)));
}
