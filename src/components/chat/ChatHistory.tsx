import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CHAT_LIMITS, type ChatThread } from "../../chat/ChatThreads";
import { isComposing } from "../keyboard";

/** "14:05" for today, "11月3日" for earlier days. */
function threadTime(updatedAt: number, now: number): string {
  const date = new Date(updatedAt);
  if (date.toDateString() === new Date(now).toDateString()) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function Icon({ name }: { name: "clear" | "rename" }) {
  const paths = {
    clear: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6m4-6v6" />,
    rename: <path d="m14.5 5.5 4 4M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z" />,
  } as const;
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

interface Props {
  threads: ChatThread[];
  currentId: string;
  /** The thread just deleted, while it can still be brought back. */
  removed: ChatThread | null;
  onOpen: (thread: ChatThread) => void;
  onDelete: (id: string) => void;
  onUndo: () => void;
  onRename: (id: string, title: string) => void;
  /** Esc: close the list and give the focus back to its button. */
  onClose: () => void;
}

/** The drop-down list of past conversations under the chat header. */
export function ChatHistory({ threads, currentId, removed, onOpen, onDelete, onUndo, onRename, onClose }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) field.current?.select(); }, [renaming]);

  const startRename = (thread: ChatThread) => { setRenaming(thread.id); setTitle(thread.title); };
  const finishRename = () => {
    if (renaming && title.trim()) onRename(renaming, title);
    setRenaming(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || isComposing(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (renaming) setRenaming(null);
    else onClose();
  };

  return <aside className="chat-history" aria-label="聊天记录" onKeyDown={onKeyDown}>
    {removed && <div className="chat-history__undo" role="status"><span>已删除“{removed.title}”</span><button type="button" onClick={onUndo}>撤销</button></div>}
    {threads.length === 0 ? <p className="chat-history__empty">还没有聊天记录</p> : <ul>{threads.map((thread) => <li key={thread.id} className={thread.id === currentId ? "is-current" : undefined}>
      {renaming === thread.id
        ? <input ref={field} className="chat-history__rename" aria-label="聊天标题" value={title} maxLength={CHAT_LIMITS.titleChars} onChange={(event) => setTitle(event.currentTarget.value)} onBlur={finishRename} onKeyDown={(event) => { if (event.key === "Enter" && !isComposing(event)) { event.preventDefault(); finishRename(); } }} />
        : <button type="button" className="chat-history__open" onClick={() => onOpen(thread)} onDoubleClick={() => startRename(thread)} title="点一下打开，双击改名"><strong>{thread.title}</strong><small>{threadTime(thread.updatedAt, Date.now())}</small></button>}
      <button type="button" className="chat-history__action" onClick={() => startRename(thread)} aria-label={`给“${thread.title}”改名`} title="改名"><Icon name="rename" /></button>
      <button type="button" className="chat-history__action chat-history__delete" onClick={() => onDelete(thread.id)} aria-label={`删除“${thread.title}”`} title="删除"><Icon name="clear" /></button>
    </li>)}</ul>}
    {threads.length >= CHAT_LIMITS.threads && <p className="chat-history__note">最多保留 {CHAT_LIMITS.threads} 段聊天，更早的会被自动删掉。</p>}
  </aside>;
}
