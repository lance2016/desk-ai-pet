import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref, type RefObject } from "react";
import { chatContext, loadSavedItems } from "../agenda/chatTools";
import { classifyServiceError, isKeyProblem, serviceErrorMessage } from "../chat/serviceErrors";
import { contextMessages, loadThreads, recordThread, saveThreads } from "../chat/ChatThreads";
import { pickQuickThread, plainReply, quickHistory, replyLingerMs } from "../chat/QuickChat";
import { applyToolCalls, dispatchChatAction, type SavedLine, type ToolEffects } from "../chat/toolEffects";
import type { PetRuntime } from "../core/PetRuntime";
import { chatPlatform, type ChatMessage } from "../platform/chat";
import { petWindow } from "../platform/petWindow";
import { characterName, requestPreferences } from "../preferences/ChatPreferences";
import type { ChatPhase } from "../types";
import { isComposing } from "./keyboard";

/** Same limit as the chat window's composer. */
const MAX_INPUT = 4000;
/** Same marks as the chat window. */
const CUT_OFF_MARK = "（太长了，没说完）";
const STORAGE_FULL = "聊天记录存满了，删掉几段旧聊天再试。";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** What the bubble above the pet shows. `fix` is where a click takes the user to sort out an error. */
export interface QuickReply {
  text: string;
  status: "thinking" | "streaming" | "done" | "error";
  fix?: "settings" | "chat";
  /** Reminders and memos the reply saved, as the AI understood them, and what it could not save. */
  saved?: SavedLine[];
  /** A small line under the reply, e.g. that it could not be kept in the chat history. */
  note?: string;
}

/** A key problem sends the user to settings; a network or account problem only says what happened. */
function errorReply(detail: string): QuickReply {
  const kind = classifyServiceError(detail);
  if (kind !== "other") console.warn("DeepSeek request failed", detail);
  return { text: serviceErrorMessage("DeepSeek", kind), status: "error", fix: isKeyProblem(kind) ? "settings" : undefined };
}

const MISSING_KEY_REPLY = errorReply("API key is not configured");

interface Request {
  id: string;
  threadId: string;
  /** The thread as kept, ending with the line being answered. */
  history: ChatMessage[];
  /** What the user typed, to put back if the reply fails. */
  typed: string;
  action?: Promise<ToolEffects>;
}

export interface QuickChat {
  open: boolean;
  draft: string;
  pending: boolean;
  /** True when no DeepSeek key is saved: the bar's send button opens the key settings instead. */
  keyMissing: boolean;
  reply: QuickReply | null;
  name: string;
  inputRef: RefObject<HTMLInputElement | null>;
  setDraft: (text: string) => void;
  close: (release: boolean) => void;
  send: () => void;
  cancel: () => void;
  expand: () => void;
  openReply: () => void;
  /** Opens a saved reminder in the reminders panel, or a saved note in the notes panel. */
  openSaved: (item: SavedLine) => void;
  /** Says so when a paste was cut at the input limit. */
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
}

const reportFocus = (error: unknown) => console.warn("Could not move keyboard focus for quick chat", error);

/** Takes an unanswered line back out of its thread, so sending it again does not add it twice. */
function dropUnanswered(packId: string, request: Request): void {
  const fresh = loadThreads(packId);
  if (!fresh.valid) return;
  const thread = fresh.threads.find((item) => item.id === request.threadId);
  if (!thread || thread.messages[thread.messages.length - 1]?.role !== "user") return;
  saveThreads(packId, recordThread(fresh.threads, request.threadId, thread.messages.slice(0, -1), thread.updatedAt));
}

/** Saves the finished reply into its thread and names a new thread after its first exchange. */
function saveReply(packId: string, request: Request, text: string): void {
  const fresh = loadThreads(packId);
  if (!fresh.valid) throw new Error("Chat threads are unreadable");
  const thread = fresh.threads.find((item) => item.id === request.threadId);
  const messages = [...(thread?.messages ?? request.history), { role: "assistant" as const, content: text }];
  saveThreads(packId, recordThread(fresh.threads, request.threadId, messages, Date.now()));

}

/**
 * The quick chat bar under the pet: opened by a click on the pet, the global
 * shortcut or the dock, it answers in the speech bubble and shares threads
 * with the chat window.
 */
export function useQuickChat(runtime: PetRuntime | null, packId: string): QuickChat {
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<QuickReply | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const request = useRef<Request | null>(null);
  const replyText = useRef("");
  const toolCalls = useRef<string[]>([]);
  /** The thread the bar last wrote to, for "open in the chat window". */
  const lastThread = useRef<string | null>(null);
  /** The thread written to since the bar last opened; each opening starts a new conversation. */
  const sessionThread = useRef<string | null>(null);

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  /** Talking counts as being with the pet: it wakes up and does not doze off mid-chat. */
  const wakePet = () => runtimeRef.current?.bus.emit("pet.wake_up", {});
  const show = () => {
    // Asked again while it is open (another click on the pet): the conversation goes on.
    if (!openRef.current) sessionThread.current = null;
    setOpen(true);
    setFocusRequest((count) => count + 1);
    wakePet();
  };
  const close = (release: boolean) => {
    setOpen(false);
    if (release) petWindow.releaseKeyboard().catch(reportFocus);
  };

  useEffect(() => {
    if (!open) return;
    petWindow.takeKeyboard().catch(reportFocus).finally(() => inputRef.current?.focus());
  }, [open, focusRequest]);

  // Say up front when there is no key, instead of letting the first message fail.
  useEffect(() => {
    if (!open) return;
    chatPlatform.keyStatus()
      .then((saved) => {
        setKeyMissing(!saved);
        if (!saved) setReply(MISSING_KEY_REPLY);
        else setReply((current) => (current === MISSING_KEY_REPLY ? null : current));
      })
      .catch(() => setKeyMissing(false));
  }, [open, focusRequest]);

  // Clicking into another app takes the keyboard away: put the bar away too.
  useEffect(() => {
    if (!open) return;
    const onBlur = () => close(false);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [open]);

  // The shortcut asks the pet like the dock's chat button does, so it comes to the user first: awake and out from the edge.
  useEffect(() => petWindow.onQuickChatRequested(() => {
    if (openRef.current) close(true);
    else if (runtimeRef.current) runtimeRef.current.bus.emit("pet.chat_requested", {});
    else show();
  }), []);

  // The pet is told where the conversation stands: it thinks until the reply starts, and stays with the user (no dozing, no wandering) for the rest.
  const phase: ChatPhase = pending ? (reply?.status === "streaming" ? "talking" : "thinking") : open ? "listening" : "idle";
  useEffect(() => { runtime?.bus.emit("pet.chat_phase", { phase }); }, [runtime, phase, draft]);
  // A click on the pet means "I want to talk to you"; so does the dock's chat button.
  useEffect(() => {
    if (!runtime) return;
    const stops = [runtime.bus.on("pet.clicked", show), runtime.bus.on("pet.chat_requested", show)];
    return () => stops.forEach((stop) => stop());
  }, [runtime]);

  // Once the bar is closed, a finished reply stays up long enough to read it.
  useEffect(() => {
    if (open || !reply || reply.status === "thinking" || reply.status === "streaming") return;
    const timer = setTimeout(() => setReply(null), replyLingerMs(reply.text));
    return () => clearTimeout(timer);
  }, [open, reply]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    chatPlatform.subscribe(async (event) => {
      const current = request.current;
      if (!current || event.id !== current.id) return;
      if (event.kind === "delta") { replyText.current += event.text; setReply({ text: replyText.current, status: "streaming" }); return; }
      if (event.kind === "tool") { toolCalls.current = [...toolCalls.current, event.text]; return; }
      if (event.kind === "action") { current.action ??= dispatchChatAction(event.text, event.id); return; }
      const action = event.kind === "done" && current.action ? await current.action : null;
      if (disposed || request.current !== current) return;
      request.current = null;
      setPending(false);
      if (event.kind === "cancelled" || event.kind === "error") {
        // A dispatched action is a side effect; leave its request in history on interruption.
        if (!current.action) {
          try { dropUnanswered(packId, current); } catch (error) { console.error("Could not take the unanswered line back", error); }
          setDraft((draft) => draft || current.typed);
        }
        setReply(event.kind === "error" ? errorReply(event.text || "回复中断") : null);
        if (event.kind === "error") runtimeRef.current?.bus.emit("pet.chat_phase", { phase: "failed" });
        return;
      }
      let saved: ReturnType<typeof applyToolCalls> = { lines: [], confirmation: "" };
      try { saved = applyToolCalls(toolCalls.current); } catch (error) {
        console.error("Failed to save the reminder or note", error);
        saved = { lines: [{ kind: "failed", text: "提醒或备忘没能保存，删掉几条旧的提醒或备忘再试" }], confirmation: "" };
      }
      if (action) saved.lines.push(...action.lines);
      const said = replyText.current.trim() || saved.confirmation || action?.confirmation;
      if (!said) { setReply({ text: "没有收到回复，再说一次试试。", status: "error", saved: saved.lines }); return; }
      const text = event.text === "length" ? `${said}\n\n${CUT_OFF_MARK}` : said;
      // The reply is shown even when it cannot be kept.
      let note: string | undefined;
      try { saveReply(packId, current, text); } catch (error) {
        console.error("Failed to save the quick chat reply", error);
        note = `这条回复没能存进聊天记录。${STORAGE_FULL}`;
      }
      setReply({ text, status: "done", saved: saved.lines, note });
    })
      .then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch((error: unknown) => console.warn("Quick chat is unavailable here", error));
    return () => {
      disposed = true;
      stop?.();
      if (request.current) void chatPlatform.cancel(request.current.id).catch(() => {});
    };
  }, [packId]);

  const start = async (text: string) => {
    if (!runtime) return;
    const now = Date.now();
    const loaded = loadThreads(packId);
    if (!loaded.valid) { setReply({ text: "聊天记录读不出来了，点这里到聊天窗口处理。", status: "error", fix: "chat" }); return; }
    const thread = pickQuickThread(loaded.threads, sessionThread.current);
    const threadId = thread?.id ?? newId();
    const history = quickHistory(thread, text);
    try { saveThreads(packId, recordThread(loaded.threads, threadId, history, now)); }
    catch (error) { console.error("Could not save the quick chat line", error); setReply({ text: STORAGE_FULL, status: "error", fix: "chat" }); return; }
    lastThread.current = threadId;
    sessionThread.current = threadId;
    const id = newId();
    const typed = draft;
    request.current = { id, threadId, history, typed };
    replyText.current = "";
    toolCalls.current = [];
    setDraft("");
    setPending(true);
    setReply({ text: "", status: "thinking" });
    const actions = runtime.chatActionIds();
    try {
      await chatPlatform.start(id, contextMessages(history), requestPreferences(packId, runtime.manifest.persona), chatContext(Date.now(), actions, loadSavedItems()));
    } catch (reason) {
      if (request.current?.id !== id) return;
      const failedRequest = request.current;
      request.current = null;
      setPending(false);
      try { dropUnanswered(packId, failedRequest); } catch (error) { console.error("Could not take the unanswered line back", error); }
      setDraft((current) => current || typed);
      const failed = errorReply(String(reason));
      if (failed.fix === "settings") setKeyMissing(classifyServiceError(String(reason)) === "missing-key");
      setReply(failed);
      runtime.bus.emit("pet.chat_phase", { phase: "failed" });
    }
  };

  /** Without a key the bar's way forward is the key form; what was typed stays for later. */
  const openKeySettings = () => {
    close(true);
    setReply(null);
    petWindow.openSettings("ai").catch((error: unknown) => console.error("Failed to open settings", error));
  };
  const send = () => {
    if (keyMissing) { openKeySettings(); return; }
    const text = draft.trim();
    if (!text || pending) return;
    wakePet();
    void start(text);
  };
  const cancel = () => {
    if (request.current) void chatPlatform.cancel(request.current.id).catch((error: unknown) => console.warn("Could not stop the reply", error));
  };
  /** Opens the same conversation while the quick chat request finishes in its original window. */
  const expand = () => {
    close(false);
    setReply(null);
    petWindow.openChat(lastThread.current ?? undefined).catch((error: unknown) => console.error("Failed to open chat", error));
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const pasted = event.clipboardData.getData("text").length;
    const kept = draft.length - ((field.selectionEnd ?? 0) - (field.selectionStart ?? 0)) + pasted;
    if (kept > MAX_INPUT) setReply({ text: `内容太长，只保留了前 ${MAX_INPUT} 字。`, status: "done" });
  };
  const openSaved = (item: SavedLine) => {
    if (!item.id) { expand(); return; }
    close(false);
    setReply(null);
    const opened = item.kind === "note" ? petWindow.openNotes(item.id) : petWindow.openToday(item.id);
    opened.catch((error: unknown) => console.error("Failed to open the saved item", error));
  };
  const openReply = () => {
    if (reply?.fix === "settings") {
      setReply(null);
      petWindow.openSettings("ai").catch((error: unknown) => console.error("Failed to open settings", error));
      return;
    }
    expand();
  };

  const ownName = runtime ? runtime.manifest.persona?.name ?? runtime.manifest.name : "宠物";
  return { open, draft, pending, keyMissing, reply, name: characterName(packId, ownName), inputRef, setDraft, close, send, cancel, expand, openReply, openSaved, onPaste };
}

function Icon({ name }: { name: "send" | "stop" | "expand" }) {
  const paths = {
    send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    expand: <path d="M14 4h6v6M20 4l-8 8M10 5H5v14h14v-5" />,
  } as const;
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

/** The input bar that takes the dock's place while it is open. */
export function QuickChatBar({ chat, ref }: { chat: QuickChat; ref?: Ref<HTMLFormElement> }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Escape") { event.preventDefault(); chat.close(true); }
    if (event.key === "Enter") { event.preventDefault(); chat.send(); }
  };
  return (
    <div className="dock-area">
      <form ref={ref} className="quick-chat" onSubmit={(event) => { event.preventDefault(); chat.send(); }}>
        <input
          ref={chat.inputRef}
          value={chat.draft}
          maxLength={MAX_INPUT}
          aria-label={`和${chat.name}说话`}
          placeholder={chat.keyMissing ? "填上 DeepSeek API Key 才能聊天" : `和${chat.name}说点什么… Esc 收起`}
          onChange={(event) => chat.setDraft(event.currentTarget.value)}
          onPaste={chat.onPaste}
          onKeyDown={onKeyDown}
        />
        {chat.pending
          ? <button type="button" onClick={chat.cancel} aria-label="停止回复" title="停止回复"><Icon name="stop" /></button>
          : chat.keyMissing
            ? <button type="submit" className="quick-chat__fix" title="打开设置，填写 DeepSeek API Key">去设置</button>
            : <button type="submit" disabled={!chat.draft.trim()} aria-label="发送" title="发送（Enter）"><Icon name="send" /></button>}
        <button type="button" onClick={chat.expand} aria-label="在聊天窗口打开" title="在聊天窗口打开"><Icon name="expand" /></button>
      </form>
    </div>
  );
}

/** The answer in the speech bubble. A click opens the whole conversation, or the fix for an error. */
export function QuickReplyBubble({ chat, ref }: { chat: QuickChat; ref?: Ref<HTMLDivElement> }) {
  const { reply } = chat;
  const textRef = useRef<HTMLSpanElement>(null);
  /** The bubble shows a few lines; say so when the reply goes on. */
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const field = textRef.current;
    setClipped(field !== null && field.scrollHeight > field.clientHeight + 1);
  }, [reply]);
  if (!reply) return null;
  const error = reply.status === "error";
  const text = reply.status === "thinking" ? "正在想…" : error ? reply.text : plainReply(reply.text);
  const hint = reply.fix === "settings" ? "去设置" : "在聊天窗口打开";
  // One saved line fits the bubble; the rest wait in the chat window.
  const lines = reply.saved ?? [];
  const first = lines.find((line) => line.kind === "failed") ?? lines[0];
  const more = lines.length - (first ? 1 : 0);
  return (
    <div ref={ref} className={`speech-bubble speech-bubble--reply${error ? " is-error" : ""}${reply.saved?.length || reply.fix === "settings" ? " has-extra" : ""}`} role="button" tabIndex={-1} title={hint} onClick={chat.openReply}>
      <span className="speech-bubble__spark" aria-hidden="true">✦</span>
      <span className="speech-bubble__body">
        <span ref={textRef} className="speech-bubble__text">{text}</span>
        {clipped && reply.status === "done" && <small className="speech-bubble__fix">点开看完整回复</small>}
        {reply.note && <small className="speech-bubble__fix">{reply.note}</small>}
        {reply.fix === "settings" && <small className="speech-bubble__fix">点一下去设置</small>}
        {first && (
          <span className={first.kind === "failed" ? "speech-bubble__saved is-failed" : "speech-bubble__saved"}>
            <span>{first.text}</span>
            <button type="button" onClick={(event) => { event.stopPropagation(); chat.openSaved(first); }}>{first.kind === "note" ? "查看" : first.kind === "agenda" ? "修改" : "看详情"}</button>
          </span>
        )}
        {more > 0 && <small className="speech-bubble__fix">还有 {more} 条，点开看全部</small>}
      </span>
    </div>
  );
}
