import { useEffect, useRef, useState } from "react";
import { chatPlatform } from "../../platform/chat";
import { translationPlatform } from "../../platform/translation";
import { loadChatModel } from "../../preferences/ChatModel";
import { classifyServiceError, isKeyProblem } from "../../chat/serviceErrors";
import { petWindow } from "../../platform/petWindow";
import "./SelectionFloat.css";

export function SelectionFloat() {
  const [expanded, setExpanded] = useState(false);
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
      add(await chatPlatform.subscribe((event) => {
        if (event.id !== request.current) return;
        if (event.kind === "delta") setResult((value) => value + event.text);
        if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") {
          request.current = null; setPending(false);
          if (event.kind === "error") { setMessage(event.text || "翻译中断，请重试。"); setKeyFix(isKeyProblem(classifyServiceError(event.text))); }
          if (event.kind === "done" && event.text === "length") setMessage("译文未完全输出，请到详情页缩短原文后重试。");
        }
      }));
      if (disposed) return;
      add(await translationPlatform.onSelectionReset(() => {
        generation.current += 1;
        request.current = null; setExpanded(false); setPending(false); setResult(""); setMessage(""); setKeyFix(false);
      }));
      if (!disposed) setReady(true);
    };
    void setup().catch((error: unknown) => console.error("Could not listen for translation", error));
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);

  const translate = async () => {
    const current = generation.current;
    setPending(true);
    try {
      const text = await translationPlatform.expandSelection();
      if (current !== generation.current) return;
      if (!text) { setPending(false); return; }
      setExpanded(true); setPending(true); setResult(""); setMessage(""); setKeyFix(false);
      const id = crypto.randomUUID(); request.current = id;
      await chatPlatform.translate(id, text, /[\u3400-\u9fff]/.test(text) ? "en" : "zh", loadChatModel());
    } catch (error) {
      if (current !== generation.current) return;
      console.error("Could not start selection translation", error);
      request.current = null; setPending(false);
      setKeyFix(isKeyProblem(classifyServiceError(String(error))));
      setMessage(String(error).includes("not configured") ? "请先在设置中配置 DeepSeek API Key。" : "翻译没能开始，请检查 AI 设置后重试。");
    }
  };
  const details = () => void translationPlatform.translateSelection(pending ? undefined : result).catch((error: unknown) => console.error("Could not open translation details", error));
  const openKeySettings = () => void petWindow.openSettings("ai").catch((error: unknown) => { console.error("Could not open settings", error); setMessage("没能打开设置，请从宠物的右键菜单打开。"); });
  const close = () => void translationPlatform.closeSelection().catch((error: unknown) => console.error("Could not close translation", error));
  const copy = async () => { try { await navigator.clipboard.writeText(result); setMessage("已复制"); } catch (error) { console.error("Could not copy translation", error); setMessage("复制失败，请重试。"); } };

  if (!expanded) return <div className="selection-float"><button type="button" disabled={!ready || pending} onClick={() => void translate()}><span aria-hidden="true">译</span> 翻译</button><button type="button" onClick={details}>翻译详情</button></div>;
  return <section className="selection-result" aria-label="翻译结果">
    <header><strong>译文</strong><button type="button" onClick={close} aria-label="关闭翻译" title="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg></button></header>
    <div className="selection-result__body">{result || (pending ? "正在翻译…" : message || "没有收到译文。")}</div>
    {message && result && <p className="selection-result__message" role="status">{message}</p>}
    <footer>{keyFix && <button type="button" onClick={openKeySettings}>去设置</button>}<button type="button" onClick={details}>翻译详情</button><button type="button" disabled={!result} onClick={() => void copy()}>复制译文</button></footer>
  </section>;
}
