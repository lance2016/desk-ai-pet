import { useState, type ChangeEvent } from "react";
import { listAppearances, replaceAppearances } from "../../appearance/AppearanceStore";
import { systemPlatform } from "../../platform/system";
import { worklogPlatform } from "../../platform/worklog";
import { backupFileName, createBackup, localData, parseBackup, restoreBackup, summarizeBackup, type Backup, type WorkLogAccess } from "../../storage/Backup";
import { exportWorkLog } from "../../worklog/store";
import { dialogPlatform } from "../../platform/dialog";

/** How long to let the restored data reach the disk before restarting. */
const FLUSH_WAIT_MS = 1_000;
/** Pictures make backups large, but no real one comes near this. */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

const WORK_LOG: WorkLogAccess = { exportAll: exportWorkLog, replace: (log) => worklogPlatform.replace(log) };

function dateText(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Export everything to one file, or replace everything from one. */
export function BackupSettings({ onError }: { onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);

  const exportData = async () => {
    setBusy(true);
    setExported(false);
    try {
      const backup = createBackup(localData(), await listAppearances(), await exportWorkLog());
      setExported(await systemPlatform.saveBackup(JSON.stringify(backup), backupFileName()));
      onError(null);
    } catch (error) {
      console.error("Could not export the data", error);
      onError("没能导出。换一个保存位置（比如「文稿」）再试一次。");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setExported(false);
    if (file.size > MAX_BACKUP_BYTES) {
      onError("这个文件太大了，不像是 AI Pet 的备份。");
      return;
    }
    let backup: Backup;
    try {
      backup = parseBackup(await file.text());
      onError(null);
    } catch (error) {
      console.warn("Rejected a backup file", error);
      onError("这个文件不是 AI Pet 的备份，或者已经损坏。");
      return;
    }
    // Everything here is replaced, so the native alert asks first, as for any step that cannot be undone.
    const summary = summarizeBackup(backup);
    const contents = `提醒 ${summary.reminders} 条、备忘 ${summary.notes} 条${summary.loggedDays > 0 ? `、${summary.loggedDays} 天的工作日志` : ""}${summary.pictures > 0 ? `、动作图片 ${summary.pictures} 张` : ""}`;
    try {
      const replace = await dialogPlatform.confirm({
        message: `恢复 ${dateText(summary.exportedAt)} 的备份？`,
        detail: `备份里有${contents}。现在的数据会被替换，不能撤销；宠物会重新打开。API Key 不在备份里，可能要重新填。`,
        action: "替换并重新打开",
      });
      if (replace) await restore(backup);
    } catch (error) { console.error("Could not ask before restoring", error); }
  };

  const restore = async (backup: Backup) => {
    setBusy(true);
    try {
      await restoreBackup(backup, replaceAppearances, WORK_LOG);
    } catch (error) {
      setBusy(false);
      console.error("Could not restore the backup", error);
      onError("没能恢复，现有数据没有改动。请再试一次。");
      return;
    }
    // WebKit writes local storage to disk a moment later; restarting at once could lose the restored data.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
    try {
      await systemPlatform.restart();
    } catch (error) {
      setBusy(false);
      console.error("Could not restart after restoring", error);
      onError("数据已经恢复，但没能自动重新打开。请从菜单栏图标退出 AI Pet，再打开。");
    }
  };

  return (
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>导出数据</strong><span>{exported ? "已导出。换电脑或重装后，用「从备份恢复」导回来。" : "提醒、备忘、工作日志、聊天记录和设置存成一个文件，不含 API Key"}</span></div>
        <button type="button" className="ui-button ui-button--small" disabled={busy} onClick={() => void exportData()}>导出…</button>
      </div>
      <div className="settings-row">
        <div className="settings-row__body"><strong>从备份恢复</strong><span>{busy ? "正在恢复，完成后宠物会重新打开…" : "替换这台电脑上的数据，宠物会重新打开"}</span></div>
        <label className={busy ? "ui-button ui-button--small icon-upload is-disabled" : "ui-button ui-button--small icon-upload"}>
          <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void pick(event)} />选择文件…
        </label>
      </div>
    </div>
  );
}
