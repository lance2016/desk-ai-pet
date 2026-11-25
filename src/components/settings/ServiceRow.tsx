import type { ReactNode } from "react";

interface Props {
  name: string;
  /** What the service is used for. */
  purpose: string;
  /** Whether its API Key is saved; null while that is being read. */
  configured: boolean | null;
  /** The app works without it: an empty key reads as optional, not missing. */
  optional?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** The key form, shown while expanded. */
  children: ReactNode;
  /** The outcome of the last save, test or removal. */
  status?: string;
}

/** One service on 「AI 服务」: the same row, status word and key form for DeepSeek, MiMo and Bailian. */
export function ServiceRow({ name, purpose, configured, optional = false, expanded, onToggle, children, status }: Props) {
  const word = configured === null ? "检查中" : configured ? "已配置" : optional ? "未配置 · 可选" : "未配置";
  return <>
    <div className="settings-row">
      <div className="settings-row__body"><strong>{name}</strong><span>{purpose}</span></div>
      <span className={configured ? "settings-row__value ai-service__state is-ready" : "settings-row__value ai-service__state"}>{word}</span>
      <button type="button" className="ui-button ui-button--small" aria-expanded={expanded} disabled={configured === null} onClick={onToggle}>{expanded ? "收起" : configured ? "管理 API Key" : "填写 API Key"}</button>
    </div>
    {expanded && <div className="ai-connection-form ai-settings">{children}</div>}
    {status && <p className="ai-service__status" role="status">{status}</p>}
  </>;
}
