import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { addAgendaItem, AGENDA_LIMITS, archiveStale, editAgendaItem, fromTimeInput, isDone, loadAgenda, reminderLabel, removeAgendaItem, restoreAgendaItem, setAgendaItemDone, shownAt, sortAgenda, subscribeAgenda, toTimeInput, updateAgenda, type AgendaItem } from "../../agenda/AgendaStore";
import { changeReminders } from "../../worklog/store";
import { EVERY_DAY, repeatLabel, repeatSchema, type Repeat } from "../../agenda/Repeat";
import { holidayCalendar, lastCoveredYear } from "../../agenda/Workdays";
import { petWindow } from "../../platform/petWindow";
import { escapeHidesPanel, isComposing } from "../keyboard";
import { TimeField } from "../TimeField";
import { loadQuietPreferences, subscribeQuietPreferences } from "../../preferences/QuietPreferences";
import "./TodayPanel.css";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** How long "撤销" stays up after an item is deleted. */
const UNDO_MS = 6_000;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function todayTitle(now: number): string {
  const date = new Date(now);
  return `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]}`;
}

/** The next whole hour: the time a new reminder starts with. */
function nextHour(now: number): number {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next.getTime();
}

/** "2026-11-17" for `offset` days from today. */
function dayKey(now: number, offset: number): string {
  const day = new Date(now);
  day.setDate(day.getDate() + offset);
  return toTimeInput(day.getTime()).slice(0, 10);
}

/**
 * A reminder being written or edited. `time` is a datetime-local value; null
 * only while nothing is typed yet. When it repeats, only the time of day counts.
 */
interface Draft {
  text: string;
  time: string | null;
  repeat: Repeat | null;
}

const EMPTY_DRAFT: Draft = { text: "", time: null, repeat: null };

/** A one-off time already gone today moves to the same time tomorrow; anything else stays. */
function upcoming(draft: Draft, now: number): { draft: Draft; moved: boolean } {
  if (draft.repeat !== null || draft.time === null) return { draft, moved: false };
  const at = fromTimeInput(draft.time);
  if (at === null || at > now || draft.time.slice(0, 10) !== dayKey(now, 0)) return { draft, moved: false };
  return { draft: { ...draft, time: `${dayKey(now, 1)}T${draft.time.slice(11)}` }, moved: true };
}

/** Reads a draft into an item's text, time and rule, or explains what is wrong with it. */
function readDraft(draft: Draft): { text: string; remindAt: number; repeat: Repeat | null } | string {
  const text = draft.text.trim();
  if (!text) return "写点内容再保存。";
  const remindAt = draft.time === null ? null : fromTimeInput(draft.time);
  return remindAt === null ? "选一个完整的提醒时间。不需要提醒的内容可以存进备忘。" : { text, remindAt, repeat: draft.repeat };
}

const draftOf = (item: AgendaItem): Draft => ({ text: item.text, time: toTimeInput(item.remindAt), repeat: item.repeat });

type Day = "today" | "tomorrow" | "other" | "repeat";
const DAYS: [Day, string][] = [["today", "今天"], ["tomorrow", "明天"], ["other", "日期…"], ["repeat", "重复"]];
type RepeatKind = "workdays" | "daily" | "weekly";
const REPEAT_KINDS: [RepeatKind, string][] = [["workdays", "工作日"], ["daily", "每天"], ["weekly", "每周"]];
/** Monday first, the way weeks are read in China. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const kindOf = (repeat: Repeat): RepeatKind => (repeat === "workdays" ? "workdays" : repeat.length === EVERY_DAY.length ? "daily" : "weekly");

/** Which days a repeating reminder comes back on: working days, every day, or chosen weekdays. */
/**
 * A row of mutually exclusive choices, read as radio buttons: only the chosen
 * one is in the Tab order, and the arrow keys move the choice.
 */
function Segmented<Key extends string>({ label, options, value, onPick }: { label: string; options: readonly (readonly [Key, string])[]; value: Key | null; onPick: (key: Key) => void }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex(([key]) => key === value);
    const next = options[(index + step + options.length) % options.length];
    onPick(next[0]);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[options.indexOf(next)]?.focus();
  };
  const focusable = value ?? options[0][0];
  return (
    <div className="today-segmented" role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} tabIndex={key === focusable ? 0 : -1} className={value === key ? "is-on" : undefined} onClick={() => onPick(key)}>{text}</button>
      ))}
    </div>
  );
}

function RepeatField({ repeat, onChange, now }: { repeat: Repeat; onChange: (repeat: Repeat) => void; now: number }) {
  const kind = kindOf(repeat);
  const pick = (next: RepeatKind) => onChange(next === "workdays" ? "workdays" : next === "daily" ? EVERY_DAY : [new Date(now).getDay()]);
  const toggle = (day: number) => {
    if (repeat === "workdays") return;
    const days = repeat.includes(day) ? repeat.filter((entry) => entry !== day) : [...repeat, day];
    if (days.length > 0) onChange(repeatSchema.parse(days));
  };
  const covered = lastCoveredYear(holidayCalendar());
  return (
    <>
      <div className="today-when">
        <Segmented label="重复方式" options={REPEAT_KINDS} value={kind} onPick={pick} />
        {kind === "weekly" && repeat !== "workdays" && (
          <div className="today-weekdays" role="group" aria-label="每周哪几天">
            {WEEK.map((day) => <button key={day} type="button" aria-pressed={repeat.includes(day)} onClick={() => toggle(day)}>{WEEKDAYS[day]}</button>)}
          </div>
        )}
      </div>
      {kind === "workdays" && (
        <p className="today-when__hint">
          {covered >= new Date(now).getFullYear() ? "跳过法定节假日，调休补班照常提醒" : `节假日安排只到 ${covered} 年，暂时按周一到周五提醒`}
        </p>
      )}
    </>
  );
}

/** When to remind: a segmented day choice plus a time, the way most reminders are set. Every reminder has one. */
function WhenField({ draft, onChange, now }: { draft: Draft; onChange: (draft: Draft) => void; now: number }) {
  const [date, clock] = draft.time === null ? ["", ""] : draft.time.split("T");
  const today = dayKey(now, 0);
  const tomorrow = dayKey(now, 1);
  const day: Day | null = draft.time === null ? null : draft.repeat !== null ? "repeat" : date === today ? "today" : date === tomorrow ? "tomorrow" : "other";
  const pick = (next: Day) => {
    const time = clock || toTimeInput(nextHour(now)).slice(11);
    if (next === "repeat") { onChange({ ...draft, repeat: draft.repeat ?? "workdays", time: `${date || today}T${time}` }); return; }
    const nextDate = next === "today" ? today : next === "tomorrow" ? tomorrow : day === "other" ? date : dayKey(now, 2);
    onChange({ ...draft, repeat: null, time: `${nextDate}T${time}` });
  };
  const at = draft.time === null ? null : fromTimeInput(draft.time);
  return (
    <div className="today-when-stack">
      <div className="today-when">
        <Segmented label="提醒日期" options={DAYS} value={day} onPick={pick} />
        {day === "other" && <input className="today-field today-field--small" type="date" aria-label="提醒日期" value={date} min={today} onChange={(event) => { const value = event.currentTarget.value; if (value) onChange({ ...draft, time: `${value}T${clock}` }); }} />}
        {draft.time !== null && <TimeField className="today-field today-field--small today-field--time" label="提醒时刻" value={clock} onChange={(value) => onChange({ ...draft, time: `${date}T${value}` })} />}
        {draft.repeat === null && at !== null && at < now && <span className="today-when__past">这个时间已经过了，保存时会改到明天</span>}
      </div>
      {draft.repeat !== null && <RepeatField repeat={draft.repeat} now={now} onChange={(repeat) => onChange({ ...draft, repeat })} />}
    </div>
  );
}

function Glyph({ name }: { name: "plus" | "check" | "close" | "moon" | "list" | "repeat" }) {
  const paths = {
    plus: <path d="M12 6v12M6 12h12" />,
    check: <path d="m7.5 12.5 3 3 6-7" />,
    close: <path d="m8 8 8 8M16 8l-8 8" />,
    moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
    repeat: <><path d="m17 3 3 3-3 3" /><path d="M4 11v-1a4 4 0 0 1 4-4h12" /><path d="m7 21-3-3 3-3" /><path d="M20 13v1a4 4 0 0 1-4 4H4" /></>,
    list: <><path d="M10 7h9M10 12h9M10 17h9" /><circle cx="5.5" cy="7" r="1.2" /><circle cx="5.5" cy="12" r="1.2" /><circle cx="5.5" cy="17" r="1.2" /></>,
  } as const;
  return <svg className="today-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

/** Reminders: add, edit, tick off and delete here, or ask the pet in chat. */
export function TodayPanel() {
  const [items, setItems] = useState<AgendaItem[]>(() => sortAgenda(loadAgenda(), Date.now()));
  /** Only do-not-disturb holds reminders back; quiet hours do not. */
  const [quiet, setQuiet] = useState(() => loadQuietPreferences().doNotDisturb);
  const [error, setError] = useState("");
  /** A neutral note under the add field, such as a time moved to tomorrow. */
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [removed, setRemoved] = useState<AgendaItem | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    document.documentElement.classList.add("today-window");
    document.body.classList.add("today-window");
    const refresh = () => {
      const now = Date.now();
      const loaded = loadAgenda();
      // One-offs shown days ago and never ticked stop heading the list.
      if (archiveStale(loaded, now) !== loaded) {
        try { updateAgenda((list) => [...archiveStale(list, now)]); } catch (error) { console.warn("Could not tick off old reminders", error); }
      }
      setItems(sortAgenda(loadAgenda(), now));
      setQuiet(loadQuietPreferences().doNotDisturb);
    };
    // The window is hidden, not closed, so refresh whenever it shows again, and be ready to type unless editing.
    const onFocus = () => {
      refresh();
      if (!editingRef.current) addInput.current?.focus();
    };
    refresh();
    window.addEventListener("focus", onFocus);
    const stops = [subscribeAgenda(refresh), subscribeQuietPreferences(refresh)];
    return () => {
      document.documentElement.classList.remove("today-window");
      document.body.classList.remove("today-window");
      window.removeEventListener("focus", onFocus);
      for (const stop of stops) stop();
    };
  }, []);

  // Esc from anywhere else in the panel puts it away, unless a reminder is open for editing.
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (escapeHidesPanel(event)) void petWindow.hideSelf().catch((reason: unknown) => console.warn("Could not put the panel away", reason)); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEditing]);

  // Chat asks to fix what the AI understood: open that item for editing.
  useEffect(() => petWindow.onTodayItemRequested((id) => {
    const item = loadAgenda().find((entry) => entry.id === id);
    if (item) setEditing({ id, draft: draftOf(item) });
  }), []);

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  const change = (update: (list: AgendaItem[]) => AgendaItem[]): boolean => {
    try {
      setItems(sortAgenda(changeReminders(update, "user"), Date.now()));
      setError("");
      return true;
    } catch (reason) {
      console.error("Failed to update the agenda", reason);
      setError("没能保存。本机存的数据太多了，删掉几条旧提醒或备忘再试。");
      return false;
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const { draft, moved } = upcoming(adding, Date.now());
    const read = readDraft(draft);
    if (typeof read === "string") { setError(read); return; }
    if (change((list) => addAgendaItem(list, { id: newId(), ...read }, Date.now()))) {
      setAdding(EMPTY_DRAFT);
      setNotice(moved ? `今天这个时间已经过了，改成了明天 ${draft.time?.slice(11) ?? ""}。` : "");
    }
    addInput.current?.focus();
  };

  const saveEdit = () => {
    if (!editing) return;
    const { draft, moved } = upcoming(editing.draft, Date.now());
    const read = readDraft(draft);
    if (typeof read === "string") { setError(read); return; }
    if (change((list) => editAgendaItem(list, editing.id, read, Date.now()))) {
      setEditing(null);
      setNotice(moved ? `今天这个时间已经过了，改成了明天 ${draft.time?.slice(11) ?? ""}。` : "");
    }
  };

  const cancelEdit = () => { setEditing(null); setError(""); };

  const remove = (item: AgendaItem) => {
    if (!change((list) => removeAgendaItem(list, item.id))) return;
    setRemoved(item);
    if (editing?.id === item.id) setEditing(null);
  };

  const undo = () => {
    if (removed && change((list) => restoreAgendaItem(list, removed))) setRemoved(null);
  };

  const editKeys = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") { event.preventDefault(); saveEdit(); }
    if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
  };

  /** Esc keeps what was typed and only leaves the field; in an empty field it puts the panel away. */
  const escapeKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || isComposing(event)) return;
    event.preventDefault();
    if (event.currentTarget.value.trim()) event.currentTarget.blur();
    else void petWindow.hideSelf().catch((reason: unknown) => console.warn("Could not put the panel away", reason));
  };

  const now = Date.now();
  const open = items.filter((item) => !isDone(item, now));
  const done = items.filter((item) => isDone(item, now));
  const showAddOptions = adding.text.trim() !== "" || adding.time !== null;
  // A new reminder starts at the next whole hour today; the user only changes it when needed.
  const typeNew = (text: string) => setAdding((draft) => ({ ...draft, text, time: draft.time ?? (text.trim() ? toTimeInput(nextHour(Date.now())) : null) }));

  const row = (item: AgendaItem) => {
    const finished = isDone(item, now);
    if (editing?.id === item.id) {
      return (
        <li key={item.id} className="today-row is-editing" onKeyDown={editKeys}>
          <input className="today-field" autoFocus value={editing.draft.text} maxLength={AGENDA_LIMITS.text} aria-label="提醒内容" onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, text: event.currentTarget.value } })} />
          <WhenField draft={editing.draft} now={now} onChange={(draft) => setEditing({ ...editing, draft })} />
          <div className="today-edit__actions">
            <button type="button" className="today-button today-button--danger" onClick={() => remove(item)}>删除</button>
            <span className="today-edit__spacer" />
            <button type="button" className="today-button" onClick={cancelEdit}>取消</button>
            <button type="button" className="today-button today-button--primary" onClick={saveEdit}>保存</button>
          </div>
        </li>
      );
    }
    const at = shownAt(item, now);
    const overdue = !finished && at <= now;
    return (
      <li key={item.id} className={finished ? "today-row is-done" : "today-row"}>
        <button type="button" role="checkbox" aria-checked={finished} aria-label={`${finished ? "标为未完成" : "完成"}：${item.text}`} className={overdue ? "today-check is-due" : "today-check"} onClick={() => change((list) => setAgendaItemDone(list, item.id, !finished, Date.now()))}>
          <Glyph name="check" />
        </button>
        <button type="button" className="today-row__main" title="点一下修改" onClick={() => setEditing({ id: item.id, draft: draftOf(item) })}>
          <span className="today-row__text">{item.text}</span>
          <span className="today-row__meta">
            <time className={overdue ? "today-row__time is-due" : "today-row__time"}>{reminderLabel(at, now)}{overdue && " · 已到点"}</time>
            {item.repeat !== null && <span className="today-row__repeat"><Glyph name="repeat" />{repeatLabel(item.repeat)}</span>}
          </span>
        </button>
        <button type="button" className="today-row__remove" aria-label={`删除：${item.text}`} title="删除" onClick={() => remove(item)}><Glyph name="close" /></button>
      </li>
    );
  };

  return (
    <main className="today-panel">
      <header className="today-header" data-tauri-drag-region>
        <div className="today-header__titles" data-tauri-drag-region>
          <h1 data-tauri-drag-region>提醒</h1>
          <p data-tauri-drag-region>
            <span>{todayTitle(now)}</span>
            {quiet && <span className="today-quiet" title="勿扰开着：到点的提醒先显示在宠物旁边的徽标上，关掉勿扰后再弹出"><Glyph name="moon" />勿扰中</span>}
          </p>
        </div>
        <span className="today-count"><span aria-hidden="true">{open.length}<small>未完成</small></span><span className="visually-hidden">{open.length} 个提醒未完成</span></span>
      </header>

      <form className="today-add" onSubmit={add}>
        <label className="today-add__field">
          <Glyph name="plus" />
          <input ref={addInput} value={adding.text} maxLength={AGENDA_LIMITS.text} placeholder="添加提醒" aria-label="新提醒" onChange={(event) => typeNew(event.currentTarget.value)} onKeyDown={escapeKeys} />
          {adding.text.trim() && <button type="submit" className="today-button today-button--primary today-add__save" title="添加（回车）">添加</button>}
        </label>
        {showAddOptions && <div className="today-add__options"><WhenField draft={adding} now={now} onChange={setAdding} /></div>}
      </form>
      {error && <p className="today-error" role="alert">{error}</p>}
      {notice && !error && <p className="today-notice" role="status">{notice}</p>}

      <section className="today-list" aria-label="提醒">
        {items.length === 0 ? (
          <div className="today-empty">
            <Glyph name="list" />
            <strong>还没有提醒</strong>
            <p>在上面写一句、选个时间，或者跟宠物说“下午三点提醒我开会”。没有时间的事放进备忘。</p>
          </div>
        ) : (
          <>
            {open.length > 0 && <ul>{open.map(row)}</ul>}
            {open.length === 0 && <p className="today-all-done">提醒都处理完了。</p>}
            {done.length > 0 && (
              <>
                <h2 className="today-section">已完成 {done.length}</h2>
                <ul>{done.map(row)}</ul>
              </>
            )}
          </>
        )}
      </section>

      {removed && (
        <div className="today-hud" role="status">
          <span>已删除“{removed.text}”</span>
          <button type="button" onClick={undo}>撤销</button>
        </div>
      )}
    </main>
  );
}
