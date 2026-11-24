import { toSessionSummary, type SessionSummary } from './types.js'

/**
 * 会话列表行的容错归一。
 *
 * IndexedDB 的 `getAll` 是整批反序列化：任意一条坏记录（字段缺失、结构被旧版本写坏）
 * 都会让整个读取 reject，界面表现为「会话全没了」。所以列表读取要有两层兜底：
 * ①单条记录能救就救（补默认值），②救不了的只丢自己，不连坐其他会话。
 */

/** 单行归一；返回 undefined 表示这条本身就坏了 */
export const toSummaryRow = (row: unknown): SessionSummary | undefined => {
  if (row === null || typeof row !== 'object') {
    return undefined
  }
  const value = row as Partial<SessionSummary>
  const { id, title } = value
  if (typeof id !== 'string' || !id || typeof title !== 'string') {
    return undefined
  }
  return toSessionSummary({
    id,
    title,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    ...(value.pinned ? { pinned: true } : {}),
  })
}

/** 批量归一：坏行静默丢弃，好行照常返回 */
export const summarizeRows = (rows: readonly unknown[]): SessionSummary[] => {
  const summaries: SessionSummary[] = []
  for (const row of rows) {
    const summary = toSummaryRow(row)
    if (summary) {
      summaries.push(summary)
    }
  }
  return summaries
}
