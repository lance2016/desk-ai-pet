import type { Skill } from "../ai/skill";
import { notesSkill } from "./notes";
import { petActionSkill } from "./petActions";
import { quietSkill } from "./quiet";
import { remindersSkill } from "./reminders";
import { rememberSkill } from "./remember";
import { reviewSkill } from "./review";

/**
 * What the pet can do in a chat, in the order their rules appear in the prompt.
 * A new ability is a new skill file added here; the chat, the pet and the AI module do not change.
 */
export const CHAT_SKILLS: readonly Skill[] = [remindersSkill, notesSkill, reviewSkill, rememberSkill, quietSkill, petActionSkill];
