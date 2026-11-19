import { describe, expect, it } from "vitest";
import { filterLog, logText, parseLog } from "./logEntries";

const FILE = [
  "half a line cut off by the tail",
  "[2026-11-19][09:00:01][ai_pet_lib::llm][WARN] Model request failed (Some(401)): invalid key",
  "[2026-11-19][09:00:02][webview][ERROR] [chat] TypeError: x is undefined",
  "    at send (ChatPage.tsx:10)",
  "",
  "[2026-11-19][09:00:03][ai_pet_lib][INFO] panic: boom",
  "[2026-11-19][09:00:04][tao::platform][WARN] something inside Tauri",
  "[2026-11-19][09:00:05][webview][WARN] no window tag",
].join("\n");

describe("log entries", () => {
  it("reads entries, names their source and keeps stack lines with their entry", () => {
    expect(parseLog(FILE)).toEqual([
      { date: "2026-11-19", time: "09:00:01", level: "WARN", source: "原生 llm", message: "Model request failed (Some(401)): invalid key" },
      { date: "2026-11-19", time: "09:00:02", level: "ERROR", source: "聊天", message: "TypeError: x is undefined\n    at send (ChatPage.tsx:10)" },
      { date: "2026-11-19", time: "09:00:03", level: "INFO", source: "原生 主程序", message: "panic: boom" },
      { date: "2026-11-19", time: "09:00:04", level: "WARN", source: "tao::platform", message: "something inside Tauri" },
      { date: "2026-11-19", time: "09:00:05", level: "WARN", source: "界面", message: "no window tag" },
    ]);
    expect(parseLog("")).toEqual([]);
  });

  it("filters by level and by every word, ignoring case", () => {
    const entries = parseLog(FILE);
    expect(filterLog(entries, "error", "")).toHaveLength(1);
    expect(filterLog(entries, "warn", "")).toHaveLength(4);
    expect(filterLog(entries, "all", "")).toHaveLength(5);
    expect(filterLog(entries, "all", "MODEL 401").map((entry) => entry.time)).toEqual(["09:00:01"]);
    expect(filterLog(entries, "all", "聊天").map((entry) => entry.time)).toEqual(["09:00:02"]);
  });

  it("turns entries back into text for copying", () => {
    expect(logText(parseLog(FILE).slice(0, 1))).toBe("2026-11-19 09:00:01 WARN [原生 llm] Model request failed (Some(401)): invalid key");
  });
});
