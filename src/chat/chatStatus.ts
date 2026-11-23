import type { ServiceError } from "./serviceErrors";

/** What went wrong last: a DeepSeek error, or a failed transcription ("voice"). */
export type ChatFailure = Exclude<ServiceError, "missing-key"> | "voice";

export interface ChatStatusInput {
  /** null while the saved key is still being checked. */
  keyMissing: boolean | null;
  pending: boolean;
  recording: boolean;
  transcribing: boolean;
  failure: ChatFailure | null;
}

export interface ChatStatus {
  label: string;
  tone: "ready" | "busy" | "warning" | "error";
}

const FAILURES: Record<ChatFailure, ChatStatus> = {
  network: { label: "网络错误", tone: "error" },
  "bad-key": { label: "API Key 无效", tone: "error" },
  model: { label: "模型名不对", tone: "error" },
  billing: { label: "余额不足", tone: "error" },
  rate: { label: "请求太频繁", tone: "warning" },
  busy: { label: "服务繁忙", tone: "warning" },
  rejected: { label: "发送失败", tone: "error" },
  running: { label: "稍等", tone: "warning" },
  "key-storage": { label: "本机配置不可用", tone: "warning" },
  other: { label: "出错了", tone: "error" },
  voice: { label: "识别失败", tone: "error" },
};

/** The chat window's status line: work in progress first, then setup, then the last failure. */
export function chatStatus({ keyMissing, pending, recording, transcribing, failure }: ChatStatusInput): ChatStatus {
  if (recording) return { label: "录音中", tone: "busy" };
  if (transcribing) return { label: "识别中", tone: "busy" };
  if (pending) return { label: "生成中", tone: "busy" };
  if (keyMissing === null) return { label: "检查中", tone: "busy" };
  if (keyMissing) return { label: "未配置", tone: "warning" };
  if (failure) return FAILURES[failure];
  return { label: "随时可聊", tone: "ready" };
}
