import { z } from "zod";

/** The nickname limit is also enforced as `MAX_USER_NAME_CHARS` in `src-tauri/src/chat.rs`. */
export const USER_PROFILE_LIMITS = { nickname: 20 } as const;
/** About the user, shared by every character. */
const PROFILE_KEY = "ai-pet:user-profile:v1";
const ONBOARDED_KEY = "ai-pet:onboarded:v1";

const schema = z.object({ nickname: z.string().trim().max(USER_PROFILE_LIMITS.nickname) });
export type UserProfile = z.infer<typeof schema>;
const EMPTY_PROFILE: UserProfile = { nickname: "" };

export function loadUserProfile(storage: Storage = window.localStorage): UserProfile {
  try { const raw = storage.getItem(PROFILE_KEY); return raw ? schema.parse(JSON.parse(raw)) : EMPTY_PROFILE; }
  catch (error) { console.warn("Ignoring an unreadable user profile", error); return EMPTY_PROFILE; }
}

export function saveUserProfile(value: UserProfile, storage: Storage = window.localStorage): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(schema.parse(value)));
}

/** True once the welcome guide was finished or skipped. */
export function isOnboarded(storage: Storage = window.localStorage): boolean {
  return storage.getItem(ONBOARDED_KEY) === "true";
}

export function markOnboarded(storage: Storage = window.localStorage): void {
  storage.setItem(ONBOARDED_KEY, "true");
}
