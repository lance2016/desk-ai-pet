import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isComposing } from "../keyboard";
import { searchSettings, type SearchEntry } from "./settingsSearch";
import { Icon } from "../../ui/icons";

/** A search result: where it is, plus the line under its title. */
export interface SearchResult extends SearchEntry {
  /** The page name, or "功能一览" for a feature; empty for a page itself. */
  place: string;
}

interface SettingsSearchProps {
  entries: readonly SearchResult[];
  /** The sidebar pages, shown while nothing is typed. */
  children: ReactNode;
  icon: (entry: SearchResult) => ReactNode;
  onPick: (entry: SearchResult) => void;
}

/**
 * The search field at the top of the sidebar, as in System Settings: typing swaps the pages
 * for the matching settings and features. ⌘F focuses it, the arrow keys move through the
 * results, Return opens one, Esc clears the field.
 */
export function SettingsSearch({ entries, children, icon, onPick }: SettingsSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchSettings(entries, query), [entries, query]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") { event.preventDefault(); field.current?.focus(); field.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (entry: SearchResult, index: number) => { setActive(index); onPick(entry); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Escape") { event.preventDefault(); if (query) { setQuery(""); setActive(0); } else field.current?.blur(); return; }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const index = Math.min(active, results.length - 1);
      pick(results[index], index);
    }
  };
  const optionId = (index: number) => `${listId}-${index}`;
  const searching = query.trim() !== "";

  return <>
    <div role="search">
      <label className="ui-search settings-search">
        <Icon name="search" />
        <input
          ref={field} type="search" placeholder="搜索" aria-label="搜索设置和功能" value={query} spellCheck={false}
          role="combobox" aria-expanded={searching} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={searching && results.length > 0 ? optionId(Math.min(active, results.length - 1)) : undefined}
          onChange={(event) => { setQuery(event.currentTarget.value); setActive(0); }} onKeyDown={onKeyDown}
        />
      </label>
    </div>
    {!searching ? children : results.length === 0
      ? <p className="settings-results__empty" role="status">没有找到“{query.trim()}”</p>
      : <ul id={listId} className="settings-results" role="listbox" aria-label="搜索结果">
        {results.map((entry, index) => <li key={`${entry.section}-${entry.title}-${index}`} id={optionId(index)} role="option" aria-selected={index === active}
          className={index === active ? "settings-result is-active" : "settings-result"} onClick={() => pick(entry, index)}>
          {icon(entry)}
          <span><strong>{entry.title}</strong>{entry.place && <small>{entry.place}</small>}</span>
        </li>)}
      </ul>}
  </>;
}
