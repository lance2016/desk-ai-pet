/** Names of the procedural motions a single-frame animation can use. */
export const MOTION_PRESETS = [
  "none",
  "breathe",
  "bounce",
  "sway",
  "squash",
  "wiggle",
  "pop",
  "tilt",
  "nod",
  "float",
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number];

/**
 * How much a standard action matters, most needed first: a character with few
 * pictures draws them in this order, and the rest borrow a picture.
 */
export const ACTION_TIERS = ["required", "core", "standard", "interactive", "fun"] as const;

export type ActionTier = (typeof ACTION_TIERS)[number];

/**
 * When the pet does a standard action, as the action library groups them:
 * on its own, when touched, in a chat, while helping with reminders, notes
 * and focus, or as a little game the user starts.
 */
export const ACTION_SCENES = ["companion", "touch", "chat", "tasks", "play"] as const;

export type ActionScene = (typeof ACTION_SCENES)[number];

/** Built-in quick-action icons exposed to the resource pack and settings UI. */
export const CONTROL_ICON_PRESETS = [
  "feed",
  "carrot",
  "gift",
  "wooden_fish",
  "mallet",
  "bell",
  "rest",
  "bed",
  "sun",
  "timer",
  "hourglass",
  "book",
  "sparkle",
  "chat",
  "checklist",
  "note",
  "clipboard",
] as const;

export type ControlIconPreset = (typeof CONTROL_ICON_PRESETS)[number];

/** MiMo TTS voice ids a character may use. */
export const MIMO_VOICES = ["mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"] as const;

export type MimoVoice = (typeof MIMO_VOICES)[number];

/** Length limits of persona text. */
export const PERSONA_LIMITS = { name: 20, personality: 1000, voiceStyle: 200 } as const;

export interface ActionDefinition {
  id: string;
  category: string;
  /** Id of the animation the renderer plays for this action. */
  animation: string;
  priority: number;
  loop: boolean;
  interruptible: boolean;
  /** Milliseconds until the action completes. Undefined means "until replaced". */
  duration?: number;
  /** Minimum milliseconds between two starts of this action. */
  cooldown?: number;
  /** Action to use when this action's asset is missing. */
  fallback?: string;
}

export interface PetStats {
  satiety: number;
  energy: number;
  mood: number;
  affinity: number;
}

export type PetActivity = "awake" | "sleeping";

export type PetEmotion = "happy" | "calm" | "sad" | "sleepy" | "hungry";

export interface PetSnapshot {
  stats: PetStats;
  activity: PetActivity;
  /** Epoch milliseconds of the last user interaction. */
  lastInteractionAt: number;
  /** Epoch milliseconds the stats were last advanced to. */
  updatedAt: number;
}

export type HitRegion = "head" | "body";

/** The screen edge the pet is hiding behind. */
export type DockSide = "left" | "right";

/** Every event on the bus, mapped to its payload. */
/**
 * Where a conversation with the pet stands, reported by the quick chat bar and
 * the chat window: the user is typing or speaking, a reply is awaited, it is
 * coming in, or it failed. "idle" ends it.
 */
export const CHAT_PHASES = ["idle", "listening", "thinking", "talking", "failed"] as const;

export type ChatPhase = (typeof CHAT_PHASES)[number];

/**
 * How "查收验证码" in the pet menu is going, as the native side reports it:
 * waiting for mail, a code was found (and copied), a verification email came
 * whose code could not be read, two minutes passed, the user stopped it, no
 * mailbox is set up, or it failed with a message for the user.
 */
export type MailCodeUpdate =
  | { kind: "waiting" }
  | { kind: "found"; code: string; sender: string; copied: boolean }
  | { kind: "unrecognized"; sender: string }
  | { kind: "timeout" }
  | { kind: "cancelled" }
  | { kind: "unset" }
  | { kind: "failed"; message: string };

/** One part of the status row at the pet's feet. Each part is its own button, or a plain label for "dnd". */
export type StatusChipId = "focus" | "rest" | "reminders" | "dnd" | "mail_code";

export interface StatusChip {
  id: StatusChipId;
  label: string;
  /** How much of the focus round or the rest has passed, from 0 to 1. */
  progress?: number;
}

/** A button on the standing line. Clicking it reports `event`; the engine decides what follows. */
export interface AlertChoice {
  label: string;
  event: "pet.alert_dismissed" | "pet.focus_stopped" | "pet.focus_toggled" | "pet.reminders_done" | "pet.reminders_snoozed" | "pet.leftovers_moved";
  /** Throws something away, such as the running focus round. */
  destructive?: boolean;
}

export interface PetEvents {
  "pet.clicked": { region: HitRegion };
  /** A long press on the pet, or "摸摸头" in the pet menu. */
  "pet.petted": Record<string, never>;
  /** The dock's chat button: open the quick chat bar (a click on the pet opens it too). */
  "pet.chat_requested": Record<string, never>;
  /** The conversation moved on; the pet listens, thinks or talks along. */
  "pet.chat_phase": { phase: ChatPhase };
  /** A reminder or a note was written down, by the user or by the AI. */
  "pet.noted": Record<string, never>;
  /** A reminder was ticked off. */
  "pet.item_done": Record<string, never>;
  /** "查收验证码" moved on; the pet shows it is waiting and says what came of it. */
  "pet.mail_code": MailCodeUpdate;
  /** The cursor came onto the pet. */
  "pet.hovered": Record<string, never>;
  /** When the user last touched the keyboard or mouse anywhere, polled from the system now and then. */
  "pet.user_active": { at: number };
  "pet.drag_started": Record<string, never>;
  /** `dockSide` is the screen edge the pet was dropped against, if any. */
  "pet.drag_ended": { dockSide: DockSide | null };
  /** The pet started (`side` set) or stopped (`null`) hiding behind a screen edge. */
  "pet.dock_changed": { side: DockSide | null };
  "pet.fed": Record<string, never>;
  "pet.wooden_fish": Record<string, never>;
  "pet.sleep": Record<string, never>;
  "pet.wake_up": Record<string, never>;
  /** An action from the dock or the action library. A sleeping pet wakes up first, then plays it. */
  "pet.action_requested": { id: string };
  "pet.chat_action_requested": { id: string; report: (result: ActionResult) => void };
  /** Starts a focus round, or asks on the standing line before stopping the running one. */
  "pet.focus_toggled": Record<string, never>;
  /** The focus or rest countdown at the pet's feet was clicked. */
  "pet.focus_badge_clicked": Record<string, never>;
  /** Stops the round or the rest right away, as the menu's "停止专注" / "结束休息" does. */
  "pet.focus_stopped": Record<string, never>;
  /** A focus round ran to its end. */
  "pet.focus_completed": Record<string, never>;
  /**
   * A greeting the pet should call out, coming out to meet the user.
   * `offerMove`: earlier reminders are still open; the pet offers to move them to today.
   */
  "pet.greeting": { text: string; offerMove?: boolean };
  "pet.appearance.changed": Record<string, never>;
  /** The user made, changed or deleted one of their own actions. */
  "pet.actions.changed": Record<string, never>;
  /** A short line for the speech bubble. */
  "pet.say": { text: string };
  /**
   * A line that stays up until the user dismisses it, such as due reminders; `null` takes it down.
   * `more`: the line names only some reminders, so a click should open the reminders panel.
   * `icon`: what the line is about; a bell when left out.
   * `choices`: the line asks something and only these buttons answer it; a click elsewhere on it does nothing.
   */
  /** `heading`: a short word over the text, such as "到点啦" over a reminder's own words. */
  "pet.alert": { text: string | null; heading?: string; more?: boolean; icon?: "mail" | "timer"; choices?: AlertChoice[] };
  /** The user clicked the standing line away. */
  "pet.alert_dismissed": Record<string, never>;
  /** "完成" on the reminder line: tick off the reminders it names. */
  "pet.reminders_done": Record<string, never>;
  /** "稍后提醒" on the reminder line: bring its reminders up again a little later. */
  "pet.reminders_snoozed": Record<string, never>;
  /** "挪到今天" after the morning greeting: earlier reminders still open move to today. */
  "pet.leftovers_moved": Record<string, never>;
  /** The status row at the pet's feet, such as a focus countdown; empty hides it. */
  "pet.badge": { chips: StatusChip[] };
  "pet.action.started": { actionId: string };
  "pet.action.completed": { actionId: string };
}

export type ActionRejection = "busy" | "cooldown" | "unavailable" | "restricted";

export type ActionResult =
  | { accepted: true; actionId: string }
  | { accepted: false; reason: ActionRejection };
