import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { addNote, editNote, loadNotes, NOTE_LIMITS, noteTime, pushedOut, removeNote, restoreNote, searchNotes, setNotePinned, sortNotes, subscribeNotes, type Note } from "../../notes/NoteStore";
import { changeNotes } from "../../worklog/store";
import { petWindow } from "../../platform/petWindow";
import { escapeHidesPanel, isComposing, useCloseShortcut } from "../keyboard";
import "../today/TodayPanel.css";
import "./NotesPanel.css";

/** How long "已复制" or "撤销" stays up. */
const HUD_MS = { copied: 1_600, removed: 6_000, pushed: 8_000 } as const;
/** From this many notes on, the count says how close the list is to full. */
const NEAR_FULL = NOTE_LIMITS.items - 10;

/** The search field appears once the list is long enough to need it. */
const SEARCH_FROM = 6;
/** How long a note pointed out from chat stays highlighted. */
const FLASH_MS = 1_800;
const MAX_FIELD_HEIGHT = 120;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** "pushed": the list was full, so adding `added` pushed `note` out. */
type Hud = { kind: "copied"; text: string } | { kind: "removed"; note: Note } | { kind: "pushed"; added: string; note: Note };

function Glyph({ name }: { name: "plus" | "pin" | "edit" | "close" | "search" | "note" | "copy" }) {
  const paths = {
    plus: <path d="M12 6v12M6 12h12" />,
    pin: <><path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" /><path d="M12 13v7" /></>,
    edit: <><path d="M5 19h4L19 9l-4-4L5 15v4Z" /><path d="m13.5 6.5 4 4" /></>,
    close: <path d="m8 8 8 8M16 8l-8 8" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
    note: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5M8.5 8.5h7M8.5 12h4" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>,
  } as const;
  return <svg className="today-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

/**
 * A note's text and its time. Long text is cut to three lines and gets
 * "展开"; whether it is cut is measured, since that depends on the words.
 */
function NoteBody({ note, now, expanded, onToggle, onCopy }: { note: Note; now: number; expanded: boolean; onToggle: () => void; onCopy: () => void }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const field = textRef.current;
    if (field && !expanded) setClipped(field.scrollHeight > field.clientHeight + 1);
  }, [note.text, expanded]);
  return (
    <div className="note-row__body">
      <button type="button" className="note-row__main" title="点一下复制" onClick={onCopy}>
        <span ref={textRef} className={expanded ? "note-row__text is-expanded" : "note-row__text"}>{note.text}</span>
      </button>
      <span className="note-row__meta">
        {note.pinned && <Glyph name="pin" />}{noteTime(note.updatedAt, now)}
        {(clipped || expanded) && <button type="button" className="note-row__more" aria-expanded={expanded} onClick={onToggle}>{expanded ? "收起" : "展开"}</button>}
      </span>
    </div>
  );
}

/** Grows a text area with its content, up to a few lines. */
function fitHeight(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_HEIGHT)}px`;
}

/** Return saves, Shift-Return starts a new line, Escape gives up. */
function fieldKeys(event: KeyboardEvent<HTMLTextAreaElement>, save: () => void, cancel: () => void) {
  if (isComposing(event)) return;
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); save(); }
  if (event.key === "Escape") { event.preventDefault(); cancel(); }
}

const hidePanel = () => void petWindow.hideSelf().catch((reason: unknown) => console.warn("Could not put the panel away", reason));

/** Esc keeps what was typed and only leaves the field; in an empty field it puts the panel away. */
function leaveOrHide(field: HTMLTextAreaElement | HTMLInputElement) {
  if (field.value.trim()) field.blur();
  else hidePanel();
}

/** Memos: write one line or a few, click one to copy it, pin the ones used most. */
export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>(() => sortNotes(loadNotes()));
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** Long notes the user opened up to read in full. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const addField = useRef<HTMLTextAreaElement>(null);
  const editField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("today-window");
    document.body.classList.add("today-window");
    const refresh = () => setNotes(sortNotes(loadNotes()));
    // The window is hidden, not closed: refresh whenever it is back, and get ready to type when it shows again.
    const onShown = () => { refresh(); addField.current?.focus(); };
    window.addEventListener("focus", refresh);
    const stops = [subscribeNotes(refresh), petWindow.onShown(onShown)];
    return () => {
      document.documentElement.classList.remove("today-window");
      document.body.classList.remove("today-window");
      window.removeEventListener("focus", refresh);
      for (const stop of stops) stop();
    };
  }, []);

  useCloseShortcut(hidePanel);

  // Esc from anywhere else in the panel puts it away, unless a note is open for editing.
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (escapeHidesPanel(event)) hidePanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEditing]);

  // Chat asks to show a note it just saved: clear the search so it is visible, then highlight it.
  useEffect(() => petWindow.onNoteRequested((id) => {
    setNotes(sortNotes(loadNotes()));
    setQuery("");
    setFlashId(id);
  }), []);

  useEffect(() => {
    if (!flashId) return;
    document.getElementById(`note-${flashId}`)?.scrollIntoView({ block: "nearest" });
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  useEffect(() => {
    if (!hud) return;
    const timer = setTimeout(() => setHud(null), HUD_MS[hud.kind]);
    return () => clearTimeout(timer);
  }, [hud]);

  useLayoutEffect(() => fitHeight(addField.current), [draft]);
  useLayoutEffect(() => fitHeight(editField.current), [editing]);

  const change = (update: (list: Note[]) => Note[]): boolean => {
    try {
      setNotes(sortNotes(changeNotes(update, "user")));
      setError("");
      return true;
    } catch (reason) {
      console.error("Failed to update notes", reason);
      setError(String(reason).includes("pinned") ? "备忘满了，而且都置顶了。取消几条置顶或删掉几条再试。" : "没能保存。本机存的数据太多了，删掉几条旧备忘或提醒再试。");
      return false;
    }
  };

  const add = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.trim()) return;
    const before = notes;
    const id = newId();
    if (change((list) => addNote(list, { id, text: draft }, Date.now()))) {
      setDraft("");
      // The list was full: say which note made room, and offer to take the add back.
      const pushed = pushedOut(before, loadNotes());
      if (pushed) setHud({ kind: "pushed", added: id, note: pushed });
    }
    addField.current?.focus();
  };

  const copy = async (note: Note) => {
    try {
      // Copying does not reorder the list, so the row stays under the pointer.
      await navigator.clipboard.writeText(note.text);
      setHud({ kind: "copied", text: note.text });
      setFlashId(note.id);
    } catch (reason) {
      console.error("Failed to copy a note", reason);
      setError("没能复制，请再试一次。");
    }
  };

  const saveEdit = () => {
    if (!editing) return;
    if (!editing.text.trim()) { setError("写点内容再保存，或者直接删除这条。"); return; }
    if (change((list) => editNote(list, editing.id, editing.text, Date.now()))) setEditing(null);
  };

  const remove = (note: Note) => {
    if (!change((list) => removeNote(list, note.id))) return;
    setHud({ kind: "removed", note });
    if (editing?.id === note.id) setEditing(null);
  };

  const undo = () => {
    if (hud?.kind === "removed" && change((list) => restoreNote(list, hud.note))) setHud(null);
    if (hud?.kind === "pushed" && change((list) => restoreNote(removeNote(list, hud.added), hud.note))) setHud(null);
  };
  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const shown = searchNotes(notes, query);
  const pinned = shown.filter((note) => note.pinned);
  const recent = shown.filter((note) => !note.pinned);
  const now = Date.now();

  const row = (note: Note) => {
    if (editing?.id === note.id) {
      return (
        <li key={note.id} id={`note-${note.id}`} className="today-row note-row is-editing">
          <textarea ref={editField} className="today-field note-field" autoFocus rows={1} value={editing.text} maxLength={NOTE_LIMITS.text} aria-label="备忘内容"
            onChange={(event) => setEditing({ ...editing, text: event.currentTarget.value })}
            onKeyDown={(event) => fieldKeys(event, saveEdit, () => { setEditing(null); setError(""); })} />
          <div className="today-edit__actions">
            <button type="button" className="today-button today-button--danger" onClick={() => remove(note)}>删除</button>
            <span className="today-edit__spacer" />
            <button type="button" className="today-button" onClick={() => { setEditing(null); setError(""); }}>取消</button>
            <button type="button" className="today-button today-button--primary" onClick={saveEdit}>保存</button>
          </div>
        </li>
      );
    }
    return (
      <li key={note.id} id={`note-${note.id}`} className={flashId === note.id ? "today-row note-row is-flashing" : "today-row note-row"}>
        <NoteBody note={note} now={now} expanded={expanded.has(note.id)} onToggle={() => toggleExpanded(note.id)} onCopy={() => void copy(note)} />
        <span className="note-row__tools">
          <button type="button" className={note.pinned ? "note-tool is-on" : "note-tool"} aria-pressed={note.pinned} aria-label={note.pinned ? "取消置顶" : "置顶"} title={note.pinned ? "取消置顶" : "置顶"} onClick={() => change((list) => setNotePinned(list, note.id, !note.pinned))}><Glyph name="pin" /></button>
          <button type="button" className="note-tool" aria-label="编辑" title="编辑" onClick={() => { setEditing({ id: note.id, text: note.text }); setError(""); }}><Glyph name="edit" /></button>
          <button type="button" className="note-tool note-tool--danger" aria-label="删除" title="删除" onClick={() => remove(note)}><Glyph name="close" /></button>
        </span>
      </li>
    );
  };

  return (
    <main className="today-panel notes-panel ui-on-material">
      <header className="today-header" data-tauri-drag-region>
        <div className="today-header__titles" data-tauri-drag-region>
          <h1 data-tauri-drag-region>备忘</h1>
          <p data-tauri-drag-region>点一条就能复制</p>
        </div>
        <span className="today-count" title={notes.length >= NEAR_FULL ? `备忘最多 ${NOTE_LIMITS.items} 条，满了会挤掉最久没改的一条` : undefined}>
          <span aria-hidden="true">{notes.length >= NEAR_FULL ? `${notes.length}/${NOTE_LIMITS.items}` : notes.length}<small>条</small></span>
          <span className="visually-hidden">共 {notes.length} 条{notes.length >= NEAR_FULL ? `，最多 ${NOTE_LIMITS.items} 条` : ""}</span>
        </span>
      </header>

      <form className="today-add" onSubmit={add}>
        <label className="today-add__field note-add">
          <Glyph name="plus" />
          <textarea ref={addField} rows={1} value={draft} maxLength={NOTE_LIMITS.text} placeholder="记点什么，回车保存" aria-label="新备忘"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => fieldKeys(event, () => add(), () => leaveOrHide(event.currentTarget))} />
          {draft.trim() && <button type="submit" className="today-button today-button--primary today-add__save" title="保存（回车；Shift+回车换行）">保存</button>}
        </label>
        {notes.length >= SEARCH_FROM && (
          <label className="note-search">
            <Glyph name="search" />
            <input type="search" value={query} placeholder="搜索" aria-label="搜索备忘" onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key !== "Escape" || isComposing(event)) return; event.preventDefault(); if (query) setQuery(""); else hidePanel(); }} />
          </label>
        )}
      </form>
      {error && <p className="today-error" role="alert">{error}</p>}

      <section className="today-list" aria-label="备忘">
        {notes.length === 0 ? (
          <div className="today-empty">
            <Glyph name="note" />
            <strong>还没有备忘</strong>
            <p>没有时间的事、常用的地址和账号都可以存在这里，点一下就能复制。也可以跟宠物说“帮我记一下……”。</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="today-all-done">没有包含“{query.trim()}”的备忘。</p>
        ) : (
          <>
            {pinned.length > 0 && <><h2 className="today-section">置顶</h2><ul>{pinned.map(row)}</ul></>}
            {recent.length > 0 && <>{pinned.length > 0 && <h2 className="today-section">最近</h2>}<ul>{recent.map(row)}</ul></>}
          </>
        )}
      </section>

      {hud?.kind === "copied" && (
        <div className="today-hud" role="status">
          <Glyph name="copy" />
          <span>已复制“{hud.text.replace(/\s+/g, " ")}”</span>
        </div>
      )}
      {hud?.kind === "removed" && (
        <div className="today-hud" role="status">
          <span>已删除“{hud.note.text.replace(/\s+/g, " ")}”</span>
          <button type="button" onClick={undo}>撤销</button>
        </div>
      )}
      {hud?.kind === "pushed" && (
        <div className="today-hud" role="status">
          <span>备忘满了，移除了最旧的一条“{hud.note.text.replace(/\s+/g, " ")}”</span>
          <button type="button" onClick={undo}>撤销</button>
        </div>
      )}
    </main>
  );
}
