import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Confirmation {
  /** The question, e.g. "删除这个角色？". */
  message: string;
  /** What will happen, in a sentence. */
  detail: string;
  /** The confirming button, e.g. "删除". */
  action: string;
}

export const dialogPlatform = {
  /**
   * Asks with a native alert before a step that cannot be undone. Return confirms,
   * Escape cancels. Must match `confirm_action` in `src-tauri/src/alert.rs`.
   */
  async confirm({ message, detail, action }: Confirmation): Promise<boolean> {
    // Outside the app (`pnpm dev`) the browser's own dialog stands in. Inside the app
    // `window.confirm` cannot be used: the dialog plugin makes it asynchronous.
    if (!isTauri()) return window.confirm(`${message}\n${detail}`);
    return invoke<boolean>("confirm_action", { message, detail, action });
  },
};
