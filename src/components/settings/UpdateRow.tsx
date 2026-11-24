import { useState, type ReactNode } from "react";
import { systemPlatform } from "../../platform/system";
import { updaterPlatform, type AvailableUpdate } from "../../platform/updater";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "downloading"; update: AvailableUpdate; progress: number | null }
  | { kind: "ready" }
  | { kind: "failed"; message: string; update?: AvailableUpdate };

const NO_NOTES = "修复问题、改进体验";

/** "软件更新" under the About card: check, download and install, then restart. */
export function UpdateRow() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  const checkNow = async () => {
    setState({ kind: "checking" });
    try {
      const update = await updaterPlatform.check();
      setState(update ? { kind: "available", update } : { kind: "latest" });
    } catch (error) {
      console.error("Could not check for updates", error);
      setState({ kind: "failed", message: "没能连上更新服务器，检查网络后再试一次。" });
    }
  };

  const install = async (update: AvailableUpdate) => {
    setState({ kind: "downloading", update, progress: null });
    try {
      await update.install((progress) => setState({ kind: "downloading", update, progress }));
      setState({ kind: "ready" });
    } catch (error) {
      console.error("Could not install the update", error);
      setState({ kind: "failed", message: "新版本没能下载安装，检查网络后再试一次。", update });
    }
  };

  const restart = () => void systemPlatform.restart().catch((error: unknown) => {
    console.error("Could not restart after the update", error);
    setState({ kind: "failed", message: "没能自动重启，从菜单栏图标退出 AI Pet 再打开就是新版本。" });
  });

  if (!updaterPlatform.isNative) {
    return <Row title="软件更新" detail="只在安装好的桌面应用里可用" />;
  }
  switch (state.kind) {
    case "idle":
    case "checking":
    case "latest":
      return (
        <Row title="软件更新" detail={state.kind === "checking" ? "正在检查…" : state.kind === "latest" ? "已经是最新版本" : "有新版本时，宠物也会提醒你"}>
          <button type="button" className="ui-button ui-button--small" disabled={state.kind === "checking"} onClick={() => void checkNow()}>检查更新</button>
        </Row>
      );
    case "available":
      return (
        <Row title={`有新版本 ${state.update.version}`} detail={state.update.notes || NO_NOTES}>
          <button type="button" className="ui-button ui-button--small ui-button--primary" onClick={() => void install(state.update)}>下载并安装</button>
        </Row>
      );
    case "downloading":
      return (
        <Row title={`正在更新到 ${state.update.version}`} detail={state.progress === null ? "正在下载…" : `正在下载 ${Math.round(state.progress * 100)}%`}>
          <progress className="update-progress" aria-label="下载进度" max={1} value={state.progress ?? undefined} />
        </Row>
      );
    case "ready":
      return (
        <Row title="新版本已经装好" detail="重启后就是新版本">
          <button type="button" className="ui-button ui-button--small ui-button--primary" onClick={restart}>重启</button>
        </Row>
      );
    case "failed": {
      const { update } = state;
      return (
        <Row title="软件更新" detail={state.message}>
          <button type="button" className="ui-button ui-button--small" onClick={() => void (update ? install(update) : checkNow())}>再试一次</button>
        </Row>
      );
    }
  }
}

function Row({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="settings-row update-row" aria-live="polite">
      <div className="settings-row__body"><strong>{title}</strong><span>{detail}</span></div>
      {children}
    </div>
  );
}
