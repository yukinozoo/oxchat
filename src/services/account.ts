import { create } from 'zustand'
import { fetchBalance, type AccountBalance } from './api/client.js'

/** 账户余额：拿到 API Key 后拉一次，失败静默（不影响聊天） */
type AccountState = {
  balance: AccountBalance | null
  loading: boolean
  loadedFor: string | null
}

export const useAccount = create<AccountState>(() => ({
  balance: null,
  loading: false,
  loadedFor: null,
}))

export const loadBalance = async (apiKey: string): Promise<void> => {
  const { loading, loadedFor } = useAccount.getState()
  if (!apiKey || loading || loadedFor === apiKey) {
    return
  }
  useAccount.setState({ loading: true })
  try {
    const balance = await fetchBalance(apiKey)
    useAccount.setState({ balance, loading: false, loadedFor: apiKey })
  } catch {
    useAccount.setState({ loading: false, loadedFor: null })
  }
}

/** 清空账户状态：删除 API KEY 时调用，余额不再残留 */
export const clearAccount = (): void => {
  useAccount.setState({ balance: null, loading: false, loadedFor: null })
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
