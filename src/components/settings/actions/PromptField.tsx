import { ART_PROMPT_MAX_CHARS } from "../../../assets/ArtPrompt";
import { ConfirmButton } from "../../ConfirmButton";
import { CopyButton } from "./CopyButton";

interface Props {
  /** What the copy button says. */
  copyLabel: string;
  /** What it copies: the prompt as written, or with an action already filled in. */
  copyText: string;
  /** The link that opens the prompt for reading and rewording. */
  summary: string;
  value: string;
  /** The built-in wording, to go back to. */
  fallback: string;
  note: string;
  /** The one coloured button of its step. */
  primary?: boolean;
  onChange: (text: string) => void;
  onMessage: (message: string) => void;
}

/** A prompt for an image model: copy it in one click, or open it to reword it. */
export function PromptField({ copyLabel, copyText, summary, value, fallback, note, primary = false, onChange, onMessage }: Props) {
  return <div className="prompt-field">
    <CopyButton className={primary ? "settings-button settings-button--small settings-button--primary" : "settings-button settings-button--small"} text={copyText} onMessage={onMessage}>{copyLabel}</CopyButton>
    <details>
      <summary>{summary}</summary>
      <textarea aria-label={summary} value={value} maxLength={ART_PROMPT_MAX_CHARS} spellCheck={false} onChange={(event) => onChange(event.currentTarget.value)} />
      <p className="prompt-field__foot">
        <span>{note}</span>
        {value !== fallback && <ConfirmButton className="settings-link" confirm={{ message: "恢复默认提示词？", detail: "你改过的文字会换回自带的写法。", action: "恢复默认" }} onConfirm={() => onChange(fallback)}>恢复默认</ConfirmButton>}
      </p>
    </details>
  </div>;
}
