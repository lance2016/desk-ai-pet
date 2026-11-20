import type { Occasion } from "../types";
import { LATE_NIGHT, REST, WELCOME_BACK } from "./care";
import { EVENING, MORNING } from "./greetings";
import { FOLLOW_UP, HEADS_UP } from "./reminders";

/**
 * Every reason the pet speaks up by itself. When several are due at once, the earlier one is said:
 * the word ahead of a reminder first, as it cannot wait; asking after what the user left for before the plain welcome.
 */
export const OCCASIONS: readonly Occasion[] = [HEADS_UP, MORNING, EVENING, FOLLOW_UP, WELCOME_BACK, LATE_NIGHT, REST];
