/**
 * Sorts the errors of the DeepSeek and MiMo native commands, so the user is
 * told whether to fix a key or check the network. The phrases below match the
 * messages in `src-tauri/src/chat.rs` and `src-tauri/src/mimo.rs`.
 */
export type ServiceError = "missing-key" | "bad-key" | "model" | "keychain" | "billing" | "rate" | "busy" | "rejected" | "running" | "network" | "other";

const RULES: ReadonlyArray<[ServiceError, RegExp]> = [
  ["missing-key", /not configured|请先.*配置.*API Key/],
  ["bad-key", /Key 无效/],
  ["model", /模型名/],
  ["keychain", /钥匙串/],
  ["billing", /余额不足/],
  ["rate", /过于频繁/],
  ["busy", /服务繁忙/],
  ["rejected", /发不出去/],
  ["running", /还在回复/],
  ["network", /网络|network|中断|request failed/i],
];

export function classifyServiceError(text: string): ServiceError {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

/** What to tell the user. Key problems are fixed in settings; the rest by waiting or checking the connection. */
export function serviceErrorMessage(service: "DeepSeek" | "MiMo", kind: ServiceError): string {
  switch (kind) {
    case "missing-key": return `还没配置 ${service} API Key，去设置里填上就能用。`;
    case "bad-key": return `${service} API Key 无效，去设置里检查一下。`;
    case "model": return `${service} 不认识这个模型名，检查一下拼写，或者换回内置的模型。`;
    case "keychain": return "没有钥匙串访问权限。再试一次，系统弹窗出来时点「允许」。";
    case "billing": return `${service} 账户余额不足，充值后再试。`;
    case "rate": return `${service} 请求太频繁了，稍等一会儿再试。`;
    case "busy": return `${service} 服务繁忙，稍后再试。`;
    case "rejected": return "这条消息发不出去，换个说法或新开一段聊天。";
    case "running": return "上一条还在回复，稍等一下。";
    case "network": return `连不上 ${service}，检查网络后再试一次。`;
    case "other": return `${service} 出了点问题，请稍后再试。`;
  }
}

/** True when the fix is in settings rather than in waiting or the network. */
export const isKeyProblem = (kind: ServiceError) => kind === "missing-key" || kind === "bad-key";
