import { describe, expect, it } from "vitest";
import { classifyServiceError, serviceErrorMessage } from "./serviceErrors";

describe("classifyServiceError", () => {
  it("tells a missing key from a rejected one", () => {
    expect(classifyServiceError("API key is not configured")).toBe("missing-key");
    expect(classifyServiceError("请先在设置 → 语音中配置 MiMo API Key")).toBe("missing-key");
    expect(classifyServiceError("API Key 无效，请在设置中检查。")).toBe("bad-key");
    expect(classifyServiceError("MiMo API Key 无效，请在设置中检查。")).toBe("bad-key");
  });

  it("recognises account and rate problems", () => {
    expect(classifyServiceError("账户余额不足，请检查 DeepSeek 账户。")).toBe("billing");
    expect(classifyServiceError("MiMo 请求过于频繁，请稍后重试。")).toBe("rate");
  });

  it("treats connection failures as network errors", () => {
    expect(classifyServiceError("连接或回复中断，请检查网络后重试。")).toBe("network");
    expect(classifyServiceError("MiMo 请求失败，请检查网络和服务状态。")).toBe("network");
    expect(classifyServiceError("Error: Failed to start the network request")).toBe("network");
  });

  it("recognises a busy service, a refused message, a refused keychain and a reply still running", () => {
    expect(classifyServiceError("DeepSeek 服务繁忙，稍后再试。")).toBe("busy");
    expect(classifyServiceError("这条消息发不出去，换个说法或新开一段聊天。")).toBe("rejected");
    expect(classifyServiceError("没有钥匙串访问权限，请在系统弹窗里点「允许」后再试。")).toBe("keychain");
    expect(classifyServiceError("上一条还在回复，稍等一下。")).toBe("running");
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
