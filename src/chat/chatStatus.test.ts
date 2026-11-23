import { describe, expect, it } from "vitest";
import { chatStatus, type ChatStatusInput } from "./chatStatus";

const idle: ChatStatusInput = { keyMissing: false, pending: false, recording: false, transcribing: false, failure: null };

describe("chatStatus", () => {
  it("is on standby when nothing is going on", () => {
    expect(chatStatus(idle)).toEqual({ label: "随时可聊", tone: "ready" });
  });

  it("shows work in progress first", () => {
    expect(chatStatus({ ...idle, recording: true, failure: "network" }).label).toBe("录音中");
    expect(chatStatus({ ...idle, transcribing: true }).label).toBe("识别中");
    expect(chatStatus({ ...idle, pending: true }).label).toBe("生成中");
  });

  it("tells a missing key apart from a network failure", () => {
    expect(chatStatus({ ...idle, keyMissing: true })).toEqual({ label: "未配置", tone: "warning" });
    expect(chatStatus({ ...idle, failure: "network" })).toEqual({ label: "网络错误", tone: "error" });
    expect(chatStatus({ ...idle, failure: "bad-key" })).toEqual({ label: "API Key 无效", tone: "error" });
  });

  it("names a failed transcription", () => {
    expect(chatStatus({ ...idle, failure: "voice" })).toEqual({ label: "识别失败", tone: "error" });
  });

  it("says so while the key is still being checked", () => {
    expect(chatStatus({ ...idle, keyMissing: null }).label).toBe("检查中");
  });
});
