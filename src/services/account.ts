import { create } from 'zustand'
import { fetchBalance, type AccountBalance } from './api/client.js'

/** 余额多久算「新鲜」：面板反复开关时不重复请求，超过就允许再拉一次 */
const STALE_MS = 60_000

/** 账户余额：拿到 API Key 后拉一次，失败保留上次结果（不清空，避免金额突然消失） */
type AccountState = {
  balance: AccountBalance | null
  loading: boolean
  /** 最近一次成功拉取用的 API Key */
  loadedFor: string | null
  /** 最近一次成功拉取的时间戳，0 表示从没成功过 */
  loadedAt: number
  /** 最近一次失败：界面据此提示「显示的是上次结果」 */
  error: boolean
}

export const useAccount = create<AccountState>(() => ({
  balance: null,
  loading: false,
  loadedFor: null,
  loadedAt: 0,
  error: false,
}))

/**
 * 拉余额。
 *
 * 以前用 `loadedFor === apiKey` 去重，等于**拿到值之后永远不再刷新** ——
 * 用户充值/消耗后必须重启 App 才看得到新数字。现在改成按时间判新鲜度，
 * 并用 `force` 支持点击刷新。
 */
export const loadBalance = async (
  apiKey: string,
  options: { force?: boolean } = {}
): Promise<void> => {
  const { loading, loadedFor, loadedAt } = useAccount.getState()
  if (!apiKey || loading) {
    return
  }
  const fresh = loadedFor === apiKey && Date.now() - loadedAt < STALE_MS
  if (fresh && !options.force) {
    return
  }
  useAccount.setState({ loading: true })
  try {
    const balance = await fetchBalance(apiKey)
    useAccount.setState({ balance, loading: false, loadedFor: apiKey, loadedAt: Date.now(), error: false })
  } catch {
    // 失败保留旧值：宁可显示「上次结果」，也不要让余额变成空白
    useAccount.setState({ loading: false, error: true })
  }
}

/** 点击余额时强制刷新 */
export const refreshBalance = (apiKey: string): Promise<void> =>
  loadBalance(apiKey, { force: true })

/** 清空账户状态：删除 API KEY 时调用，余额不再残留 */
export const clearAccount = (): void => {
  useAccount.setState({
    balance: null,
    loading: false,
    loadedFor: null,
    loadedAt: 0,
    error: false,
  })
}

/** 余额展示：人民币用 ¥，其它币种用代码前缀 */
export const formatBalance = (balance: AccountBalance | null): string | null => {
  if (!balance) {
    return null
  }
  const value = Number(balance.total)
  if (!Number.isFinite(value)) {
    return null
  }
  return balance.currency.toUpperCase() === 'CNY'
    ? `¥${value.toFixed(2)}`
    : `${balance.currency.toUpperCase()} ${value.toFixed(2)}`
}

/** 账号展示：sk- 前缀保留，中间全部打码，末尾保留三个字符 */
export const maskApiKey = (apiKey: string): string => {
  const key = apiKey.trim()
  if (key.length <= 6) {
    return 'sk-*****'
  }
  return `sk-*****${key.slice(-3)}`
}
