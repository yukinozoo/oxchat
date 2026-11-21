import { toBase64 } from '../../utils/base64.js'
import { exportHistory } from './backup.js'
import { useSettings } from '../settings.js'

/**
 * Gitee 私有仓库同步（BYO：用户自己的仓库 + 自己的私人令牌）。
 *
 * 设计取舍：
 * - 一次同步就是把整包 zip 覆盖写进仓库的一个文件，天然省请求数，也不需要处理分页；
 * - 令牌只在本机（原生壳用 SecureStore 加密），请求直接打 gitee.com 的 API（实测带 CORS）；
 * - 只做「上传 / 拉取」两个动作，冲突交给导入流程：同 id 的会话跳过，不会静默覆盖本地。
 */
export const GITEE_API = 'https://gitee.com/api/v5'
/** 仓库里的固定路径：一个包搞定，避免增量同步的复杂度 */
export const GITEE_BACKUP_PATH = 'oxchat/backup.zip'

export type GiteeConfig = {
  owner: string
  repo: string
  token: string
}

export class GiteeSyncError extends Error {
  /** 供界面翻译的键 */
  reason: 'not-configured' | 'unauthorized' | 'not-found' | 'rate-limited' | 'failed' | 'empty'

  constructor(reason: GiteeSyncError['reason'], message?: string) {
    super(message ?? reason)
    this.reason = reason
  }
}

export const currentGiteeConfig = (): GiteeConfig => {
  const { giteeOwner, giteeRepo, giteeToken } = useSettings.getState()
  return { owner: giteeOwner.trim(), repo: giteeRepo.trim(), token: giteeToken.trim() }
}

export const isGiteeConfigured = (config: GiteeConfig = currentGiteeConfig()): boolean =>
  Boolean(config.owner.trim() && config.repo.trim() && config.token.trim())

/** 文件路径按段编码：仓库名里的斜杠不能当路径分隔符用 */
export const contentsUrl = (config: GiteeConfig, path: string): string =>
  `${GITEE_API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`

/** 已有文件时用 PUT（必须带 sha），否则用 POST 新建 */
export const writeMethod = (sha: string | null): 'POST' | 'PUT' => (sha ? 'PUT' : 'POST')

const mapStatus = (status: number): GiteeSyncError['reason'] => {
  if (status === 401 || status === 403) {
    return 'unauthorized'
  }
  if (status === 404) {
    return 'not-found'
  }
  if (status === 429) {
    return 'rate-limited'
  }
  return 'failed'
}

const ensureConfig = (config: GiteeConfig) => {
  if (!isGiteeConfigured(config)) {
    throw new GiteeSyncError('not-configured')
  }
}

/** 读取仓库里现有备份的 sha；文件不存在返回 null */
const readExistingSha = async (
  config: GiteeConfig,
  fetchImpl: typeof fetch
): Promise<string | null> => {
  const response = await fetchImpl(
    `${contentsUrl(config, GITEE_BACKUP_PATH)}?access_token=${encodeURIComponent(config.token)}`,
    { method: 'GET' }
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new GiteeSyncError(mapStatus(response.status), `HTTP ${response.status}`)
  }
  const body = (await response.json()) as { sha?: unknown }
  return typeof body.sha === 'string' ? body.sha : null
}

export type GiteeSyncDeps = {
  fetch?: typeof fetch
  /** 生成备份包；默认走现有导出（含图片原件） */
  buildArchive?: () => Promise<Blob>
  now?: () => number
}

/** 上传：整包覆盖写入仓库（首次新建、之后更新） */
export const pushBackup = async (
  deps: GiteeSyncDeps = {},
  config: GiteeConfig = currentGiteeConfig()
): Promise<{ sha: string; bytes: number }> => {
  ensureConfig(config)
  const fetchImpl = deps.fetch ?? fetch
  const buildArchive = deps.buildArchive ?? (async () => (await exportHistory()).blob)
  const blob = await buildArchive()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const content = toBase64(bytes)
  const message = `OxChat 备份 ${new Date(deps.now?.() ?? Date.now()).toISOString()}`

  /**
   * 多端同时上传时，我们读到的 sha 可能已经过期（另一端刚写完）→ Gitee 返回 409。
   * 这不是失败，而是需要重读 sha 再写一次；重试一次就够，真冲突留给用户手动再点。
   */
  const attempts = 2
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sha = await readExistingSha(config, fetchImpl)
    const body = new URLSearchParams({
      access_token: config.token,
      content,
      message,
      ...(sha ? { sha } : {}),
    })
    const response = await fetchImpl(contentsUrl(config, GITEE_BACKUP_PATH), {
      method: writeMethod(sha),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (response.ok) {
      const result = (await response.json()) as { content?: { sha?: unknown } }
      return {
        sha: typeof result.content?.sha === 'string' ? result.content.sha : (sha ?? ''),
        bytes: bytes.length,
      }
    }
    const conflict = response.status === 409 || response.status === 422
    if (!conflict || attempt === attempts) {
      throw new GiteeSyncError(mapStatus(response.status), `HTTP ${response.status}`)
    }
  }
  throw new GiteeSyncError('failed')
}

/** 拉取：把仓库里的备份包取回成 File，交给现有的导入流程 */
export const pullBackup = async (
  deps: GiteeSyncDeps = {},
  config: GiteeConfig = currentGiteeConfig()
): Promise<File> => {
  ensureConfig(config)
  const fetchImpl = deps.fetch ?? fetch
  const response = await fetchImpl(
    `${contentsUrl(config, GITEE_BACKUP_PATH)}?access_token=${encodeURIComponent(config.token)}`,
    { method: 'GET' }
  )
  if (response.status === 404) {
    throw new GiteeSyncError('not-found')
  }
  if (!response.ok) {
    throw new GiteeSyncError(mapStatus(response.status), `HTTP ${response.status}`)
  }
  const body = (await response.json()) as { content?: unknown; encoding?: unknown }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    throw new GiteeSyncError('empty')
  }
  const binary = atob(body.content.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], 'oxchat-sync-backup.zip', { type: 'application/zip' })
}
