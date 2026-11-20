import type { Occasion } from "../types";
import { LATE_NIGHT, REST, WELCOME_BACK } from "./care";
import { EVENING, MORNING } from "./greetings";

/** Every reason the pet speaks up by itself. When several are due at once, the earlier one is said. */
export const OCCASIONS: readonly Occasion[] = [MORNING, EVENING, WELCOME_BACK, LATE_NIGHT, REST];
