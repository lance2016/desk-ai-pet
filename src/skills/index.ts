import type { Skill } from "../ai/skill";
import { lookupSkill } from "./lookup";
import { memorySkill } from "./memory";
import { petActionSkill } from "./petActions";
import { rememberSkill } from "./remember";

/**
 * What the pet can do in a chat, in the order their rules appear in the prompt.
 * A new ability is a new skill file added here; the chat, the pet and the AI module do not change.
 */
export const CHAT_SKILLS: readonly Skill[] = [memorySkill, lookupSkill, rememberSkill, petActionSkill];
