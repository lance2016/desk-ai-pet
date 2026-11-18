import { version } from "../../package.json";
import notes from "./releaseNotes.json";

/** The version this build is. */
export const CURRENT_VERSION = version;

export const FEATURE_ICONS = ["bell", "search", "list", "text", "moon"] as const;
export const FEATURE_COLORS = ["orange", "blue", "pink", "purple", "indigo"] as const;

export interface Feature {
  icon: (typeof FEATURE_ICONS)[number];
  color: (typeof FEATURE_COLORS)[number];
  title: string;
  detail: string;
}

/** What changed in one version, as the "新功能" sheet shows it. scripts/release.sh publishes the same notes. */
export interface ReleaseNotes {
  features: Feature[];
  /** Smaller changes, in one sentence under the list. */
  more?: string;
}

const RELEASE_NOTES = notes as Record<string, ReleaseNotes>;

/** The notes for `version`, or null when it has none. */
export const notesFor = (target: string): ReleaseNotes | null => RELEASE_NOTES[target] ?? null;

/** The version whose "新功能" sheet the user has closed. */
export const SEEN_KEY = "ai-pet:whats-new-seen:v1";
/** The version the pet has told the user it was updated to. */
export const ANNOUNCED_KEY = "ai-pet:whats-new-announced:v1";

export const updatedLine = (target: string) => `我更新到 ${target} 了，新功能在「设置 → 关于」里`;

type Store = Pick<Storage, "getItem" | "setItem">;

/** The sheet opens by itself until the user has closed it once for this version. */
export const shouldShowWhatsNew = (storage: Store, target = CURRENT_VERSION): boolean =>
  notesFor(target) !== null && storage.getItem(SEEN_KEY) !== target;

export const markWhatsNewSeen = (storage: Store, target = CURRENT_VERSION): void => storage.setItem(SEEN_KEY, target);

/**
 * A new user has nothing to compare with: nothing is announced and the sheet
 * stays closed until they open it from "关于".
 */
export function skipWhatsNew(storage: Store, target = CURRENT_VERSION): void {
  storage.setItem(SEEN_KEY, target);
  storage.setItem(ANNOUNCED_KEY, target);
}

/**
 * After an update, the pet says once that it was updated and where to look.
 * `say` returns whether the pet could speak up now; if not, it tries again next start.
 */
export function announceUpdate(storage: Store, say: (text: string) => boolean, target = CURRENT_VERSION): void {
  if (!shouldShowWhatsNew(storage, target) || storage.getItem(ANNOUNCED_KEY) === target) return;
  if (say(updatedLine(target))) storage.setItem(ANNOUNCED_KEY, target);
}
