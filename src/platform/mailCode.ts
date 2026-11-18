import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import type { MailCodeUpdate } from "../types";

/** Must match EVENT and the commands in src-tauri/src/mail_code.rs. */
const MAIL_CODE_EVENT = "pet://mail-code";

const updateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("waiting") }),
  z.object({ kind: z.literal("found"), code: z.string().min(1), sender: z.string(), copied: z.boolean() }),
  z.object({ kind: z.literal("unrecognized"), sender: z.string() }),
  z.object({ kind: z.literal("timeout") }),
  z.object({ kind: z.literal("cancelled") }),
  z.object({ kind: z.literal("unset") }),
  z.object({ kind: z.literal("failed"), message: z.string().min(1) }),
]) satisfies z.ZodType<MailCodeUpdate>;

/** What the code rules make of pasted text. `word` is the one that marked it as a verification email. */
const trialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), code: z.string().min(1), word: z.string() }),
  z.object({ kind: z.literal("unrecognized"), word: z.string() }),
  z.object({ kind: z.literal("not_code") }),
]);

export type MailCodeTrial = z.infer<typeof trialSchema>;

function requireNative() { if (!isTauri()) throw new Error("邮箱功能需要在桌面应用中使用。"); }

/** The 163 mailbox behind "查收验证码". In a plain browser there is none and nothing is reported. */
export const mailCodePlatform = {
  /** The saved address, or null when no mailbox is set up. */
  async account(): Promise<string | null> { return isTauri() ? invoke<string | null>("mail_account") : null; },
  /** Logs in once to check the authorization code, then keeps both in the keychain. Rejects with a message for the user. */
  async saveAccount(address: string, password: string): Promise<void> { requireNative(); await invoke("mail_save_account", { address, password }); },
  async removeAccount(): Promise<void> { requireNative(); await invoke("mail_remove_account"); },
  /** Runs the same rules as "查收验证码" on pasted text. Rejects with a message for the user. */
  async tryText(subject: string, body: string): Promise<MailCodeTrial> {
    requireNative();
    return trialSchema.parse(await invoke("mail_code_try", { subject, body }));
  },
  /** Stops the running wait; "cancelled" then comes through `onUpdate`. */
  async cancel(): Promise<void> { if (isTauri()) await invoke("mail_code_cancel"); },
  /** Calls `handler` as a wait started from the pet menu moves on. Returns an unsubscribe function. */
  onUpdate(handler: (update: MailCodeUpdate) => void): () => void {
    if (!isTauri()) return () => {};
    const unlisten = listen(MAIL_CODE_EVENT, (event) => {
      const parsed = updateSchema.safeParse(event.payload);
      if (parsed.success) handler(parsed.data);
      else console.warn("Ignoring a malformed mail code update", parsed.error);
    });
    return () => { unlisten.then((stop) => stop()).catch((error: unknown) => console.error("Failed to stop listening for mail codes", error)); };
  },
};
