/**
 * 模型能力表：服务端按模型分别限制「是否接受 latest_reminder」与「单轮输入上限」，
 * 客户端必须在发送前按模型做预校验，否则会拿到 400。
 * 未知模型按最宽松处理，避免误伤。
 */
export type ModelCaps = {
  /** 是否支持 role: latest_reminder（日期/位置快照） */
  supportsReminder: boolean
  /** 单轮输入 token 上限；null 表示不设限 */
  inputLimit: number | null
}

const CAPS: { match: RegExp; caps: ModelCaps }[] = [
  { match: /deepseek-v4-pro/i, caps: { supportsReminder: false, inputLimit: 32768 } },
  { match: /deepseek-flash/i, caps: { supportsReminder: true, inputLimit: null } },
]

const DEFAULT: ModelCaps = { supportsReminder: true, inputLimit: null }

export const modelCaps = (model: string | null | undefined): ModelCaps => {
  if (!model) {
    return DEFAULT
  }
  return CAPS.find((entry) => entry.match.test(model))?.caps ?? DEFAULT
}
