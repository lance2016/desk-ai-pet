import { z } from "zod";
import { readList } from "../storage/listStorage";

const KEY = "ai-pet:links:v1";
const ENABLED_KEY = "ai-pet:links-enabled:v1";
const CHANGED = "pet:links-changed";
export const LINK_LIMITS = { name: 100, url: 2048, group: 60, tag: 16, count: 200 } as const;

const webAddress = z.string().trim().max(LINK_LIMITS.url).transform((value) => value.replace(/^https?:/i, (scheme) => scheme.toLowerCase())).refine((value) => {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/u.test(value) || new TextEncoder().encode(value).length > LINK_LIMITS.url) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "请输入以 http:// 或 https:// 开头的网址");

export const linkSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "请输入名称").max(LINK_LIMITS.name),
  url: webAddress,
  group: z.string().trim().max(LINK_LIMITS.group),
  tag: z.string().trim().max(LINK_LIMITS.tag),
});

const linksSchema = z.array(linkSchema).max(LINK_LIMITS.count);
export type WorkLink = z.infer<typeof linkSchema>;

export function loadLinks(storage: Storage = window.localStorage): WorkLink[] {
  return readList(storage, KEY, linkSchema, LINK_LIMITS.count);
}

export function updateLinks(change: (links: WorkLink[]) => WorkLink[], storage: Storage = window.localStorage): void {
  const validated = linksSchema.parse(change(loadLinks(storage)));
  const next = [...linksByGroup(validated).values()].flat();
  storage.setItem(KEY, JSON.stringify(next));
  notify();
}

export function linksEnabled(storage: Storage = window.localStorage): boolean {
  return storage.getItem(ENABLED_KEY) !== "false";
}

export function setLinksEnabled(enabled: boolean): void {
  window.localStorage.setItem(ENABLED_KEY, String(enabled));
  notify();
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function subscribeLinks(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY || event.key === ENABLED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, listener);
  };
}

export function linksByGroup(links: readonly WorkLink[], query = ""): Map<string, WorkLink[]> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, WorkLink[]>();
  for (const link of links) {
    const text = [link.name, link.url, link.tag, link.group].join(" ").toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;
    const group = groups.get(link.group) ?? [];
    group.push(link);
    groups.set(link.group, group);
  }
  return groups;
}

export function moveLink(links: WorkLink[], id: string, targetId: string): WorkLink[] {
  const from = links.findIndex((link) => link.id === id);
  const to = links.findIndex((link) => link.id === targetId);
  const link = links[from];
  const target = links[to];
  if (!link || !target || from === to) return links;
  const next = [...links];
  next.splice(from, 1);
  next.splice(to, 0, { ...link, group: target.group });
  return next;
}

export function moveLinkGroup(links: WorkLink[], name: string, direction: -1 | 1): WorkLink[] {
  const groups = [...linksByGroup(links)];
  const index = groups.findIndex(([group]) => group === name);
  const adjacent = groups[index + direction];
  if (index < 0 || !adjacent) return links;
  [groups[index], groups[index + direction]] = [adjacent, groups[index]];
  return groups.flatMap(([, entries]) => entries);
}
