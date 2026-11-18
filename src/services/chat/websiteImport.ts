import type { Session } from './types.js'

/** 原生「官网导入」插件的能力子集 */
type NativeWebsiteImport = {
  isLoggedIn: () => Promise<{ loggedIn: boolean }>
  login: (options: { url?: string }) => Promise<{ loggedIn: boolean }>
  logout: () => Promise<void>
  listSessions: () => Promise<{ data: string; path?: string; debug?: string }>
  fetchSession: (options: { id: string }) => Promise<{ data: string }>
  downloadArchive: (options: { url: string }) => Promise<{ path: string; bytes: number }>
  exportAll: () => Promise<{ data: string }>
  downloadExportHistory: () => Promise<{ data: string }>
  exportArchive: (options: { url?: string }) => Promise<{ path: string }>
}

type CapacitorWindow = Window & {
  Capacitor?: { Plugins?: { WebsiteImport?: NativeWebsiteImport } }
}

const plugin = (): NativeWebsiteImport | undefined =>
  (window as CapacitorWindow).Capacitor?.Plugins?.WebsiteImport

/** 只有原生壳支持内嵌登录；网页版（GitHub Pages）没有这个能力 */
export const websiteImportAvailable = (): boolean => Boolean(plugin())

const require = (): NativeWebsiteImport => {
  const instance = plugin()
  if (!instance) {
    throw new Error('website import unavailable')
  }
  return instance
}

export const isWebsiteLoggedIn = async (): Promise<boolean> => {
  if (!plugin()) {
    return false
  }
  const { loggedIn } = await require().isLoggedIn()
  return loggedIn
}

/** 打开 App 内的官网登录页；成功后凭据保存在本机 */
export const loginWebsite = async (): Promise<boolean> => {
  const { loggedIn } = await require().login({})
  return loggedIn
}

export const logoutWebsite = async (): Promise<void> => {
  if (plugin()) {
    await require().logout()
  }
}

/** 官网对话摘要 */
export type WebsiteSession = {
  id: string
  title: string
  updatedAt: number
}

const biz = (raw: unknown): Record<string, unknown> => {
  const root = raw as Record<string, unknown>
  const data = (root?.data ?? {}) as Record<string, unknown>
  const inner = (data?.biz_data ?? data ?? root) as Record<string, unknown>
  return inner
}

const secondsToMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 官网时间戳是秒；已有 13 位的按毫秒处理
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return Date.now()
}

const looksLikeSession = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const item = value as Record<string, unknown>
  const id = item.id ?? item.chat_session_id ?? item.session_id
  return id !== undefined && id !== null && (typeof item.title === 'string' || 'title' in item)
}

/** 兜底：在任意嵌套层级里找形似会话的对象，应对官网返回结构变化 */
const collectSessions = (node: unknown, out: Record<string, unknown>[], depth = 0): void => {
  if (depth > 6 || out.length > 500) {
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (looksLikeSession(item)) {
        out.push(item)
      } else {
        collectSessions(item, out, depth + 1)
      }
    }
    return
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectSessions(value, out, depth + 1)
    }
  }
}

/** 解析官网对话列表；字段名兼容几种常见写法，最后兜底做深度搜索 */
export const parseSessionList = (json: string): WebsiteSession[] => {
  const payload = JSON.parse(json) as unknown
  const inner = biz(payload)
  const direct = (inner.chat_sessions ?? inner.sessions ?? inner.list ?? []) as unknown[]
  const list: Record<string, unknown>[] = []
  if (Array.isArray(direct)) {
    for (const item of direct) {
      if (item && typeof item === 'object') {
        list.push(item as Record<string, unknown>)
      }
    }
  }
  if (list.length === 0) {
    collectSessions(payload, list)
  }
  return list
    .map((session) => {
      const id = session.id ?? session.session_id ?? session.chat_session_id
      if (id === undefined || id === null) {
        return null
      }
      return {
        id: String(id),
        title:
          typeof session.title === 'string' && session.title.trim()
            ? session.title
            : '未命名对话',
        updatedAt: secondsToMs(session.updated_at ?? session.inserted_at ?? session.updatedAt),
      }
    })
    .filter((item): item is WebsiteSession => item !== null)
}

/** 原始响应摘要：诊断时展示，便于按实际结构修正解析 */
export const summarizeResponse = (json: string, limit = 400): string =>
  json.length > limit ? `${json.slice(0, limit)}…` : json

/**
 * 把官网消息内容拼成纯文本。
 * 官网的助手消息 content 常为空字符串，正文放在 fragments 里，
 * 因此字符串为空时必须继续往下找，否则助手回复会整条丢失。
 */
const extractText = (message: Record<string, unknown>): string => {
  const content = message.content
  const direct = typeof content === 'string' ? content : ''
  if (direct.trim()) {
    return direct
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        const item = part as Record<string, unknown>
        return typeof item.content === 'string' ? item.content : ''
      })
      .join('')
    if (joined.trim()) {
      return joined
    }
  }
  const fragments = message.fragments
  if (Array.isArray(fragments)) {
    const all: string[] = []
    let response = ''
    for (const part of fragments) {
      const item = part as Record<string, unknown>
      const text = typeof item.content === 'string' ? item.content : ''
      if (!text.trim()) {
        continue
      }
      all.push(text)
      // 优先取正文片段，避免把思考过程拼进回答
      if (String(item.type ?? '').toUpperCase() === 'RESPONSE') {
        response += text
      }
    }
    if (response.trim()) {
      return response
    }
    if (all.length > 0) {
      return all.join('\n\n')
    }
  }
  return direct
}

/**
 * 官网对话详情 → 本地会话：只保留正文，附件与思考过程暂不迁移。
 * 官网返回结构随版本变化，这里按“消息数组 + 角色字段”做宽松解析。
 */
export const parseSessionDetail = (json: string, fallbackTitle: string): Session => {
  const payload = JSON.parse(json) as unknown
  const inner = biz(payload)
  const session = (inner.chat_session ?? inner.session ?? {}) as Record<string, unknown>
  const rawMessages = (inner.chat_messages ?? inner.messages ?? []) as unknown[]
  const now = Date.now()
  const messages: Session['messages'] = []
  for (const [index, item] of rawMessages.entries()) {
    const message = item as Record<string, unknown>
    const role = String(message.role ?? '').toUpperCase()
    const text = extractText(message).trim()
    if (!text) {
      continue
    }
    const id = `w-${index}`
    const createdAt = secondsToMs(message.inserted_at ?? message.created_at ?? now)
    if (role === 'USER' || role === 'HUMAN') {
      messages.push({ id, role: 'user', content: text, files: [], createdAt })
    } else if (role === 'ASSISTANT' || role === 'AI') {
      messages.push({
        id,
        role: 'assistant',
        createdAt,
        model: null,
        prefix: false,
        status: 'done',
        blocks: [{ type: 'text', text }],
      })
    }
  }
  const title = typeof session.title === 'string' && session.title.trim()
    ? session.title
    : fallbackTitle
  // 不要设置 rootMessageId：留空表示线性消息列表，界面会按顺序全部展示。
  // 一旦设了根节点却没有 selectedChildId，遍历到第一条就中断，助手回复会整条不显示。
  return {
    id: `website-${String(session.id ?? Date.now())}`,
    title,
    createdAt: secondsToMs(session.inserted_at ?? now),
    updatedAt: secondsToMs(session.updated_at ?? now),
    messages,
  }
}

/** 最近一次列表接口的原始响应与鉴权诊断：解析为空时用于定位问题 */
let lastRawList = ''
let lastDebug = ''

export const rawListResponse = (): string => lastRawList
export const listDebugInfo = (): string => lastDebug

export const listWebsiteSessions = async (): Promise<WebsiteSession[]> => {
  const { data, debug, path } = await require().listSessions()
  lastRawList = data
  lastDebug = [debug, path ? `path=${path}` : ''].filter(Boolean).join('; ')
  return parseSessionList(data)
}

export const fetchWebsiteSession = async (
  id: string,
  title: string
): Promise<Session> => {
  const { data } = await require().fetchSession({ id })
  return parseSessionDetail(data, title)
}

/** 官网导入的取消标志：并发拉取时共用一个，任一时刻可停 */
let websiteCancelled = false

export const resetWebsiteCancel = (): void => {
  websiteCancelled = false
}

export const cancelWebsiteImport = (): void => {
  websiteCancelled = true
}

export const isWebsiteImportCancelled = (): boolean => websiteCancelled

/** 下载官网导出的压缩包（预签名链接，7 天有效） */
export const downloadExportArchive = async (
  url: string
): Promise<{ path: string; bytes: number }> => require().downloadArchive({ url })

/** 触发官网导出（GET /api/v0/export_all） */
export const triggerExportAll = async (): Promise<void> => {
  await require().exportAll()
}

/** 查询导出状态（GET /api/v0/download_export_history），从返回里找出压缩包链接 */
export const fetchExportLink = async (): Promise<string | null> => {
  const { data } = await require().downloadExportHistory()
  const payload = JSON.parse(data) as unknown
  return findZipUrl(payload)
}

/** 递归找形如 zip 下载地址的字符串：导出接口会变化，不写死字段路径 */
const findZipUrl = (node: unknown, depth = 0): string | null => {
  if (depth > 6) {
    return null
  }
  if (typeof node === 'string') {
    return /^https?:\/\//.test(node) && /\.zip/i.test(node) ? node : null
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findZipUrl(value, depth + 1)
      if (found) {
        return found
      }
    }
  }
  return null
}

/** 自动导出：App 内打开官网，自动完成「设置 → 数据管理 → 导出 → 下载」 */
export const autoExportArchive = async (): Promise<{ path: string }> =>
  require().exportArchive({})

/** 不解直接返回详情原始 JSON：用于诊断字段结构 */
export const fetchWebsiteSessionRaw = async (id: string): Promise<string> => {
  const { data } = await require().fetchSession({ id })
  return data
}
