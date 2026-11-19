import { z } from "zod";
import type { ChatFacts } from "../ai/types";
import { readList } from "../storage/listStorage";

/**
 * What the pet knows about the user, sent with every chat. Facts the user wrote
 * ("user") are the truth: chats never change them, and they win when a learned
 * one says otherwise. Facts a chat picked up ("chat") chats may replace or
 * forget. Shared by every character. A fact is about the user, never a task or
 * material to keep word for word: those are reminders and notes.
 */
const KEY = "ai-pet:facts:v1";
const LEARNING_KEY = "ai-pet:facts-learning:v1";
/** Learned facts are named "m1", "m2"… in a chat, so the tools can say which one. */
const REF_PREFIX = "m";

export const FACT_LIMITS = {
  /** Characters of one fact. */
  text: 80,
  /** Every fact goes with every chat, so the list stays short. */
  items: 50,
  idLength: 64,
} as const;

export type FactSource = "user" | "chat";

const factSchema = z.object({
  id: z.string().min(1).max(FACT_LIMITS.idLength),
  text: z.string().trim().min(1).max(FACT_LIMITS.text),
  source: z.enum(["user", "chat"]),
  /** When it was written or last changed. */
  at: z.number(),
});
const listSchema = z.array(factSchema).max(FACT_LIMITS.items);

export type Fact = z.infer<typeof factSchema>;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const byTime = (facts: readonly Fact[]) => [...facts].sort((a, b) => a.at - b.at);

/** Adds a fact. Throws on invalid text or a full list. */
export function addFact(facts: readonly Fact[], input: { id: string; text: string; source: FactSource }, now: number): Fact[] {
  if (facts.length >= FACT_LIMITS.items) throw new Error("The fact list is full");
  return [...facts, factSchema.parse({ ...input, text: oneLine(input.text), at: now })];
}

/** Rewrites a fact; it now belongs to whoever rewrote it. Throws on invalid text. */
export function editFact(facts: readonly Fact[], id: string, text: string, source: FactSource, now: number): Fact[] {
  return facts.map((fact) => (fact.id === id ? factSchema.parse({ ...fact, text: oneLine(text), source, at: now }) : fact));
}

export function removeFact(facts: readonly Fact[], id: string): Fact[] {
  return facts.filter((fact) => fact.id !== id);
}

/** Puts a fact back as it was (undo): replaced if it is still there, else added again unless the list is full. */
export function restoreFact(facts: readonly Fact[], before: Fact): Fact[] {
  if (facts.some((fact) => fact.id === before.id)) return facts.map((fact) => (fact.id === before.id ? before : fact));
  return facts.length >= FACT_LIMITS.items ? [...facts] : [...facts, before];
}

/** The facts, oldest first. */
export function loadFacts(storage: Storage = window.localStorage): Fact[] {
  return byTime(readList(storage, KEY, factSchema, FACT_LIMITS.items));
}

/** Changes the facts and tells other windows. Throws when the result cannot be saved. */
export function updateFacts(change: (facts: Fact[]) => Fact[], storage: Storage = window.localStorage): Fact[] {
  const next = byTime(listSchema.parse(change(loadFacts(storage))));
  storage.setItem(KEY, JSON.stringify(next));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(KEY);
    channel.postMessage("changed");
    channel.close();
  }
  return next;
}

/** Calls `onChange` when another window changes the facts; returns the unsubscribe. */
export function watchFacts(onChange: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(KEY);
  channel.onmessage = onChange;
  return () => channel.close();
}

/** Whether chats may remember and forget things about the user. Facts already kept are sent either way. */
export function loadFactLearning(storage: Storage = window.localStorage): boolean {
  return storage.getItem(LEARNING_KEY) !== "false";
}

export function saveFactLearning(value: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(LEARNING_KEY, String(value));
}

/** The facts as a chat sees them: the user's own as they are, learned ones numbered for the tools. */
export function chatFacts(facts: readonly Fact[], learning: boolean): ChatFacts {
  const learned = facts.filter((fact) => fact.source === "chat");
  return {
    mine: facts.filter((fact) => fact.source === "user").map((fact) => fact.text),
    learned: learned.map((fact, index) => ({ ref: `${REF_PREFIX}${index + 1}`, id: fact.id, text: fact.text })),
    learning,
  };
}

/** What the next chat request knows about the user, read now. */
export const currentChatFacts = (storage: Storage = window.localStorage): ChatFacts => chatFacts(loadFacts(storage), loadFactLearning(storage));
