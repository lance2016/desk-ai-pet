import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { chatContext } from "../../agenda/chatTools";
import { chatStatus, type ChatFailure } from "../../chat/chatStatus";
import { classifyServiceError, isKeyProblem, serviceErrorMessage } from "../../chat/serviceErrors";
import type { PetPersona } from "../../assets/Manifest";
import { applyToolCalls, saveNote, type SavedLine } from "../../chat/toolEffects";
import { markdownToPlain } from "../../chat/markdown";
import { NOTE_LIMITS } from "../../notes/NoteStore";
import { ControlIcon } from "../ControlIcon";
import { CHAT_LIMITS, clearThreads, contextMessages, loadAutoTitles, loadThreads, recordThread, removeThread, restoreThread, retitleThread, saveThreads, touchesThreads, type ChatThread } from "../../chat/ChatThreads";
import { actionImages, loadCharacterPack } from "../../assets/PackCatalog";
import { chatPlatform, type ChatMessage } from "../../platform/chat";
import { mimoPlatform } from "../../platform/mimo";
import { systemPlatform } from "../../platform/system";
import { loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterName, requestPreferences } from "../../preferences/ChatPreferences";
import { CharacterAvatar } from "../CharacterAvatar";
import { ConfirmButton } from "../ConfirmButton";
import { isComposing } from "../keyboard";
import { PeekPicture } from "../PeekPicture";
import { ChatHistory } from "./ChatHistory";
import { ChatMarkdown } from "./ChatMarkdown";
import { MAX_RECORD_SECONDS, useVoiceInput, type VoiceProblem } from "./useVoiceInput";
import { canShortcut } from "../../preferences/ActionPreferences";
import { loadVoiceLanguage } from "../../preferences/VoicePreferences";
import { petWindow } from "../../platform/petWindow";
import type { ChatPhase } from "../../types";
import "./ChatPage.css";

const MAX_INPUT = 4000;
/** While typing, the pet is told at most this often; it listens on for longer than that after each report. */
const TYPING_REPORT_MS = 2_000;

/** Tells the pet where this window's conversation stands. The pet poses along, and nothing here depends on it. */
function reportChatPhase(phase: ChatPhase): void {
  petWindow.reportChatPhase(phase).catch((error: unknown) => console.warn("Could not tell the pet about the chat", error));
}
/** From this many characters on, the composer shows how many are left. */
const SHOW_COUNT_FROM = MAX_INPUT - 500;
/** The composer grows with its text up to this height, then scrolls. */
const MAX_COMPOSER_HEIGHT = 120;
/** How close to the bottom still counts as reading the latest message. */
const STICK_TO_BOTTOM_PX = 24;
/** How long a deleted chat can be brought back, and how long "已复制" shows. */
const UNDO_MS = 6_000;
const COPIED_MS = 1_500;
/** Added to a reply the token limit cut off, and to one the user stopped. */
const CUT_OFF_MARK = "（太长了，没说完）";
const STOPPED_MARK = "（已停止）";
const STORAGE_FULL = "聊天记录存满了，删掉几段旧聊天再试。";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const sameMessages = (a: readonly ChatMessage[], b: readonly ChatMessage[]) => a.length === b.length && a.every((message, index) => message.role === b[index].role && message.content === b[index].content);

function Icon({ name }: { name: "mic" | "stop" | "send" | "new" | "history" | "settings" | "close" | "copy" }) {
  const paths = {
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
    new: <path d="M12 5v14M5 12h14" />,
    history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    copy: <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  } as const;
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

/** Chat with one character. The window remounts this component when the character changes. */
export function ChatPage({ packId }: { packId: string }) {
  const [initial] = useState(() => loadThreads(packId));
  /** Shown until the character loads; then the name the user gave it, or its own. */
  const [name, setName] = useState("宠物");
  const ownName = useRef<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [look, setLook] = useState(() => loadChatAppearance(packId));
  const [personaReady, setPersonaReady] = useState(false);
  const personaRef = useRef<PetPersona | undefined>(undefined);
  /** Actions the model may ask the pet to play. */
  const actionIdsRef = useRef<string[]>([]);
  const toolCallsRef = useRef<string[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>(initial.threads);
  const [threadId, setThreadId] = useState(() => initial.threads[0]?.id ?? newId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => initial.threads[0]?.messages ?? []);
  /** The messages last loaded or saved, so opening a thread does not count as new activity. */
  const savedMessages = useRef(messages);
  /** Current state for callbacks that outlive a render, such as the reply stream and title requests. */
  const latest = useRef({ threads, threadId, messages });
  latest.current = { threads, threadId, messages };
  const [historyValid, setHistoryValid] = useState(initial.valid);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The chat just deleted, while it can still be brought back. */
  const [removedThread, setRemovedThread] = useState<ChatThread | null>(null);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  /** Whether the DeepSeek key is missing; null until checked. Missing shows a way to set one up. */
  const [keyMissing, setKeyMissing] = useState<boolean | null>(null);
  /** Same for the MiMo key: without it the microphone leads to settings instead of recording. */
  const [voiceMissing, setVoiceMissing] = useState<boolean | null>(null);
  /** The last failure, for the status line; cleared on the next attempt. */
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  /** Where the user fixes the error on show: a settings section, or the system's microphone permission. */
  const [errorFix, setErrorFix] = useState<"ai" | "voice" | "microphone" | null>(null);
  /** What the last reply saved, as the AI understood it with a way to correct it, and what it could not save. */
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
  /** Replies the user saved as notes in this window, by text, with the note they became. */
  const [notedMessages, setNotedMessages] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState(initial.valid ? "" : "无法读取原有聊天记录。为避免覆盖数据，暂时无法发送；你可以选择清空后继续。");
  /** A neutral line, such as a stopped reply or a cut paste; not an error. */
  const [notice, setNotice] = useState("");
  /** The finished reply, read out once by screen readers instead of every streamed piece. */
  const [announcement, setAnnouncement] = useState("");
  const active = useRef<string | null>(null);
  const replyRef = useRef("");
  const cancelRequested = useRef(false);
  /** Whether the user is reading the latest message; only then do new pieces pull the list down. */
  const stickToBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);

  /** Tells a missing or bad key apart from a network or account problem. */
  const reportServiceError = (service: "DeepSeek" | "MiMo", detail: string) => {
    const kind = classifyServiceError(detail);
    const voice = service === "MiMo";
    console.warn(`${service} request failed`, detail);
    if (kind === "missing-key") { if (voice) setVoiceMissing(true); else { setKeyMissing(true); return; } }
    else setFailure(voice ? "voice" : kind);
    setErrorFix(isKeyProblem(kind) ? (voice ? "voice" : "ai") : null);
    setError(kind === "other" && voice ? "语音识别失败，可以再识别一次，或者稍后再试。" : serviceErrorMessage(service, kind));
  };
  const startAttempt = () => { setError(""); setNotice(""); setFailure(null); setErrorFix(null); };
  const reportVoiceProblem = (problem: VoiceProblem) => {
    if (problem.kind === "service") { reportServiceError("MiMo", problem.detail); return; }
    setFailure("voice");
    setErrorFix(problem.kind === "denied" ? "microphone" : null);
    setError(problem.message);
  };
  const voice = useVoiceInput({
    language: () => loadVoiceLanguage(packId),
    onAttempt: startAttempt,
    onText: (recognized) => { setDraft((current) => current.trim() ? `${current.trim()} ${recognized}` : recognized); input.current?.focus(); },
    onProblem: reportVoiceProblem,
  });
  const recording = voice.phase === "recording";
  const transcribing = voice.phase === "transcribing";

  // The pet listens while the user speaks or types, thinks until the reply starts, and talks along with it.
  const chatPhase: ChatPhase = recording ? "listening" : transcribing || (pending && !reply) ? "thinking" : pending ? "talking" : "idle";
  const typingReportedAt = useRef(0);
  // `voice.seconds` ticks while recording, which keeps "listening" alive for a long recording.
  useEffect(() => reportChatPhase(chatPhase), [chatPhase, voice.seconds]);
  useEffect(() => {
    if (!draft || chatPhase !== "idle" || Date.now() - typingReportedAt.current < TYPING_REPORT_MS) return;
    typingReportedAt.current = Date.now();
    reportChatPhase("listening");
  }, [draft, chatPhase]);
  useEffect(() => { if (failure) reportChatPhase("failed"); }, [failure]);

  useEffect(() => { document.documentElement.classList.add("chat-window"); document.body.classList.add("chat-window"); return () => { document.documentElement.classList.remove("chat-window"); document.body.classList.remove("chat-window"); }; }, []);
  useEffect(() => {
    let active = true;
    loadCharacterPack(packId)
      .then((pack) => {
        if (!active) return;
        personaRef.current = pack.manifest.persona;
        actionIdsRef.current = pack.manifest.animations.filter(canShortcut).map((action) => action.id);
        setImages(actionImages(pack));
        ownName.current = pack.manifest.persona?.name ?? pack.manifest.name;
        setName(characterName(packId, ownName.current));
      })
      .catch((reason: unknown) => console.warn("Failed to load the character persona; using defaults", reason))
      .finally(() => { if (active) setPersonaReady(true); });
    return () => { active = false; };
  }, [packId]);
  useEffect(() => {
    if (!historyValid || messages === savedMessages.current) return;
    savedMessages.current = messages;
    const next = recordThread(threads, threadId, messages, Date.now());
    setThreads(next);
    try { saveThreads(packId, next); } catch (reason) { console.error("Could not save the chat", reason); setError(STORAGE_FULL); }
  }, [messages, threads, threadId, historyValid, packId]);
  // Follow new pieces only while the user reads the bottom, past the padding that keeps the last bubble clear of the peeking character.
  useEffect(() => { const scroller = list.current; if (scroller && stickToBottom.current) scroller.scrollTop = scroller.scrollHeight; }, [messages, reply, pending, error, notice, savedLines]);
  useEffect(() => {
    const field = input.current;
    const scroller = list.current;
    if (!field || !scroller) return;
    // A taller composer shrinks the list; keep the latest message in view if the user was reading it.
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    if (stickToBottom.current) scroller.scrollTop = scroller.scrollHeight;
  }, [draft]);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    chatPlatform.subscribe((event) => {
      if (event.id !== active.current) return;
      if (event.kind === "delta") { replyRef.current += event.text; setReply(replyRef.current); return; }
      if (event.kind === "tool") { toolCallsRef.current.push(event.text); return; }
      active.current = null; setPending(false);
      const toolCalls = toolCallsRef.current;
      toolCallsRef.current = [];
      if (event.kind === "done") {
        try { const saved = applyToolCalls(toolCalls); setSavedLines(saved.lines); if (!replyRef.current) replyRef.current = saved.confirmation; }
        catch (reason) { console.error("Failed to save the reminder or note", reason); setError("提醒或备忘没能保存，删掉几条旧的提醒或备忘再试。"); }
      }
      // A reply the user stopped is kept as far as it got; one that failed is dropped.
      const partial = event.kind === "cancelled" && replyRef.current.trim() ? `${replyRef.current.trimEnd()}\n\n${STOPPED_MARK}` : "";
      const completed = event.kind === "done" && replyRef.current ? `${replyRef.current}${event.text === "length" ? `\n\n${CUT_OFF_MARK}` : ""}` : partial;
      if (completed) {
        const { threadId: id, messages: before } = latest.current;
        const firstUser = before.find((message) => message.role === "user")?.content;
        if (event.kind === "done" && firstUser && !before.some((message) => message.role === "assistant") && loadAutoTitles()) void nameThread(id, firstUser, completed);
        setMessages((current) => [...current, { role: "assistant" as const, content: completed }].slice(-CHAT_LIMITS.messages));
        setAnnouncement(markdownToPlain(completed));
      } else if (event.kind === "done") setError("没有收到回复，请重试。");
      else if (event.kind === "error") reportServiceError("DeepSeek", event.text || "回复中断");
      else if (event.kind === "cancelled") setNotice("已停止回复。");
      setReply("");
      replyRef.current = "";
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else { stop = unsubscribe; setReady(true); } }).catch((reason: unknown) => { console.error("Chat is unavailable", reason); setError("聊天功能需要在 AI Pet 应用里使用。"); });
    return () => { disposed = true; stop?.(); if (active.current) void chatPlatform.cancel(active.current).catch(() => {}); };
  }, []);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    chatPlatform.onHidden(() => {
      voice.cancel();
      if (!active.current) return;
      cancelRequested.current = true;
      void chatPlatform.cancel(active.current).catch((reason: unknown) => console.warn("Could not stop the reply", reason));
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; }).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, []);
  // Check for a saved key now and whenever the window comes back, e.g. after setting one up in settings.
  // Coming back with nothing focused, the user wants to type: put the cursor in the composer.
  useEffect(() => {
    const check = () => {
      chatPlatform.keyStatus().then((saved) => setKeyMissing(!saved)).catch(() => setKeyMissing(false));
      mimoPlatform.keyStatus().then((saved) => setVoiceMissing(!saved)).catch(() => setVoiceMissing(null));
    };
    const onFocus = () => {
      check();
      if (document.activeElement === document.body || document.activeElement === null) input.current?.focus();
    };
    check();
    input.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (personaReady) void petWindow.setTitle(`和${name}聊天`).catch((reason: unknown) => console.warn("Could not set the chat window title", reason));
  }, [name, personaReady]);
  // Settings is another window; follow a rename or a new picture made there.
  useEffect(() => {
    const refresh = () => { if (ownName.current) setName(characterName(packId, ownName.current)); setLook(loadChatAppearance(packId)); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [packId]);
  // The quick chat bar in the pet window writes threads too; follow it unless a reply is on its way here.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (active.current || !touchesThreads(packId, event.key)) return;
      const fresh = loadThreads(packId);
      if (!fresh.valid) return;
      setThreads(fresh.threads);
      const current = fresh.threads.find((thread) => thread.id === latest.current.threadId);
      if (current && !sameMessages(current.messages, latest.current.messages)) { savedMessages.current = current.messages; setMessages(current.messages); }
    };
    const openRequested = (id: string, resume: boolean) => {
      if (active.current) return;
      const fresh = loadThreads(packId);
      if (!fresh.valid) return;
      setThreads(fresh.threads);
      const thread = fresh.threads.find((item) => item.id === id);
      if (!thread) return;
      showThread(thread.id, thread.messages);
      // The quick chat bar handed over a message it was still answering.
      if (resume && thread.messages[thread.messages.length - 1]?.role === "user") void startReplyRef.current(thread.messages);
    };
    window.addEventListener("storage", sync);
    const stops = [petWindow.onChatThreadRequested((id) => openRequested(id, false)), petWindow.onChatResumeRequested((id) => openRequested(id, true))];
    return () => { window.removeEventListener("storage", sync); stops.forEach((stop) => stop()); };
  }, [packId]);
  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setHistoryOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [historyOpen]);
  useEffect(() => {
    if (!removedThread) return;
    const timer = setTimeout(() => setRemovedThread(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removedThread]);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const startReply = async (next: ChatMessage[], typed = "") => {
    if (pending || !ready || !personaReady || !historyValid) return;
    const before = latest.current.messages;
    const id = newId();
    stickToBottom.current = true;
    active.current = id; cancelRequested.current = false; replyRef.current = ""; toolCallsRef.current = []; setReply(""); setMessages(next); setDraft(""); startAttempt(); setSavedLines([]); setPending(true);
    try {
      await chatPlatform.start(id, contextMessages(next), requestPreferences(packId, personaRef.current), chatContext(Date.now(), actionIdsRef.current));
      if (cancelRequested.current && active.current === id) await chatPlatform.cancel(id);
    } catch (reason) {
      if (active.current !== id) return;
      active.current = null; setPending(false);
      // Another reply in this window is still running: give the message back instead of leaving it unanswered.
      if (classifyServiceError(String(reason)) === "running") { setMessages(before); if (typed) setDraft(typed); }
      reportServiceError("DeepSeek", String(reason));
    }
  };
  const startReplyRef = useRef(startReply);
  startReplyRef.current = startReply;
  const send = (event: FormEvent) => {
    event.preventDefault(); const text = draft.trim(); if (!text || pending || recording || !ready || !historyValid || keyMissing) return;
    void startReply([...messages, { role: "user" as const, content: text }].slice(-CHAT_LIMITS.messages), draft);
    // A click on the button would leave the focus there, where Space would stop the reply.
    input.current?.focus();
  };
  const cancel = () => { if (active.current) { cancelRequested.current = true; void chatPlatform.cancel(active.current).catch((reason: unknown) => { console.warn("Could not stop the reply", reason); setError("没能停止回复，请稍等它说完。"); }); } };
  /** Asks the model for a short title after a thread's first reply; the first message stays the title if that fails. */
  async function nameThread(id: string, user: string, reply: string) {
    try {
      const title = await chatPlatform.title(user, reply);
      const next = retitleThread(latest.current.threads, id, title);
      setThreads(next);
      saveThreads(packId, next);
    } catch (reason) { console.warn("Could not name the chat", reason); }
  }
  const showThread = (id: string, shown: ChatMessage[]) => {
    if (active.current) return;
    savedMessages.current = shown;
    stickToBottom.current = true;
    setThreadId(id); setMessages(shown); setError(""); setNotice(""); setReply(""); setSavedLines([]); setNotedMessages({}); setHistoryOpen(false);
    input.current?.focus();
  };
  const newChat = () => { if (!pending) showThread(newId(), []); };
  const deleteThread = (id: string) => {
    if (pending) return;
    const next = removeThread(threads, id);
    try { saveThreads(packId, next); setThreads(next); }
    catch (reason) { console.error("Could not delete the chat", reason); setError("没能删除这段聊天，请再试一次。"); return; }
    setRemovedThread(threads.find((thread) => thread.id === id) ?? null);
    // Keep the list open so the undo bar stays in sight.
    if (id === threadId) { showThread(newId(), []); setHistoryOpen(true); }
  };
  const undoDelete = () => {
    if (!removedThread) return;
    const next = restoreThread(latest.current.threads, removedThread);
    setRemovedThread(null);
    try { saveThreads(packId, next); setThreads(next); }
    catch (reason) { console.error("Could not restore the chat", reason); setError(STORAGE_FULL); }
  };
  const renameThread = (id: string, title: string) => {
    const next = retitleThread(threads, id, title);
    try { saveThreads(packId, next); setThreads(next); }
    catch (reason) { console.error("Could not rename the chat", reason); setError(STORAGE_FULL); }
  };
  const closeHistory = () => { setHistoryOpen(false); historyButton.current?.focus(); };
  const resetHistory = () => {
    try { clearThreads(packId); setThreads([]); setHistoryValid(true); showThread(newId(), []); }
    catch (reason) { console.error("Could not clear the chats", reason); setError("没能清除聊天记录，请再试一次。"); }
  };
  const status = chatStatus({ keyMissing, pending, recording, transcribing, failure });
  const openSettings = (section: "ai" | "voice") => void petWindow.openSettings(section).catch((reason: unknown) => { console.error("Could not open settings", reason); setError("没能打开设置，请从宠物的右键菜单打开。"); });
  const toggleRecording = () => {
    // Without a MiMo key, recording would only fail afterwards: go to the setup instead.
    if (voiceMissing && voice.phase === "idle") { openSettings("voice"); return; }
    voice.toggle();
  };
  const fixError = () => {
    if (errorFix === "microphone") void systemPlatform.openMicrophoneSettings().catch((reason: unknown) => console.error("Could not open microphone settings", reason));
    else if (errorFix) openSettings(errorFix);
  };
  // Nothing until the character loads, so the default picture does not flash before a custom one.
  const avatar = personaReady ? pictureFor(look.avatar, images) : null;
  const peek = personaReady ? pictureFor(look.peek, images) : null;
  const openNote = (id: string) => void petWindow.openNotes(id).catch((reason: unknown) => { console.error("Could not open notes", reason); setError("没能打开备忘，请从宠物的快捷按钮打开。"); });
  const openReminder = (id: string) => void petWindow.openToday(id).catch((reason: unknown) => { console.error("Could not open reminders", reason); setError("没能打开提醒，请从宠物的快捷按钮打开。"); });
  const noteMessage = (content: string) => {
    const saved = notedMessages[content];
    if (saved) { openNote(saved); return; }
    try {
      const note = saveNote(markdownToPlain(content));
      setNotedMessages((current) => ({ ...current, [content]: note.id }));
    } catch (reason) {
      console.error("Failed to save the message as a note", reason);
      setError("备忘没能保存，删掉几条旧备忘再试。");
    }
  };
  const copyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(markdownToPlain(content))
      .then(() => setCopied(index))
      .catch((reason: unknown) => { console.error("Could not copy the reply", reason); setError("没能复制，请选中文字后按 ⌘C。"); });
  };
  /** Finished replies (those with a key) can be copied or kept as a note. */
  const replyActions = (content: string, index: number) => {
    const saved = notedMessages[content] !== undefined;
    const tooLong = markdownToPlain(content).length > NOTE_LIMITS.text;
    const label = saved ? "已存进备忘，点一下查看" : tooLong ? `超过 ${NOTE_LIMITS.text} 字，不能存进备忘` : "存进备忘";
    const copyLabel = copied === index ? "已复制" : "复制";
    return <div className="chat-row__actions">
      <button type="button" className={copied === index ? "chat-row__action is-saved" : "chat-row__action"} onClick={() => copyMessage(content, index)} aria-label={copyLabel} title={copyLabel}><Icon name="copy" /></button>
      <button type="button" className={saved ? "chat-row__action is-saved" : "chat-row__action"} disabled={tooLong} onClick={() => noteMessage(content)} aria-label={label} title={label}><ControlIcon name={saved ? "checklist" : "note"} /></button>
    </div>;
  };
  const assistantRow = (content: string, key?: number) => <div key={key} className="chat-row chat-row--assistant"><CharacterAvatar picture={avatar} className="chat-portrait" /><div className="chat-bubble chat-bubble--assistant"><ChatMarkdown text={content} /></div>{key !== undefined && replyActions(content, key)}</div>;
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const pasted = event.clipboardData.getData("text").length;
    if (draft.length - (field.selectionEnd - field.selectionStart) + pasted > MAX_INPUT) setNotice(`内容太长，只保留了前 ${MAX_INPUT} 字。`);
  };
  const lastIsUser = messages[messages.length - 1]?.role === "user";
  const canRetry = historyValid && lastIsUser && !pending && keyMissing === false;
  const micLabel = recording ? "停止录音并识别" : transcribing ? "取消识别" : voiceMissing ? "语音输入未配置，去设置" : `语音输入（最长 ${MAX_RECORD_SECONDS / 60} 分钟）`;

  return <main className="chat-page">
    <header ref={header} className="chat-header">
      <CharacterAvatar picture={avatar} className="chat-portrait chat-portrait--header" />
      <div className="chat-header__title"><strong>{name}</strong><span className={`chat-status is-${status.tone}`}>{status.label}</span></div>
      <button type="button" className="chat-icon-button" disabled={pending || messages.length === 0} onClick={newChat} aria-label="新聊天" title="新聊天"><Icon name="new" /></button>
      <button ref={historyButton} type="button" className={historyOpen ? "chat-icon-button is-active" : "chat-icon-button"} disabled={pending} onClick={() => setHistoryOpen((open) => !open)} aria-label="聊天记录" aria-expanded={historyOpen} title="聊天记录"><Icon name="history" /></button>
      <button type="button" className="chat-icon-button" onClick={() => void petWindow.openSettings().catch((reason: unknown) => console.error("Could not open settings", reason))} aria-label="设置" title="设置"><Icon name="settings" /></button>
      {historyOpen && <ChatHistory threads={threads} currentId={threadId} removed={removedThread} onOpen={(thread) => showThread(thread.id, thread.messages)} onDelete={deleteThread} onUndo={undoDelete} onRename={renameThread} onClose={closeHistory} />}
    </header>
    <section ref={list} className="chat-messages" onScroll={(event) => { const scroller = event.currentTarget; stickToBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_TO_BOTTOM_PX; }}>
      {keyMissing && <div className="chat-setup" role="status"><strong>还差一步</strong><p>在设置里填上 DeepSeek API Key，{name}就能陪你聊天了。</p><button type="button" onClick={() => openSettings("ai")}>去设置</button></div>}
      {messages.length === 0 && !keyMissing && <div className="chat-empty"><strong>今天想聊点什么？</strong><p>说说你的心情，或者让{name}帮你记件事。</p></div>}
      {messages.map((message, index) => message.role === "assistant" ? assistantRow(message.content, index) : <div key={index} className="chat-row chat-row--user"><div className="chat-bubble chat-bubble--user">{message.content}</div></div>)}
      {(pending || reply) && assistantRow(reply || "正在想…")}
      {savedLines.length > 0 && !pending && <div className="chat-saved">{savedLines.map((line, index) => <div key={line.id ?? `failed-${index}`} className={line.kind === "failed" ? "chat-saved__item is-failed" : "chat-saved__item"}>
        <span className={line.kind === "note" ? "chat-saved__note" : undefined}>{line.text}</span>
        {line.kind === "agenda" && line.id && <button type="button" onClick={() => openReminder(line.id as string)}>修改</button>}
        {line.kind === "note" && line.id && <button type="button" onClick={() => openNote(line.id as string)}>查看</button>}
      </div>)}</div>}
      {notice && !error && <div className="chat-notice" role="status">{notice}</div>}
      {error && <div className="chat-error" role="alert">{error}
        {errorFix && <button type="button" onClick={fixError}>{errorFix === "microphone" ? "打开系统设置" : "去设置"}</button>}
        {voice.retryAudio && <button type="button" onClick={voice.retry}>再识别一次</button>}
        {!historyValid && <ConfirmButton confirmLabel="再点一次清空" onConfirm={resetHistory}>清空聊天记录</ConfirmButton>}
        {canRetry && <button type="button" onClick={() => void startReply(messages)}>重新回复</button>}
      </div>}
      {!error && canRetry && <div className="chat-notice"><button type="button" onClick={() => void startReply(messages)}>重新回复</button></div>}
    </section>
    <div className="visually-hidden" aria-live="polite">{announcement}</div>
    <form className="chat-composer" onSubmit={(event) => void send(event)}>
      {peek && <PeekPicture picture={peek} className="chat-peek" />}
      <div className={recording ? "chat-input is-recording" : "chat-input"}>
        <textarea ref={input} rows={1} aria-label="聊天内容" placeholder={recording ? `正在听你说… ${clock(voice.seconds)}，再点麦克风结束` : transcribing ? "正在识别语音…" : keyMissing ? "先在设置里填上 DeepSeek API Key 才能聊天" : `和${name}说点什么…`} value={draft} maxLength={MAX_INPUT} onPaste={onPaste} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !isComposing(event)) { event.preventDefault(); if (!recording) event.currentTarget.form?.requestSubmit(); } }} />
        {draft.length >= SHOW_COUNT_FROM && <span className="chat-count">{draft.length}/{MAX_INPUT}</span>}
        {recording && <button type="button" className="chat-mic chat-mic--cancel" onClick={voice.cancel} aria-label="取消录音" title="取消录音，不识别"><Icon name="close" /></button>}
        <button type="button" className={voiceMissing ? "chat-mic is-unconfigured" : "chat-mic"} disabled={voice.phase === "starting" || (pending && !recording)} onClick={transcribing ? voice.cancelTranscription : toggleRecording} aria-label={micLabel} title={micLabel}>
          {transcribing ? <span className="chat-spinner" /> : <Icon name={recording ? "stop" : "mic"} />}
        </button>
      </div>
      {pending
        ? <button className="chat-send" type="button" onClick={cancel} aria-label="停止回复" title="停止回复"><Icon name="stop" /></button>
        : <button className="chat-send" type="submit" disabled={!draft.trim() || recording || !ready || !personaReady || !historyValid || keyMissing === true} aria-label="发送" title="发送（Enter）"><Icon name="send" /></button>}
    </form>
  </main>;
}
