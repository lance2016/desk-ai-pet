import { useEffect, useRef, useState } from "react";
import { ai, type TextTask } from "../../ai";
import { translationPlatform } from "../../platform/translation";
import { loadChatModel } from "../../preferences/ChatModel";
import { classifyServiceError, isKeyProblem } from "../../chat/serviceErrors";
import { petWindow } from "../../platform/petWindow";
import "./SelectionFloat.css";
import { Icon } from "../../ui/icons";

type Action = "translate" | "explain" | "summarize" | "polish";

/** What the buttons offer for the selected text, in order. */
const ACTIONS: Record<Action, { label: string; pending: string; copy: string }> = {
  translate: { label: "翻译", pending: "正在翻译…", copy: "复制译文" },
  explain: { label: "解释", pending: "正在解释…", copy: "复制" },
  summarize: { label: "总结", pending: "正在总结…", copy: "复制" },
  polish: { label: "润色", pending: "正在润色…", copy: "复制" },
};
const ORDER = Object.keys(ACTIONS) as Action[];

/** Chinese text is translated into English, anything else into Chinese. */
const taskFor = (action: Action, text: string): TextTask => (action === "translate" ? (/[㐀-鿿]/.test(text) ? "en" : "zh") : action);

export function SelectionFloat() {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<Action>("translate");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  /** The last error is fixed by adding or replacing the DeepSeek key. */
  const [keyFix, setKeyFix] = useState(false);
  const request = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    const setup = async () => {
      const add = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
      add(await ai.subscribe((event) => {
        if (event.id !== request.current) return;
        if (event.kind === "delta") setResult((value) => value + event.text);
        if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") {
          request.current = null; setPending(false);
          if (event.kind === "error") { setMessage(event.text || "中断了，请重试。"); setKeyFix(isKeyProblem(classifyServiceError(event.text))); }
          if (event.kind === "done" && event.text === "length") setMessage("没有完全输出，可以选短一点的文字再试。");
        }
      }));
      if (disposed) return;
      add(await translationPlatform.onSelectionReset(() => {
        generation.current += 1;
        request.current = null; setExpanded(false); setAction("translate"); setPending(false); setResult(""); setMessage(""); setKeyFix(false);
      }));
      if (!disposed) setReady(true);
    };
    void setup().catch((error: unknown) => console.error("Could not listen for translation", error));
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);

  /** Runs `next` on the selected text; switching in the result card stops the one still running. */
  const run = async (next: Action) => {
    const current = generation.current;
    const previous = request.current;
    request.current = null;
    setAction(next); setPending(true);
    try {
      if (previous) await ai.cancel(previous);
      const text = await translationPlatform.expandSelection();
      if (current !== generation.current) return;
      if (!text) { setPending(false); return; }
      setExpanded(true); setResult(""); setMessage(""); setKeyFix(false);
      const id = crypto.randomUUID(); request.current = id;
      await ai.translate(id, text, taskFor(next, text), loadChatModel());
    } catch (error) {
      if (current !== generation.current) return;
      console.error(`Could not start ${next} on the selection`, error);
      request.current = null; setPending(false);
      setKeyFix(isKeyProblem(classifyServiceError(String(error))));
      setMessage(String(error).includes("not configured") ? "请先在设置中配置 DeepSeek API Key。" : `${ACTIONS[next].label}没能开始，请检查 AI 设置后重试。`);
    }
  };
  const details = () => void translationPlatform.translateSelection(pending || action !== "translate" ? undefined : result).catch((error: unknown) => console.error("Could not open translation details", error));
  const openKeySettings = () => void petWindow.openSettings("ai").catch((error: unknown) => { console.error("Could not open settings", error); setMessage("没能打开设置，请从宠物的右键菜单打开。"); });
  const close = () => void translationPlatform.closeSelection().catch((error: unknown) => console.error("Could not close translation", error));
  const copy = async () => { try { await navigator.clipboard.writeText(result); setMessage("已复制"); } catch (error) { console.error("Could not copy the result", error); setMessage("没能复制，请再试一次。"); } };

  if (!expanded) {
    return (
      <div className="selection-float">
        {ORDER.map((id) => <button key={id} type="button" className={id === "translate" ? "is-primary" : undefined} disabled={!ready || pending} onClick={() => void run(id)}>{ACTIONS[id].label}</button>)}
        <button type="button" className="selection-float__open" aria-label="翻译详情" title="在翻译窗口打开" onClick={details}>
          <Icon name="open" />
        </button>
      </div>
    );
  }
  return <section className="selection-result" aria-label={`${ACTIONS[action].label}结果`}>
    <header>
      <div className="ui-segmented" role="group" aria-label="换一种处理">
        {ORDER.map((id) => <button key={id} type="button" aria-pressed={id === action} className={id === action ? "is-selected" : undefined} onClick={() => { if (id !== action) void run(id); }}>{ACTIONS[id].label}</button>)}
      </div>
      <button type="button" className="selection-result__close" onClick={close} aria-label="关闭" title="关闭"><Icon name="close" /></button>
    </header>
    <div className="selection-result__body">{result || (pending ? ACTIONS[action].pending : message || "没有收到结果。")}</div>
    {message && result && <p className="selection-result__message" role="status">{message}</p>}
    <footer>{keyFix && <button type="button" onClick={openKeySettings}>去设置</button>}{action === "translate" && <button type="button" onClick={details}>翻译详情</button>}<button type="button" disabled={!result} onClick={() => void copy()}>{ACTIONS[action].copy}</button></footer>
  </section>;
}
