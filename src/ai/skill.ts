import type { ChatRuleId } from "../preferences/ChatRules";
import type { ChatContext } from "./types";

/** Action ids the model may pick: no hyphen, so the user's own actions (`my-…`) are never offered. */
export const ACTION_ID = /^[a-z0-9_]{1,40}$/;

/** A line under the reply about something a tool did. */
export interface EffectLine {
  /** "agenda" and "note" open the item with `id`; "fact" is about what the pet knows of the user; "quiet" about the pet keeping to itself; "failed" says what could not be done. */
  kind: "agenda" | "note" | "fact" | "quiet" | "failed";
  /** The item to open; none once it is gone. */
  id?: string;
  text: string;
  /** Puts things back as they were before the tool ran. */
  undo?: () => void;
}

/** What one tool call did. */
export interface ToolOutcome {
  /** What the model reads when the reply goes on to another round. */
  result: string;
  lines?: EffectLine[];
  /** Said for this call when the model wrote nothing. */
  confirmation?: string;
  /** Shown in the reply as it is, such as a list the user asked to see. */
  shown?: string;
  /** The model has to read `result` before it can answer: the reply goes on to another round. */
  needsModel?: boolean;
}

/** One reply's view for a running tool. */
export interface ToolCall {
  requestId: string;
  context: ChatContext;
  /** Kept for the whole reply, so one tool can leave something for another, such as numbers for listed items. */
  memo: Map<string, unknown>;
}

export interface Tool {
  name: string;
  /** What it does, in the user's words, for the settings window. `description` is written for the model. */
  label: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters(context: ChatContext): object;
  /**
   * Starts while the reply still streams, as soon as `ready` says its arguments are complete and valid.
   * One such call runs per reply; later ones are skipped.
   */
  early?: { ready(args: Record<string, unknown>, context: ChatContext): boolean };
  run(args: Record<string, unknown>, call: ToolCall): ToolOutcome | Promise<ToolOutcome>;
}

/** A part of the system prompt and the tools it explains. The user may rewrite the part's rules. */
export interface Skill {
  id: ChatRuleId;
  title: string;
  /** One line in the user's words for the settings window; `rules` is written for the model. */
  summary: string;
  /** Other skills whose tools this one's rules tell the model to use; it is off while any of them is. */
  requires?: readonly ChatRuleId[];
  rules(context: ChatContext): string;
  /** Offered only when this says so, e.g. pet actions only when the character has some. */
  available?(context: ChatContext): boolean;
  tools: readonly Tool[];
}

const turnedOff = (id: ChatRuleId, context: ChatContext): boolean => context.skillsOff?.includes(id) ?? false;
/** Whether the user leaves this skill on: it is not turned off in settings, and neither is any skill it needs. */
export const skillOn = (skill: Skill, context: ChatContext): boolean => !turnedOff(skill.id, context) && (skill.requires ?? []).every((id) => !turnedOff(id, context));
export const offeredSkills = (skills: readonly Skill[], context: ChatContext): Skill[] => skills.filter((skill) => skillOn(skill, context) && (skill.available?.(context) ?? true));

/** The tools in the OpenAI request format. */
export function toolDefinitions(skills: readonly Skill[], context: ChatContext): object[] {
  return offeredSkills(skills, context).flatMap((skill) => skill.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters(context) },
  })));
}

/**
 * A failure the user sees as `line`, which the model also reads if the reply goes on.
 * `needsModel`: the model can fix it, e.g. by looking the list up first.
 */
export function failed(line: string, options: { confirmation?: string; needsModel?: boolean } = {}): ToolOutcome {
  return { result: `没有做成：${line}`, lines: [{ kind: "failed", text: line }], confirmation: options.confirmation ?? line, needsModel: options.needsModel };
}
