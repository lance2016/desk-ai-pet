import { useCallback, useEffect, useState } from "react";
import { systemPlatform, type LaunchAtLogin } from "../../platform/system";

const DESCRIPTIONS: Record<LaunchAtLogin, string> = {
  on: "开机后宠物自动出现，提醒不会漏掉",
  off: "开机后宠物自动出现，提醒不会漏掉",
  approval: "被系统设置关掉了，要在「登录项」里打开",
  unavailable: "只在安装好的桌面应用里可用",
};

/** "开机时打开": a macOS login item for the app, which System Settings can also switch. */
export function LaunchAtLoginRow({ onError }: { onError: (message: string | null) => void }) {
  const [state, setState] = useState<LaunchAtLogin | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    systemPlatform.launchAtLogin().then(setState).catch((error: unknown) => { console.error("Could not read launch at login", error); onError("读不到开机启动的状态，可以在「系统设置 → 通用 → 登录项」里查看。"); });
  }, [onError]);
  // The user may change it in System Settings and come back.
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    try {
      setState(await systemPlatform.setLaunchAtLogin(state !== "on"));
      onError(null);
    } catch (error) {
      console.error("Could not change launch at login", error);
      onError("开机启动没能改过来，可以在「系统设置 → 通用 → 登录项」里手动设置。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row">
      <div className="settings-row__body"><strong>开机时打开</strong><span>{DESCRIPTIONS[state ?? "off"]}</span></div>
      {state === "approval"
        ? <button type="button" className="ui-button ui-button--small" onClick={() => void systemPlatform.openLoginItemsSettings()}>打开系统设置…</button>
        : <button type="button" role="switch" aria-checked={state === "on"} aria-label="开机时打开" className={state === "on" ? "toggle is-on" : "toggle"} disabled={busy || state === null || state === "unavailable"} onClick={() => void toggle()}><span /></button>}
    </div>
  );
}
