import { useEffect, useRef, useState } from "react";
import { ai } from "../../ai";
import { translationPlatform } from "../../platform/translation";
import { loadChatModel } from "../../preferences/ChatModel";
import { classifyServiceError, isKeyProblem } from "../../chat/serviceErrors";
import { petWindow } from "../../platform/petWindow";
import { isComposing } from "../keyboard";
import "./TranslationPanel.css";

const MAX_BYTES = 16_000;
type Target = "zh" | "en";
export function TranslationPanel() {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<Target>("zh");
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [permission, setPermission] = useState(false);
  /** The last error is fixed by adding or replacing the DeepSeek key. */
  const [keyFix, setKeyFix] = useState(false);
  const request = useRef<string | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  const startTranslation = async (text: string, language: Target) => {
    if (!text.trim() || request.current) return;
    if (new TextEncoder().encode(text).length > MAX_BYTES) { setMessage("文字太长，请减少内容后重试。"); return; }
    const id = crypto.randomUUID(); request.current = id; setPending(true); setMessage(""); setKeyFix(false); setResult("");
    try { await ai.translate(id, text, language, loadChatModel()); }
    catch (error) { console.error("Translation failed", error); if (request.current === id) { request.current = null; setPending(false); setKeyFix(isKeyProblem(classifyServiceError(String(error)))); setMessage(String(error).includes("not configured") ? "请先在设置中配置 DeepSeek API Key。" : "翻译没能开始，请检查网络和 AI 设置后重试。"); } }
  };

  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    const cancel = async () => { const id = request.current; request.current = null; if (id) await ai.cancel(id).catch(() => {}); setPending(false); };
    const open = async () => {
      const selection = await translationPlatform.takeSelection();
      if (disposed || !selection) return;
      await cancel();
      if (disposed) return;
      setSource(selection.text); setResult(selection.result ?? "");
      setPermission(selection.status === "permission");
      setKeyFix(false);
      const language: Target = /[\u3400-\u9fff]/.test(selection.text) ? "en" : "zh";
      if (selection.text) setTarget(language);
      setMessage(selection.status === "permission" ? "允许辅助功能后可读取选中文字；也可以直接粘贴。" : selection.status === "empty" ? "没有读取到选中文字，请粘贴或输入。" : "");
      sourceRef.current?.focus();
      if (selection.auto && selection.text) void startTranslation(selection.text, language);
    };
    const setup = async () => {
      const add = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
      add(await ai.subscribe((event) => {
        if (event.id !== request.current) return;
        if (event.kind === "delta") setResult((value) => value + event.text);
        else if (event.kind === "done" || event.kind === "error" || event.kind === "cancelled") {
          request.current = null; setPending(false);
          if (event.kind === "error") { setMessage(event.text || "翻译中断，请重试。"); setKeyFix(isKeyProblem(classifyServiceError(event.text))); }
          if (event.kind === "done" && event.text === "length") setMessage("译文未完全输出，请缩短原文后重试。");
        }
      }));
      if (disposed) return;
      add(await translationPlatform.onOpen(() => void open()));
      if (disposed) return;
      add(await translationPlatform.onHide(() => void cancel()));
      if (!disposed) void open();
    };
    void setup().catch((error: unknown) => console.warn("Translation is unavailable", error));
    return () => { disposed = true; stops.forEach((stop) => stop()); const id = request.current; if (id) void ai.cancel(id).catch(() => {}); };
  }, []);

  const translate = async () => {
    if (pending || !source.trim()) return;
    await startTranslation(source, target);
  };
  const close = () => { const id = request.current; request.current = null; if (id) void ai.cancel(id).catch(() => {}); setPending(false); void translationPlatform.hide(); };
  const copy = async () => { try { await navigator.clipboard.writeText(result); setMessage("已复制译文。"); } catch (error) { console.error("Could not copy translation", error); setMessage("没能复制，请再试一次。"); } };
  return <main className="translation" onKeyDown={(event) => { if (isComposing(event)) return; if (event.key === "Escape") { event.preventDefault(); close(); } else if (event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); void translate(); } }}>
    <p className="translation-hint">选中文字后按快捷键，或在这里粘贴。按 Esc 关闭。</p>
    <div className="translation-language"><span>自动识别</span><span aria-hidden="true">→</span><select value={target} aria-label="目标语言" onChange={(event) => setTarget(event.target.value as Target)}><option value="zh">中文</option><option value="en">英文</option></select></div>
    <textarea ref={sourceRef} value={source} onChange={(event) => setSource(event.target.value)} placeholder="输入或粘贴要翻译的文字" aria-label="原文" />
    <div className="translation-actions"><span>提交后原文会发送给 DeepSeek</span>{pending ? <button className="ui-button ui-button--large ui-button--primary" type="button" onClick={() => { const id = request.current; request.current = null; if (id) void ai.cancel(id).catch(() => {}); setPending(false); setKeyFix(false); setMessage("已停止翻译。"); }}>停止</button> : <button className="ui-button ui-button--large ui-button--primary" type="button" disabled={!source.trim()} onClick={() => void translate()}>翻译</button>}</div>
    {message && <div className="translation-message" role="status"><span>{message}</span>{keyFix && <button type="button" className="ui-link" onClick={() => void petWindow.openSettings("ai").catch((error: unknown) => { console.error("Could not open settings", error); setMessage("没能打开设置，请从宠物的右键菜单打开。"); })}>去设置</button>}</div>}
    {permission && <button type="button" className="ui-link translation-permission" onClick={() => void translationPlatform.openAccessibilitySettings().catch((error: unknown) => { console.error("Could not open accessibility settings", error); setMessage("请在系统设置的隐私与安全性中打开辅助功能。"); })}>打开辅助功能设置</button>}
    {(result || pending) && <section className="translation-result"><div><strong>译文</strong>{result && <button type="button" className="ui-link" onClick={() => void copy()}>复制</button>}</div><p>{result || "正在翻译…"}</p></section>}
  </main>;
}
