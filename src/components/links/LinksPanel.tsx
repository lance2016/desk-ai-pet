import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { LINK_LIMITS, linksByGroup, linksEnabled, linkSchema, loadLinks, moveLink, moveLinkGroup, setLinksEnabled, subscribeLinks, updateLinks, type WorkLink } from "../../links/LinkStore";
import { petWindow } from "../../platform/petWindow";
import { systemPlatform } from "../../platform/system";
import { isComposing, useCloseShortcut } from "../keyboard";
import "../today/TodayPanel.css";
import "./LinksPanel.css";

const UNDO_MS = 5_000;
const BLANK_LINK = { name: "", url: "", group: "", tag: "" };
const hidePanel = () => void petWindow.hideSelf().catch((error: unknown) => console.error("Failed to hide links", error));

function Glyph({ name }: { name: "globe" | "plus" | "search" | "open" | "more" }) {
  const paths = {
    globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a14 14 0 0 1 0 16 14 14 0 0 1 0-16Z" /></>,
    plus: <path d="M5 12h14M12 5v14" />,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></>,
    open: <path d="M6 18 18 6M9 6h9v9" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  };
  return <svg className="today-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function LinksPanel() {
  useCloseShortcut(hidePanel);
  useEffect(() => {
    document.documentElement.classList.add("today-window");
    document.body.classList.add("today-window");
    return () => {
      document.documentElement.classList.remove("today-window");
      document.body.classList.remove("today-window");
    };
  }, []);
  return <main className="today-panel links-panel"><LinksView /></main>;
}

export function LinksSettings() {
  const enabled = useSyncExternalStore(subscribeLinks, linksEnabled);
  const [error, setError] = useState(false);
  const toggle = () => {
    try {
      setLinksEnabled(!enabled);
      setError(false);
    } catch (error) {
      console.error("Failed to save the links setting", error);
      setError(true);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row__body"><strong>启用常用链接</strong><span>从宠物右键菜单或快捷按钮打开面板</span></span>
          <button type="button" role="switch" className={enabled ? "toggle is-on" : "toggle"} aria-checked={enabled} aria-label="启用常用链接" onClick={toggle} />
        </div>
      </div>
      {error && <p role="alert">没能保存设置，请重试。</p>}
      <div className="today-panel links-panel links-panel--manager"><LinksView managing /></div>
    </div>
  );
}

function LinksView({ managing = false }: { managing?: boolean }) {
  const [links, setLinks] = useState(() => loadLinks());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkLink | "new" | null>(null);
  const [hud, setHud] = useState<{ text: string; undo?: () => void } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dragged = useRef<string | null>(null);
  const opening = useRef(false);
  const groups = [...linksByGroup(links, query)];
  const results = groups.flatMap(([, entries]) => entries);
  const active = results.find((link) => link.id === selectedId) ?? results[0];
  const canReorder = managing && query.trim() === "";

  useEffect(() => subscribeLinks(() => setLinks(loadLinks())), []);
  useEffect(() => {
    if (managing) return;
    return petWindow.onShown(() => {
      setEditing(null);
      setActionsId(null);
      setSelectedId(null);
      setQuery("");
      search.current?.focus();
    });
  }, [managing]);
  useEffect(() => {
    if (!editing && !managing) search.current?.focus();
  }, [editing, managing]);
  useEffect(() => {
    if (hud === null) return;
    const timer = setTimeout(() => setHud(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [hud]);

  const save = (change: Parameters<typeof updateLinks>[0]) => {
    try {
      updateLinks(change);
      return true;
    } catch {
      console.error("Failed to save the links list");
      setHud({ text: "没能保存常用链接，请重试。" });
      return false;
    }
  };

  const open = async (link: WorkLink) => {
    if (opening.current) return;
    opening.current = true;
    try {
      await systemPlatform.openLink(link.url);
      if (!managing) hidePanel();
    } catch {
      console.error("Failed to open a saved link");
      setHud({ text: "没能打开链接，请检查地址。" });
    } finally {
      opening.current = false;
    }
  };

  const copy = async (link: WorkLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setActionsId(null);
      setHud({ text: "已复制链接" });
    } catch (error) {
      console.error("Failed to copy a saved link", error);
      setHud({ text: "没能复制链接，请重试。" });
    }
  };

  const remove = (link: WorkLink) => {
    const index = links.findIndex((item) => item.id === link.id);
    if (!save((items) => items.filter((item) => item.id !== link.id))) return;
    setActionsId(null);
    setHud({
      text: "已删除链接",
      undo: () => {
        if (save((items) => {
          if (items.some((item) => item.id === link.id)) return items;
          return [...items.slice(0, index), link, ...items.slice(index)];
        })) setHud(null);
      },
    });
  };

  const startEdit = (link: WorkLink | "new") => {
    setActionsId(null);
    setEditing(link);
  };

  const keySearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" && active) {
      event.preventDefault();
      void open(active);
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && active) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const index = Math.max(0, Math.min(results.length - 1, results.indexOf(active) + offset));
      const next = results[index];
      setSelectedId(next.id);
      scroll.current?.querySelector(`[data-link-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div className="links-view" onKeyDown={(event) => {
      if (event.key !== "Escape" || isComposing(event)) return;
      event.preventDefault();
      if (editing) setEditing(null);
      else if (actionsId) setActionsId(null);
      else if (query) { setQuery(""); setSelectedId(null); search.current?.focus(); }
      else if (!managing) hidePanel();
    }}>
      <header className="today-header links-header" data-tauri-drag-region={!managing ? "" : undefined}>
        <h1 data-tauri-drag-region={!managing ? "" : undefined}>{editing === "new" ? "添加链接" : editing ? "编辑链接" : managing ? "链接列表" : "常用链接"}</h1>
        {!editing && <button type="button" className="links-icon-button" title="添加链接" aria-label="添加链接" onClick={() => startEdit("new")}><Glyph name="plus" /></button>}
      </header>
      {editing ? (
        <LinkForm
          initial={editing}
          groups={[...linksByGroup(links).keys()].filter(Boolean)}
          isFull={links.length >= LINK_LIMITS.count}
          onCancel={() => setEditing(null)}
          onSave={(link) => {
            const succeeded = save((items) => {
              const previous = items.find((item) => item.id === link.id);
              if (editing !== "new" && !previous) throw new Error("The link was removed in another window");
              if (previous?.group === link.group) return items.map((item) => item.id === link.id ? link : item);
              return [...items.filter((item) => item.id !== link.id), link];
            });
            if (succeeded) { setQuery(""); setSelectedId(link.id); setEditing(null); }
          }}
        />
      ) : (
        <>
          <label className="links-search"><Glyph name="search" /><input ref={search} className="today-field" type="search" aria-label="搜索名称或地址" placeholder="搜索名称或地址" value={query} onKeyDown={keySearch} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); setActionsId(null); }} /></label>
          <div className="links-list" ref={scroll}>
            {results.length === 0 && <div className="today-empty"><Glyph name="globe" /><strong>{links.length ? "没有匹配的链接" : "还没有常用链接"}</strong>{links.length === 0 && <button type="button" className="today-button today-button--primary" onClick={() => startEdit("new")}>添加链接</button>}</div>}
            {groups.map(([name, entries], groupIndex) => (
              <section className="links-group" key={name} aria-label={name || "未分组"}>
                <div className="links-group__header">
                  {(name || groups.length > 1 || canReorder) && <h2>{name || "未分组"}</h2>}
                  {canReorder && groups.length > 1 && <div className="links-actions">
                    <button type="button" className="links-icon-button" disabled={groupIndex === 0} aria-label={`上移分组 ${name || "未分组"}`} onClick={() => save((items) => moveLinkGroup(items, name, -1))}>↑</button>
                    <button type="button" className="links-icon-button" disabled={groupIndex === groups.length - 1} aria-label={`下移分组 ${name || "未分组"}`} onClick={() => save((items) => moveLinkGroup(items, name, 1))}>↓</button>
                  </div>}
                </div>
                <ul className="links-rows">
                  {entries.map((link, index) => (
                    <li key={link.id} data-link-id={link.id}
                      onContextMenu={(event) => { event.preventDefault(); setActionsId(link.id); }}
                      onDragOver={(event) => { if (canReorder && dragged.current !== null) event.preventDefault(); }}
                      onDrop={(event) => {
                        if (!canReorder || !dragged.current) return;
                        event.preventDefault();
                        const id = dragged.current;
                        dragged.current = null;
                        save((items) => moveLink(items, id, link.id));
                      }}>
                      <div className={active?.id === link.id && !managing ? "links-row is-selected" : "links-row"}>
                        <button type="button" className="links-row__main" title={link.url} draggable={canReorder}
                          onDragStart={(event) => { dragged.current = link.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", link.id); }}
                          onDragEnd={() => { dragged.current = null; }}
                          onClick={() => void open(link)}>
                          <Glyph name="globe" /><span className="links-row__name">{link.name}</span>
                          {link.tag && <span className={link.tag.toLowerCase() === "prod" ? "links-tag is-production" : "links-tag"}>{link.tag}</span>}
                          <span className="links-row__open"><Glyph name="open" /></span>
                        </button>
                        <button type="button" className="links-icon-button links-row__more" aria-label={`${link.name}的选项`} aria-expanded={actionsId === link.id} onClick={() => setActionsId(actionsId === link.id ? null : link.id)}><Glyph name="more" /></button>
                      </div>
                      {actionsId === link.id && <div className="links-row__actions">
                        <button type="button" className="today-button" onClick={() => startEdit(link)}>编辑</button>
                        <button type="button" className="today-button" onClick={() => void copy(link)}>复制地址</button>
                        {canReorder && index > 0 && <button type="button" className="today-button" onClick={() => save((items) => moveLink(items, link.id, entries[index - 1].id))}>上移</button>}
                        {canReorder && index < entries.length - 1 && <button type="button" className="today-button" onClick={() => save((items) => moveLink(items, link.id, entries[index + 1].id))}>下移</button>}
                        <button type="button" className="today-button today-button--danger" onClick={() => remove(link)}>删除</button>
                      </div>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {hud && <div className="today-hud" role="status"><span>{hud.text}</span>{hud.undo && <button type="button" onClick={hud.undo}>撤销</button>}</div>}
    </div>
  );
}

function LinkForm({ initial, groups, isFull, onSave, onCancel }: {
  initial: WorkLink | "new";
  groups: string[];
  isFull: boolean;
  onSave: (link: WorkLink) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const fields = initial === "new" ? BLANK_LINK : initial;
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (initial === "new" && isFull) { setError("已达链接数量上限。"); return; }
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = linkSchema.safeParse({ ...values, id: initial === "new" ? crypto.randomUUID() : initial.id });
    if (!result.success) { setError(result.error.issues[0].message); return; }
    onSave(result.data);
  };
  return (
    <form className="links-form" onSubmit={submit}>
      <label>名称<input ref={first} name="name" className="today-field" defaultValue={fields.name} maxLength={LINK_LIMITS.name} required /></label>
      <label>地址<input name="url" className="today-field" type="text" inputMode="url" placeholder="https://" defaultValue={fields.url} maxLength={LINK_LIMITS.url} required /></label>
      <label>分组<input name="group" className="today-field" list="work-link-groups" placeholder="未分组" defaultValue={fields.group} maxLength={LINK_LIMITS.group} /></label>
      <datalist id="work-link-groups">{groups.map((group) => <option key={group} value={group} />)}</datalist>
      <label>环境标签<input name="tag" className="today-field" placeholder="可选，例如 TEST" defaultValue={fields.tag} maxLength={LINK_LIMITS.tag} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="links-form__actions"><button type="button" className="today-button" onClick={onCancel}>取消</button><button type="submit" className="today-button today-button--primary">保存</button></div>
    </form>
  );
}
