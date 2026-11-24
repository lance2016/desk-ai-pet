/**
 * Sorts the errors of the DeepSeek, MiMo, and CosyVoice native commands, so the user is
 * told whether to fix a key or check the network. The phrases below match the
 * messages of `failureMessage` (`src/ai/provider.ts`), `src-tauri/src/llm.rs`,
 * `src-tauri/src/mimo.rs`, `src-tauri/src/cosyvoice.rs` and `src-tauri/src/api_keys.rs`.
 */
export type ServiceError = "missing-key" | "bad-key" | "model" | "key-storage" | "billing" | "rate" | "busy" | "rejected" | "running" | "voice" | "network" | "other";

const RULES: ReadonlyArray<[ServiceError, RegExp]> = [
  ["missing-key", /not configured|请先.*配置.*API Key/],
  ["bad-key", /Key 无效/],
  ["model", /模型名/],
  ["key-storage", /本机 API Key/],
  ["billing", /余额(?:或调用额度)?不足/],
  ["rate", /过于频繁/],
  ["busy", /服务繁忙/],
  ["rejected", /发不出去/],
  ["running", /还在回复/],
  ["voice", /克隆的声音|克隆音色|这段声音/],
  ["network", /网络|network|中断|request failed/i],
];

export function classifyServiceError(text: string): ServiceError {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

/** What to tell the user. Key problems are fixed in settings; the rest by waiting or checking the connection. */
export function serviceErrorMessage(service: "DeepSeek" | "MiMo" | "CosyVoice", kind: ServiceError): string {
  switch (kind) {
    case "missing-key": return service === "CosyVoice" ? "还没配置阿里云百炼 API Key，去设置里填上就能用。" : `还没配置 ${service} API Key，去设置里填上就能用。`;
    case "bad-key": return service === "CosyVoice" ? "阿里云百炼 API Key 无效或地域不匹配，去设置里检查一下。" : `${service} API Key 无效，去设置里检查一下。`;
    case "model": return `${service} 不认识这个模型名，检查一下拼写，或者换回内置的模型。`;
    case "key-storage": return "本机 API Key 无法读写，请检查应用数据目录权限并重新保存。";
    case "billing": return `${service} 账户余额不足，充值后再试。`;
    case "rate": return `${service} 请求太频繁了，稍等一会儿再试。`;
    case "busy": return `${service} 服务繁忙，稍后再试。`;
    case "rejected": return "这条消息发不出去，换个说法或新开一段聊天。";
    case "running": return "上一条还在回复，稍等一下。";
    case "voice": return "这个克隆的声音用不了，去设置里换一个声音，或者重新录一段。";
    case "network": return `连不上 ${service}，检查网络后再试一次。`;
    case "other": return `${service} 出了点问题，请稍后再试。`;
  }
}

/** True when the fix is in settings rather than in waiting or the network. */
export const isKeyProblem = (kind: ServiceError) => kind === "missing-key" || kind === "bad-key" || kind === "key-storage";
