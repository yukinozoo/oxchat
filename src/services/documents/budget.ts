import { estimateTokens } from '../../utils/tokens.js'

/**
 * 单份文档的 token 预算：不再让用户手调，按「上下文窗口的 35%」自动算，
 * 再用模型的单轮输入上限压一道（v4-pro 只有 32K，不压的话文档必发不出去）。
 *
 * 上限 95 万：服务端上下文 1M，还得给历史与输出留余量；
 * 下限 2 千：窗口本身很小时至少还能读到一点内容。
 */
export const DOCUMENT_BUDGET_RATIO = 0.35
export const DOCUMENT_BUDGET_MIN = 2_000
export const DOCUMENT_BUDGET_MAX = 950_000
/** 旧版本手调过预算时用来兜底读取的默认值 */
export const DOCUMENT_BUDGET_DEFAULT = 350_000

/** 模型单轮输入上限只给文档用六成，剩下的留给历史、system 与输出 */
const MODEL_SHARE = 0.6

export const clampDocumentBudget = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DOCUMENT_BUDGET_DEFAULT
  }
  return Math.min(DOCUMENT_BUDGET_MAX, Math.max(DOCUMENT_BUDGET_MIN, Math.round(value)))
}

/**
 * 一份文档最多能带多少 token：
 * min(窗口 × 35%, 模型单轮上限 × 60%, 95 万)，下限 2 千。
 * 窗口设成「不限」(<=0) 时按 1M 算；模型没有 hard limit 时只看窗口。
 */
export const documentBudgetFor = (contextWindow: number, inputLimit: number | null): number => {
  const window = contextWindow > 0 ? contextWindow : 1_000_000
  const byWindow = window * DOCUMENT_BUDGET_RATIO
  const byModel = inputLimit && inputLimit > 0 ? inputLimit * MODEL_SHARE : Infinity
  return Math.max(
    DOCUMENT_BUDGET_MIN,
    Math.min(DOCUMENT_BUDGET_MAX, Math.round(Math.min(byWindow, byModel)))
  )
}

export type TruncatedDocument = { text: string; ratio: number; tokens: number }

/** 按 token 预算截断纯文本：超预算就按比例切，返回实际保留比例 */
export const truncateToBudget = (text: string, budgetTokens: number): TruncatedDocument => {
  const tokens = estimateTokens(text)
  if (tokens <= budgetTokens) {
    return { text, ratio: 1, tokens }
  }
  const keep = Math.max(1, Math.floor((text.length * budgetTokens) / tokens))
  return { text: text.slice(0, keep), ratio: keep / text.length, tokens: budgetTokens }
}
