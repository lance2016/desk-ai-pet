/**
 * Runs one chat turn against the real model, the way the app does: the same prompt,
 * tools and tool loop (`src/ai/`, `src/skills/`), with the tools working on an
 * in-memory store instead of the user's data. Used by `pnpm eval` only.
 */
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { chatContext } from "../src/agenda/chatTools";
import { addAgendaItem, loadAgenda, updateAgenda, type AgendaItem } from "../src/agenda/AgendaStore";
import type { Repeat } from "../src/agenda/Repeat";
import standardActions from "../src/actions/standardActions.json";
import { offeredSkills, offeredTools, type ToolCall as SkillCall, type ToolOutcome } from "../src/ai/skill";
import type { SwitchedOff } from "../src/preferences/SkillPreferences";
import { nextRound, chatRequest, type AnsweredCall, type RequestBody } from "../src/ai/requests";
import type { ToolCall as ModelCall } from "../src/ai/stream";
import { addFact, currentChatFacts, loadFacts, updateFacts, type Fact, type FactSource } from "../src/facts/FactStore";
import { loadNotes, saveNote, type Note } from "../src/notes/NoteStore";
import { DEFAULT_CHAT_MODEL } from "../src/preferences/ChatModel";
import { DEFAULT_CHAT_PREFERENCES, type ChatRequestPreferences } from "../src/preferences/ChatPreferences";
import { CHAT_SKILLS } from "../src/skills";
import { createMemoryStorage } from "../src/testing/fixtures";

/** Must match `PROVIDERS` in `src-tauri/src/llm.rs`. */
const ENDPOINT = "https://api.deepseek.com/chat/completions";
/** As in `src/ai/chatRun.ts`. */
const MAX_ROUNDS = 4;

/** What a case puts in place before the user speaks. */
export interface Setup {
  reminders?: { text: string; at: number; repeat?: Repeat }[];
  notes?: string[];
  facts?: { text: string; source: FactSource }[];
  /** What the pet said by itself just before; the sentence answers it. */
  opening?: string;
  /** Skills and single tools the user turned off in settings. */
  off?: SwitchedOff;
}

/** What the model did with one sentence, and what the store looks like afterwards. */
export interface ChatRun {
  calls: { name: string; args: Record<string, unknown> }[];
  reply: string;
  reminders: AgendaItem[];
  notes: Note[];
  facts: Fact[];
}

let cachedKey: string | null = null;

/** Reads the same v1 credential as the desktop app without invoking Keychain. */
export function apiKey(): string {
  if (cachedKey) return cachedKey;
  const override = process.env.DEEPSEEK_API_KEY?.trim();
  if (override) return cachedKey = override;
  const dir = join(homedir(), "Library/Application Support/com.aipet.desktop/credentials-v1");
  const nonceBytes = 12;
  const tagBytes = 16;
  try {
    const data = readFileSync(join(dir, "deepseek"));
    const decipher = createDecipheriv("aes-256-gcm", readFileSync(join(dir, "master.v1")), data.subarray(0, nonceBytes));
    decipher.setAAD(Buffer.from("deepseek"));
    decipher.setAuthTag(data.subarray(-tagBytes));
    cachedKey = Buffer.concat([decipher.update(data.subarray(nonceBytes, -tagBytes)), decipher.final()]).toString("utf8");
    return cachedKey;
  } catch {
    throw new Error("Could not read local DeepSeek key: set DEEPSEEK_API_KEY or save it in the app");
  }
}

/** The actions a character offers the model: every standard one the pet may be asked for. */
const OFFERED_ACTIONS = standardActions.actions.filter((action) => !("category" in action) || action.category === undefined).map((action) => action.id);

function preferences(): ChatRequestPreferences {
  return { ...DEFAULT_CHAT_PREFERENCES, userName: "", model: process.env.EVAL_MODEL || DEFAULT_CHAT_MODEL, instructions: "", rules: {}, record: false };
}

function seed(setup: Setup, now: number): void {
  for (const [index, item] of (setup.reminders ?? []).entries()) {
    updateAgenda((items) => addAgendaItem(items, { id: `seed-r${index}`, text: item.text, remindAt: item.at, repeat: item.repeat }, now));
  }
  for (const text of setup.notes ?? []) saveNote(text);
  for (const [index, fact] of (setup.facts ?? []).entries()) {
    updateFacts((facts) => addFact(facts, { id: `seed-f${index}`, ...fact }, now - 60_000 + index));
  }
}

interface ModelReply { content: string; calls: ModelCall[] }

async function ask(body: RequestBody): Promise<ModelReply> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ ...body, stream: false, stream_options: undefined }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DeepSeek answered ${response.status}: ${text.slice(0, 300)}`);
  const message = JSON.parse(text).choices?.[0]?.message ?? {};
  const calls = (message.tool_calls ?? []).map((call: { id?: string; function?: { name?: string; arguments?: string } }) => ({
    id: call.id ?? "",
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "",
    overflow: false,
  }));
  return { content: typeof message.content === "string" ? message.content : "", calls };
}

function readArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Says `say` after `setup`, runs the tool loop to the end, and reports what happened. */
export async function runChat(setup: Setup, say: string): Promise<ChatRun> {
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  try {
    const now = Date.now();
    seed(setup, now);
    const context = chatContext(now, OFFERED_ACTIONS, currentChatFacts(), setup.opening, setup.off);
    const tools = new Map(offeredSkills(CHAT_SKILLS, context).flatMap((skill) => offeredTools(skill, context).map((tool) => [tool.name, tool] as const)));
    const call: SkillCall = { requestId: "eval", context, memo: new Map() };
    const run: ChatRun = { calls: [], reply: "", reminders: [], notes: [], facts: [] };
    let body = chatRequest([{ role: "user", content: say }], preferences(), context, CHAT_SKILLS);
    for (let round = 1; ; round += 1) {
      const reply = await ask(body);
      run.reply += reply.content;
      const answered: AnsweredCall[] = [];
      let needsModel = false;
      for (const modelCall of reply.calls) {
        const args = readArgs(modelCall.arguments);
        run.calls.push({ name: modelCall.name, args });
        const tool = tools.get(modelCall.name);
        const outcome: ToolOutcome = tool ? await tool.run(args, call) : { result: `没有这个工具：${modelCall.name}` };
        answered.push({ call: modelCall, result: outcome.result });
        needsModel ||= outcome.needsModel === true;
      }
      if (!needsModel || round >= MAX_ROUNDS) break;
      body = nextRound(body, reply.content, answered, round + 1 >= MAX_ROUNDS);
    }
    return { ...run, reminders: loadAgenda(), notes: loadNotes(), facts: loadFacts() };
  } finally {
    vi.unstubAllGlobals();
  }
}

/** A one-line account of a run, for a failed case. */
export function describeRun(run: ChatRun): string {
  const calls = run.calls.map((item) => `${item.name}(${JSON.stringify(item.args)})`).join(", ") || "no tools";
  return `${calls} | reply: ${run.reply.replace(/\s+/g, " ").slice(0, 120)}`;
}
