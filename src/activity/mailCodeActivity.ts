import type { ActivityUpdate, MailCodeUpdate } from "../types";

/** The id "查收验证码" reports under. A click on its chip stops the wait. */
export const MAIL_CODE_ACTIVITY = "mail_code";

/** What the pet says about "查收验证码". The native side has already copied a found code. */
const LINES = {
  badge: "等验证码",
  found: (code: string, sender: string) => `验证码 ${code}，已复制（${sender}）`,
  notCopied: (code: string, sender: string) => `验证码 ${code}（${sender}），没能复制，手动输一下吧`,
  unrecognized: (sender: string) => `收到一封验证码邮件（${sender}），但我没认出码，去邮箱看一眼吧`,
  timeout: "一直没等到验证码，可以再点一次查收",
  unset: "先在设置里加个 163 邮箱吧",
};

const BASE = { id: MAIL_CODE_ACTIVITY, label: LINES.badge, icon: "mail" } as const;

/**
 * How a step of "查收验证码" shows on the pet. The user asked for the code and is
 * waiting for it, so a found one is a result that stays up; `say` is a passing
 * line for when the settings window opens at the same time.
 */
export function mailCodeActivity(update: MailCodeUpdate): { activity: ActivityUpdate; say?: string } {
  switch (update.kind) {
    case "waiting":
      return { activity: { ...BASE, state: "running", cancellable: true } };
    case "cancelled":
      return { activity: { ...BASE, state: "cancelled" } };
    case "found":
      return { activity: { ...BASE, state: "done", text: update.copied ? LINES.found(update.code, update.sender) : LINES.notCopied(update.code, update.sender) } };
    case "unrecognized":
      return { activity: { ...BASE, state: "failed", text: LINES.unrecognized(update.sender) } };
    case "timeout":
      return { activity: { ...BASE, state: "failed", text: LINES.timeout } };
    case "unset":
      return { activity: { ...BASE, state: "cancelled" }, say: LINES.unset };
    case "failed":
      return { activity: { ...BASE, state: "failed", text: update.message } };
  }
}
