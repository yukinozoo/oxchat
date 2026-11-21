import { estimateTokens } from '../../utils/tokens.js'

/**
 * 单份文档的 token 预算。
 * 上限 95 万：服务端上下文 1M，还得给历史与输出留余量；
 * 下限 20 万：再小长文档基本读不到东西。
 */
export const DOCUMENT_BUDGET_MIN = 200_000
export const DOCUMENT_BUDGET_MAX = 950_000
export const DOCUMENT_BUDGET_STEP = 50_000
export const DOCUMENT_BUDGET_DEFAULT = 350_000

export const clampDocumentBudget = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DOCUMENT_BUDGET_DEFAULT
  }
  return Math.min(DOCUMENT_BUDGET_MAX, Math.max(DOCUMENT_BUDGET_MIN, Math.round(value)))
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
