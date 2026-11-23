import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref, type RefObject } from "react";
import { ai, type EffectLine, type Skill } from "../ai";
import { chatContext } from "../agenda/chatTools";
import { currentChatFacts } from "../facts/FactStore";
import { classifyServiceError, isKeyProblem, serviceErrorMessage } from "../chat/serviceErrors";
import { contextMessages, loadThreads, openingLine, recordThread, saveThreads } from "../chat/ChatThreads";
import { QUICK_CHAT_CONFIG, answerable, pickQuickThread, plainReply, quickHistory, replyLingerMs, withoutLastLine, type Spoken } from "../chat/QuickChat";
import type { PetRuntime } from "../core/PetRuntime";
import { fitSpeech } from "../core/SpeechQueue";
import type { ChatMessage } from "../platform/chat";
import { petWindow } from "../platform/petWindow";
import { characterName, requestPreferences } from "../preferences/ChatPreferences";
import { CHAT_SKILLS } from "../skills";
import { petActionSkill } from "../skills/petActions";
import { readText } from "../agenda/chatTools";
import { ACTION_LABELS, ACTION_QUESTIONS, handedMessage, handover, handoverPreview, suggestions, type Handover, type HandoverAction } from "../handover/Handover";
import type { Dropped } from "../handover/dropped";
import { prepareChatImage } from "../chat/ChatImage";
import { handoverPlatform } from "../platform/handover";
import type { ChatLauncher } from "../preferences/DisplayPreferences";
import { loadNotes, NOTE_LIMITS, removeNote } from "../notes/NoteStore";
import { changeNotes, keepNote } from "../worklog/store";
import type { ChatPhase } from "../types";
import { isComposing } from "./keyboard";
import { loadSkillsOff } from "../preferences/SkillPreferences";

/** Same limit as the chat window's composer. */
const MAX_INPUT = 4000;
/** Same marks as the chat window. */
const CUT_OFF_MARK = "（太长了，没说完）";
const STORAGE_FULL = "聊天记录存满了，删掉几段旧聊天再试。";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
/**
 * What a button under handed text may use: the pet's actions only. Whatever the text says,
 * it cannot change reminders, notes or what the pet remembers. Typed questions get every skill.
 */
const BUTTON_SKILLS: readonly Skill[] = [petActionSkill];
/** How long a copy keeps the chat button lit. Must match `RECENT_COPY` in `src-tauri/src/handover.rs`. */
const COPY_HINT_MS = 60_000;
/** How long the chat button stays lit after the pet said something by itself; the line can be answered for longer (`answerWindowMs`). */
const SPOKE_HINT_MS = 60_000;
/** How long copied text waits above the pet when the bar is not opened for it. */
const CARD_LINGER_MS = 30_000;

/** What the bubble above the pet shows. `fix` is where a click takes the user to sort out an error. */
export interface QuickReply {
  text: string;
  status: "thinking" | "streaming" | "done" | "error";
  fix?: "settings" | "chat";
  /** Reminders and memos the reply saved, as the AI understood them, and what it could not save. */
  saved?: EffectLine[];
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
  /** The text handed over with it, to put back if the reply fails. */
  handed: Handover | null;
  /** What the reply's tools did. */
  lines: EffectLine[];
}

export interface QuickChat {
  open: boolean;
  draft: string;
  pending: boolean;
  /** True when no DeepSeek key is saved: the bar's send button opens the key settings instead. */
  keyMissing: boolean;
  reply: QuickReply | null;
  /** Text the user copied and asked about with the chat button, or dragged onto the pet, shown above it until used or put aside. */
  handed: Handover | null;
  /** Something was copied in another app in the last minute: the chat button lights up. */
  copied: boolean;
  /** The pet said something by itself a moment ago: the chat button lights up, and the bar opens onto that line. */
  spoke: boolean;
  /** What the pet said by itself that the open bar answers, until the first line of the answer is kept. */
  answering: string | null;
  /** Whether the bubble above the pet has something to show: a reply, the handed text, or the line being answered. */
  bubble: boolean;
  name: string;
  inputRef: RefObject<HTMLInputElement | null>;
  setDraft: (text: string) => void;
  close: (release: boolean) => void;
  send: () => void;
  cancel: () => void;
  expand: () => void;
  openReply: () => void;
  /** Opens a saved reminder in the reminders panel, or a saved note in the notes panel. */
  openSaved: (item: EffectLine) => void;
  /** Puts back what the reply changed or removed. */
  undoSaved: (item: EffectLine) => void;
  /** Says so when a paste was cut at the input limit. */
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  /** Leaves the handed text out. */
  dismissHanded: () => void;
  /** One of the buttons under the handed text. */
  runAction: (action: HandoverAction) => void;
  /** The chat button: what was just copied, or else the bar. */
  launch: () => void;
  /** Opens the bar to ask about the handed text in one's own words. */
  askAbout: () => void;
  /** Something dragged onto the pet: text goes above it like copied text, a picture to the chat window. */
  receive: (dropped: Dropped) => void;
}

const reportFocus = (error: unknown) => console.warn("Could not move keyboard focus for quick chat", error);

/** Takes an unanswered line back out of its thread, so sending it again does not add it twice. */
function dropUnanswered(packId: string, request: Request): void {
  const fresh = loadThreads(packId);
  if (!fresh.valid) return;
  const thread = fresh.threads.find((item) => item.id === request.threadId);
  if (!thread || thread.messages[thread.messages.length - 1]?.role !== "user") return;
  saveThreads(packId, recordThread(fresh.threads, request.threadId, withoutLastLine(thread.messages), thread.updatedAt));
}

/** Starts a thread with what the pet said by itself, for the answer to be written in the chat window. Null when it cannot be kept. */
function threadFromLine(packId: string, line: string): string | null {
  const fresh = loadThreads(packId);
  if (!fresh.valid) return null;
  const id = newId();
  try { saveThreads(packId, recordThread(fresh.threads, id, [{ role: "assistant", content: line, unprompted: true }], Date.now())); }
  catch (error) { console.error("Could not keep the pet's line for the chat window", error); return null; }
  return id;
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
/** Where the chat button is ("none": a click on the pet opens the bar) and whether a copy lights it up. */
export interface LauncherSetup { style: ChatLauncher; copyHint: boolean }

export function useQuickChat(runtime: PetRuntime | null, packId: string, launcher: LauncherSetup): QuickChat {
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<QuickReply | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const [handed, setHanded] = useState<Handover | null>(null);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  /** What the pet last said by itself, while it can still be answered. */
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  const spokenRef = useRef(spoken);
  spokenRef.current = spoken;
  const [spokeHint, setSpokeHint] = useState(false);
  /** The line this opening of the bar answers, until a thread holds it. */
  const [answering, setAnswering] = useState<string | null>(null);
  const answeringRef = useRef(answering);
  answeringRef.current = answering;
  const launcherRef = useRef(launcher);
  launcherRef.current = launcher;
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const request = useRef<Request | null>(null);
  const replyText = useRef("");
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
    if (!openRef.current) {
      sessionThread.current = null;
      setAnswering(answerable(spokenRef.current, Date.now()));
    }
    setOpen(true);
    setFocusRequest((count) => count + 1);
    wakePet();
  };
  const close = (release: boolean) => {
    setOpen(false);
    setHanded(null);
    setAnswering(null);
    if (release) petWindow.releaseKeyboard().catch(reportFocus);
  };

  useEffect(() => {
    if (!open) return;
    petWindow.takeKeyboard().catch(reportFocus).finally(() => inputRef.current?.focus());
  }, [open, focusRequest]);

  // Say up front when there is no key, instead of letting the first message fail.
  useEffect(() => {
    if (!open) return;
    ai.keyStatus()
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
  // The dock's chat button and the chat button by the pet mean "I want to talk to you"; so does a click
  // on the pet, unless the chat button is shown and the click is only for the pet.
  useEffect(() => {
    if (!runtime) return;
    const onClicked = () => { if (launcherRef.current.style === "none") show(); };
    const stops = [runtime.bus.on("pet.clicked", onClicked), runtime.bus.on("pet.chat_requested", show)];
    return () => stops.forEach((stop) => stop());
  }, [runtime]);

  // What the pet says by itself can be answered: the chat button lights up for a minute, and for a while longer the bar opens onto that line.
  useEffect(() => runtime?.bus.on("pet.greeting", ({ text }) => {
    setSpoken({ text: text.trim(), at: Date.now() });
    setSpokeHint(true);
  }), [runtime]);
  useEffect(() => {
    if (!spoken) return;
    const timers = [setTimeout(() => setSpokeHint(false), SPOKE_HINT_MS), setTimeout(() => setSpoken(null), QUICK_CHAT_CONFIG.answerWindowMs)];
    return () => timers.forEach(clearTimeout);
  }, [spoken]);

  // A copy in another app lights up the chat button for a minute; nothing is read until it is clicked.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    handoverPlatform.onCopied(() => {
      const { style, copyHint } = launcherRef.current;
      if (style !== "none" && copyHint) setCopiedAt(Date.now());
    })
      .then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch((error: unknown) => console.warn("Cannot hear about copies here", error));
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (copiedAt === null) return;
    const timer = setTimeout(() => setCopiedAt(null), COPY_HINT_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  // Copied text left alone above the pet goes away; once the bar is open it stays with it.
  useEffect(() => {
    if (!handed || open || pending) return;
    const timer = setTimeout(() => setHanded(null), CARD_LINGER_MS);
    return () => clearTimeout(timer);
  }, [handed, open, pending]);

  // Once the bar is closed, a finished reply stays up long enough to read it.
  useEffect(() => {
    if (open || !reply || reply.status === "thinking" || reply.status === "streaming") return;
    const timer = setTimeout(() => setReply(null), replyLingerMs(reply.text));
    return () => clearTimeout(timer);
  }, [open, reply]);

  /** The thread now holds the pet's line with its answer: the next opening of the bar is a new conversation again. */
  const answered = (done: Request) => {
    const line = openingLine(done.history);
    if (line === null) return;
    setAnswering(null);
    setSpoken((now) => (now?.text === line ? null : now));
  };

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    ai.subscribe(async (event) => {
      const current = request.current;
      if (!current || event.id !== current.id) return;
      if (event.kind === "delta") { replyText.current += event.text; setReply({ text: replyText.current, status: "streaming" }); return; }
      if (event.kind === "effect") { current.lines = [...current.lines, event.line]; return; }
      if (disposed || request.current !== current) return;
      request.current = null;
      setPending(false);
      if (event.kind === "cancelled" || event.kind === "error") {
        // What the tools did is a side effect; leave its request in history on interruption.
        if (current.lines.length === 0) {
          try { dropUnanswered(packId, current); } catch (error) { console.error("Could not take the unanswered line back", error); }
          setDraft((draft) => draft || current.typed);
          if (openRef.current) setHanded((now) => now ?? current.handed);
        } else answered(current);
        setReply(event.kind === "error" ? errorReply(event.text || "回复中断") : null);
        if (event.kind === "error") runtimeRef.current?.bus.emit("pet.chat_phase", { phase: "failed" });
        return;
      }
      answered(current);
      const said = replyText.current.trim();
      if (!said) { setReply({ text: "没有收到回复，再说一次试试。", status: "error", saved: current.lines }); return; }
      const text = event.text === "length" ? `${said}\n\n${CUT_OFF_MARK}` : said;
      // The reply is shown even when it cannot be kept.
      let note: string | undefined;
      try { saveReply(packId, current, text); } catch (error) {
        console.error("Failed to save the quick chat reply", error);
        note = `这条回复没能存进聊天记录。${STORAGE_FULL}`;
      }
      setReply({ text, status: "done", saved: current.lines, note });
    })
      .then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch((error: unknown) => console.warn("Quick chat is unavailable here", error));
    return () => {
      disposed = true;
      stop?.();
      if (request.current) void ai.cancel(request.current.id).catch(() => {});
    };
  }, [packId]);

  const start = async (text: string, typed: string, skills: readonly Skill[], withHanded: Handover | null) => {
    if (!runtime) return;
    const now = Date.now();
    const loaded = loadThreads(packId);
    if (!loaded.valid) { setReply({ text: "聊天记录读不出来了，点这里到聊天窗口处理。", status: "error", fix: "chat" }); return; }
    const thread = pickQuickThread(loaded.threads, sessionThread.current);
    const threadId = thread?.id ?? newId();
    // Asking about handed text is its own conversation, not an answer to what the pet said.
    const history = quickHistory(thread, text, withHanded ? null : answeringRef.current);
    try { saveThreads(packId, recordThread(loaded.threads, threadId, history, now)); }
    catch (error) { console.error("Could not save the quick chat line", error); setReply({ text: STORAGE_FULL, status: "error", fix: "chat" }); return; }
    lastThread.current = threadId;
    sessionThread.current = threadId;
    const id = newId();
    request.current = { id, threadId, history, typed, handed: withHanded, lines: [] };
    replyText.current = "";
    setDraft("");
    setHanded(null);
    setPending(true);
    setReply({ text: "", status: "thinking" });
    const actions = runtime.chatActionIds();
    try {
      await ai.start(id, contextMessages(history), requestPreferences(packId, runtime.manifest.persona), { context: chatContext(Date.now(), actions, currentChatFacts(), openingLine(history), loadSkillsOff()), skills });
    } catch (reason) {
      if (request.current?.id !== id) return;
      const failedRequest = request.current;
      request.current = null;
      setPending(false);
      try { dropUnanswered(packId, failedRequest); } catch (error) { console.error("Could not take the unanswered line back", error); }
      setDraft((current) => current || typed);
      if (openRef.current) setHanded((now) => now ?? withHanded);
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
    void start(handed ? handedMessage(text, handed) : text, draft, CHAT_SKILLS, handed);
  };
  /** Saves the handed text as a note, without the model. Undo takes back only a note it added. */
  const keepHanded = (item: Handover) => {
    const read = readText(item.text, NOTE_LIMITS.text);
    if (!read) return;
    try {
      const known = new Set(loadNotes().map((note) => note.id));
      const saved = keepNote(read.text, "user");
      const undo = known.has(saved.id) ? undefined : () => void changeNotes((notes) => removeNote(notes, saved.id), "user");
      setHanded(null);
      setReply({
        text: read.trimmed ? `好，存进备忘了，太长只存了前 ${NOTE_LIMITS.text} 字。` : "好，存进备忘了。",
        status: "done",
        saved: [{ kind: "note", id: saved.id, text: `已存进备忘：${handoverPreview(saved.text)}`, undo }],
      });
    } catch (error) {
      console.error("Could not keep the handed text as a note", error);
      setReply({ text: "备忘没能保存，删掉几条旧的备忘再试。", status: "error" });
    }
  };
  const runAction = (action: HandoverAction) => {
    if (!handed || pending) return;
    inputRef.current?.focus();
    if (action === "keep") { keepHanded(handed); return; }
    if (keyMissing) { openKeySettings(); return; }
    wakePet();
    void start(handedMessage(ACTION_QUESTIONS[action], handed), "", BUTTON_SKILLS, handed);
  };
  const cancel = () => {
    if (request.current) void ai.cancel(request.current.id).catch((error: unknown) => console.warn("Could not stop the reply", error));
  };
  /** Opens the same conversation while the quick chat request finishes in its original window. */
  const expand = () => {
    // Nothing answered yet: the pet's line goes along, as the start of a thread in the chat window.
    const line = answeringRef.current;
    const carried = line ? threadFromLine(packId, line) : null;
    if (carried) { lastThread.current = carried; setSpoken(null); }
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
  const openSaved = (item: EffectLine) => {
    if (!item.id) { expand(); return; }
    close(false);
    setReply(null);
    const opened = item.kind === "note" ? petWindow.openNotes(item.id) : petWindow.openToday(item.id);
    opened.catch((error: unknown) => console.error("Failed to open the saved item", error));
  };
  const undoSaved = (item: EffectLine) => {
    try { item.undo?.(); }
    catch (error) { console.error("Could not undo what the reply did", error); return; }
    setReply((current) => current && { ...current, saved: current.saved?.map((line) => (line === item ? { kind: line.kind, text: "已撤销" } : line)) });
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
  const requestChat = () => runtimeRef.current?.bus.emit("pet.chat_requested", {});
  /** Reads what was copied only now, on the user's click; with nothing to read the bar opens instead. */
  const launch = () => {
    if (copiedAt === null) { requestChat(); return; }
    setCopiedAt(null);
    wakePet();
    handoverPlatform.takeCopied()
      .then((text) => { if (text) takeHanded(handover(text)); else requestChat(); })
      .catch((error: unknown) => { console.warn("Could not read what was copied", error); requestChat(); });
  };
  /** The handed text takes the bubble; a finished reply from before steps aside. */
  const takeHanded = (item: Handover) => {
    setHanded(item);
    setReply((current) => (current !== MISSING_KEY_REPLY && (current?.status === "done" || current?.status === "error") ? null : current));
  };
  const receive = (dropped: Dropped) => {
    if (pending) return;
    wakePet();
    if (dropped.kind === "text") { takeHanded(handover(dropped.text, dropped.label, dropped.name)); return; }
    if (dropped.kind === "unreadable") { setReply({ text: dropped.reason, status: "done" }); return; }
    prepareChatImage(dropped.file, newId())
      .then((image) => petWindow.openChatWithImage(image))
      .catch((error: unknown) => {
        console.warn("Could not hand the dropped picture to the chat window", error);
        setReply({ text: error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "这张图片我读不了，换一张试试。", status: "done" });
      });
  };
  const bubble = reply !== null || handed !== null || (open && answering !== null);
  const dismissHanded = () => { setHanded(null); if (openRef.current) inputRef.current?.focus(); };
  return { open, draft, pending, keyMissing, reply, handed, copied: copiedAt !== null, spoke: spoken !== null && spokeHint, answering, bubble, name: characterName(packId, ownName), inputRef, setDraft, close, send, cancel, expand, openReply, openSaved, undoSaved, onPaste, dismissHanded, runAction, launch, askAbout: requestChat, receive };
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
          placeholder={chat.keyMissing ? "填上 DeepSeek API Key 才能聊天" : chat.handed ? "问问这段内容，或点上面的按钮" : chat.answering ? `回${chat.name}一句… Esc 收起` : `和${chat.name}说点什么… Esc 收起`}
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
  if (!reply && chat.handed) return <HandedCard chat={chat} handed={chat.handed} ref={ref} />;
  // What the pet said by itself stays up, looking as it did, while the user writes an answer.
  if (!reply) return chat.answering ? <div ref={ref} className="speech-bubble"><span className="speech-bubble__spark" aria-hidden="true">✦</span>{fitSpeech(chat.answering)}</div> : null;
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
            {first.undo
              ? <button type="button" onClick={(event) => { event.stopPropagation(); chat.undoSaved(first); }}>撤销</button>
              : first.text !== "已撤销" && <button type="button" onClick={(event) => { event.stopPropagation(); chat.openSaved(first); }}>{first.kind === "note" ? "查看" : first.kind === "agenda" ? "修改" : "看详情"}</button>}
          </span>
        )}
        {more > 0 && <small className="speech-bubble__fix">还有 {more} 条，点开看全部</small>}
      </span>
    </div>
  );
}

/** Line glyphs for where handed text came from: a page for a file, quotes for copied or dragged text. */
function HandedGlyph({ file }: { file: boolean }) {
  return (
    <svg className="handed__glyph" viewBox="0 0 16 16" aria-hidden="true">
      {file
        ? <><path d="M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5.5Z" /><path d="M9.5 2v3.5H13M5.5 8.5h5M5.5 11h3" /></>
        : <path d="M3 9.5c0-2.5 1-4.2 3-5M3 9.5h2.5V12H3ZM9 9.5c0-2.5 1-4.2 3-5M9 9.5h2.5V12H9Z" />}
    </svg>
  );
}

/** Text the user copied or dragged onto the pet, in the bubble above it, with what can be done with it. */
function HandedCard({ chat, handed, ref }: { chat: QuickChat; handed: Handover; ref?: Ref<HTMLDivElement> }) {
  const title = handed.name ?? handed.label;
  const size = `${[...handed.text].length.toLocaleString("zh-CN")}${handed.trimmed ? "+" : ""} 字`;
  return (
    <div ref={ref} className="speech-bubble speech-bubble--reply speech-bubble--handed" role="group" aria-label={`${handed.label}，${size}`}>
      <span className="speech-bubble__body">
        <span className="handed__head">
          <HandedGlyph file={handed.name !== undefined} />
          <strong className="handed__title" title={title}>{title}</strong>
          <span className="handed__size">{size}</span>
          <button type="button" className="handed__close" aria-label="不用了" title="不用了" onClick={chat.dismissHanded}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
          </button>
        </span>
        <span className="handed__excerpt">{handoverPreview(handed.text)}</span>
        <span className="handed__foot">
          {suggestions(handed.text).map((action) => <button key={action} type="button" disabled={chat.pending} onClick={() => chat.runAction(action)}>{ACTION_LABELS[action]}</button>)}
          {!chat.open && <button type="button" className="handed__ask" disabled={chat.pending} onClick={chat.askAbout}>问它…</button>}
        </span>
      </span>
    </div>
  );
}
