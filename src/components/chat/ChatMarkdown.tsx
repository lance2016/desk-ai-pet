import { Fragment, useMemo } from "react";
import { parseMarkdown, type Inline } from "../../chat/markdown";
import { systemPlatform } from "../../platform/system";
import { findWebAddresses, webAddress } from "../../chat/ReadLinks";

/** Links open in the default browser; the chat window itself never navigates away. */
const openLink = (url: string) => void systemPlatform.openLink(url).catch((error: unknown) => console.warn("Could not open the link", error));

function ChatLink({ url, text }: { url: string; text: string }) {
  const address = webAddress(url);
  return address
    ? <button type="button" className="chat-link" title={address.href} onClick={() => openLink(address.href)}>{text}</button>
    : <>{text}</>;
}

/** A user message keeps its exact plain text and makes any pasted URLs clickable. */
export function ChatPlainText({ text }: { text: string }) {
  let end = 0;
  return <>{findWebAddresses(text).map((link) => {
    const prefix = text.slice(end, link.start);
    end = link.start + link.text.length;
    return <Fragment key={link.start}>{prefix}<ChatLink url={link.url.href} text={link.text} /></Fragment>;
  })}{text.slice(end)}</>;
}

function InlineText({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => part.kind === "link" ? <ChatLink key={index} url={part.url} text={part.text} />
    : part.kind === "strong" ? <strong key={index}>{part.text}</strong>
    : part.kind === "em" ? <em key={index}>{part.text}</em>
    : part.kind === "code" ? <code key={index}>{part.text}</code>
    : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

/** A reply rendered from its Markdown, as React elements only. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="chat-markdown">{blocks.map((block, index) => {
    if (block.kind === "heading") return <p key={index} className="chat-markdown__heading"><InlineText parts={block.inline} /></p>;
    if (block.kind === "code") return <pre key={index}><code>{block.text}</code></pre>;
    if (block.kind === "list") {
      const items = block.items.map((item, at) => <li key={at}><InlineText parts={item} /></li>);
      return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    return <p key={index}>{block.lines.map((line, at) => <Fragment key={at}>{at > 0 && <br />}<InlineText parts={line} /></Fragment>)}</p>;
  })}</div>;
}
