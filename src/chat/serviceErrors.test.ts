import { describe, expect, it } from "vitest";
import { classifyServiceError, fixedInSettings, serviceErrorMessage } from "./serviceErrors";

describe("classifyServiceError", () => {
  it("tells a missing key from a rejected one", () => {
    expect(classifyServiceError("API key is not configured")).toBe("missing-key");
    expect(classifyServiceError("请先在设置 → AI 服务中配置 MiMo API Key")).toBe("missing-key");
    expect(classifyServiceError("API Key 无效，请在设置中检查。")).toBe("bad-key");
    expect(classifyServiceError("模型名不可用，DeepSeek 不认识这个模型。")).toBe("model");
    expect(classifyServiceError("MiMo API Key 无效，请在设置中检查。")).toBe("bad-key");
  });

  it("recognises account and rate problems", () => {
    expect(classifyServiceError("账户余额不足，请检查 DeepSeek 账户。")).toBe("billing");
    expect(classifyServiceError("MiMo 请求过于频繁，请稍后重试。")).toBe("rate");
  });

  it("tells a cloned voice that cannot be used from a network problem", () => {
    expect(classifyServiceError("这个克隆的声音已经删掉了，请在设置 → AI 服务里换一个声音。")).toBe("voice");
    expect(classifyServiceError("MiMo 没能用这段声音朗读，换一段更清楚的录音再试。")).toBe("voice");
  });

  it("treats connection failures as network errors", () => {
    expect(classifyServiceError("连接或回复中断，请检查网络后重试。")).toBe("network");
    expect(classifyServiceError("MiMo 请求失败，请检查网络和服务状态。")).toBe("network");
    expect(classifyServiceError("Error: Failed to start the network request")).toBe("network");
  });

  it("recognises a busy service, a refused message, an unreadable credential and a reply still running", () => {
    expect(classifyServiceError("DeepSeek 服务繁忙，稍后再试。")).toBe("busy");
    expect(classifyServiceError("这条消息发不出去，换个说法或新开一段聊天。")).toBe("rejected");
    expect(classifyServiceError("本机 API Key 配置已损坏，请在设置里重新保存。")).toBe("key-storage");
    expect(classifyServiceError("上一条还在回复，稍等一下。")).toBe("running");
  });

  it("tells a message the provider's moderation turned down, which trying again will not fix", () => {
    expect(classifyServiceError("这条内容未能通过 DeepSeek 的审核。")).toBe("moderated");
    expect(serviceErrorMessage("DeepSeek", "moderated")).toBe("这条内容没通过 DeepSeek 的审核，换个说法再试。");
    // A cloned voice Alibaba Cloud turned down is still a voice problem.
    expect(classifyServiceError("阿里云未通过这个克隆音色的审核，请重新添加一段清晰的录音。")).toBe("voice");
  });

  it("leaves anything else as other", () => {
    expect(classifyServiceError("录音数据无效")).toBe("other");
  });
});

describe("serviceErrorMessage", () => {
  it("names the service and what to do", () => {
    expect(serviceErrorMessage("DeepSeek", "missing-key")).toContain("还没配置 DeepSeek API Key");
    expect(serviceErrorMessage("MiMo", "network")).toContain("连不上 MiMo");
  });
});

describe("fixedInSettings", () => {
  it("sends key and model name problems to settings, and leaves waiting problems alone", () => {
    expect(fixedInSettings("bad-key")).toBe(true);
    expect(fixedInSettings("model")).toBe(true);
    expect(fixedInSettings("network")).toBe(false);
    expect(fixedInSettings("busy")).toBe(false);
  });
});
