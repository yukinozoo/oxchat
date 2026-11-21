import { translate } from '../../../i18n/index.js'
import { createId } from '../../../utils/id.js'
import { historyTokens } from '../context.js'
import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath } from './paths.js'
import { checkManifest, readSessionIndex } from './schema.js'
import { parseSessionAsync } from './sessionParser.js'
import {
  ArchiveError,
  isZipFile,
  listArchiveEntries,
  listArchivePaths,
  readArchive,
  readEntry,
  readEntryByPath,
  type ArchiveEntry,
} from './zipReader.js'

/** 批量落库的阈值：一次事务写一批，摊掉每批的提交开销，同时限制峰值内存 */
const SESSION_BATCH = 20

/**
 * 让出一次宏任务：几千个会话连续写库时，每批之间喘口气，
 * 界面才不会在整个导入期间变成「卡死」状态。
 */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const FILE_BATCH_COUNT = 12
const FILE_BATCH_BYTES = 24 * 1024 * 1024

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

/**
 * 引用指向的图片在包里不存在时：把该附件从消息里移除，正文补一行占位。
 * 这样长对话不会因为一张丢了的图被判定为坏数据。
 */
const dropMissingFiles = (
  session: Session,
  images: [string, string][],
  available: ReadonlySet<string>
): Session => {
  const missing = new Set(
    images.filter(([path]) => !available.has(path)).map(([, id]) => id)
  )
  if (missing.size === 0) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (message.role !== 'user' || !message.files.some((file) => missing.has(file.id))) {
        return message
      }
      const lost = message.files.filter((file) => missing.has(file.id))
      const placeholders = lost.map((file) => `[附件不可用：${file.name}]`).join('')
      return {
        ...message,
        content: [message.content, placeholders].filter(Boolean).join('\n\n'),
        files: message.files.filter((file) => !missing.has(file.id)),
      }
    }),
  }
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/** 用户点了「停止导入」：在下一个条目边界抛出停止错误，已写入暂存的数据由调用方清理。 */
let cancelRequested = false

export const requestImportCancel = (): void => {
  cancelRequested = true
}

export type ImportOptions = {
  /** 本地已存在的会话 ID：同 ID 会话跳过，保留现有对话与续聊内容 */
  existingIds?: ReadonlySet<string>
  /**
   * 同步模式：给出本地各会话的 updatedAt 后，同 id 会话不再一律跳过，
   * 而是比较时间戳——远端较新则覆盖导入，本地较新则保留。
   */
  localUpdatedAt?: ReadonlyMap<string, number>
  /** 预扫描得到的会话总数，用于「N / M 个对话」进度 */
  totalSessions?: number
  /** 跳过图片等附件条目：只导入对话文字，图片在消息里显示为文件名 */
  skipFiles?: boolean
  /** 导入前清理失效附件：引用找不到对应条目的图片会被移除，正文补一行占位说明 */
  cleanMissing?: boolean
  /**
   * 只导入这些会话：未勾选的条目直接跳过字节，但仍计入整包完整性校验。
   * 与 localIds 的去重独立：同一 id 既在 onlyIds 里又已存在于本地时按「跳过」计数。
   */
  onlyIds?: ReadonlySet<string>
  onProgress?: (done: number, total: number) => void
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 全部图片。
 * 也支持会话与图片交错排列、index 位于末尾的条目顺序。
 * 与本地已有会话同 ID 的条目跳过，保留现有对话；index 校验按「已见过的会话」统计。
 * 会话读完立即暂存，只保留图片路径映射；图片全部读完后逐会话回填 MIME，不改变图片身份。
 * 写入导入暂存存储；调用方负责先清空暂存，成功后提交，失败时清理暂存。
 */
export type ImportResult = {
  imported: number
  /** 同步模式下被远端较新版本覆盖的会话数 */
  updated: number
  /** 覆盖前另存的本地副本数量 */
  conflicts: number
  skipped: number
  /** 本次导入里最长那条对话的 token 估算，用来提示用户手动压缩 */
  maxTokens: number
}

export const importArchive = async (
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult> => {
  cancelRequested = false
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const existing = options.existingIds ?? new Set<string>()
  const only = options.onlyIds
  const available = options.cleanMissing ? await listArchivePaths(file) : undefined
  const skipFiles = options.skipFiles ?? false
  const total = options.totalSessions ?? 0
  const imported = new Set<string>()
  /** 已见过的会话（导入 + 跳过），用于图片路由与 index 校验 */
  const known = new Set<string>()
  let skipped = 0
  let updated = 0
  let conflicts = 0
  /** 最长会话的 token 估算：导入完用来决定要不要提示手动压缩 */
  let maxTokens = 0
  let done = 0
  let lastReportAt = 0
  /**
   * 进度回调：100ms 节流。每次更新都会让设置页重渲染，逐条刷新在手机上明显拖慢导入。
   * 总数未知（预扫描失败）时传 0，界面按「已处理 N 个」展示。
   */
  const report = (force = false) => {
    const now = performance.now()
    if (force || now - lastReportAt >= 100) {
      lastReportAt = now
      options.onProgress?.(done, total)
    }
  }
  const images = new Map<string, string>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  let index: SessionIndexEntry[] | undefined

  /** 待写入的会话与图片：攒够一批再发事务，避免一条一次提交 */
  const pendingSessions: Session[] = []
  const pendingFiles: db.StoredFile[] = []
  /** 引用了图片的会话，回填 MIME 时只扫这些，不用全表重读 */
  const sessionsWithFiles = new Set<string>()
  let pendingBytes = 0

  const flushSessions = async () => {
    if (pendingSessions.length > 0) {
      await db.addStagingSessions(pendingSessions.splice(0))
      await yieldToMain()
    }
  }

  const flushFiles = async () => {
    if (pendingFiles.length > 0) {
      await db.saveStagingFiles(pendingFiles.splice(0))
      pendingBytes = 0
      await yieldToMain()
    }
  }

  const saveImage = async (path: string, id: string) => {
    const data = await readEntryByPath(file, path)
    if (!data) {
      return
    }
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    pendingFiles.push({ id, blob: new Blob([data], { type }) })
    pendingBytes += data.size
    stored.set(id, type)
    if (pendingFiles.length >= FILE_BATCH_COUNT || pendingBytes >= FILE_BATCH_BYTES) {
      await flushFiles()
    }
  }

  report(true)
  const entries = await listArchiveEntries(file).catch(
    (): { path: string; size: number }[] => []
  )
  if (entries.length === 0) {
    fail('backupUnrecognized')
  }

  try {
    // manifest 必须是归档里的第一个条目
    if (entries[0].path !== MANIFEST_PATH) {
      fail('backupUnrecognized')
    }
    const manifest = (await readEntryByPath(file, MANIFEST_PATH)) ?? fail('backupUnrecognized')
    checkManifest(JSON.parse(await manifest.text()))

    /**
     * 第一遍只处理清单、会话与索引：图片条目直接跳过、一个字节都不读，
     * 这是「几百兆的包也能秒进」的关键（以前为了 CRC 校验会把图片全读一遍）。
     */
    for (const entry of entries) {
      if (cancelRequested) {
        fail('historyImportCancelled')
      }
      const { path } = entry
      if (path === MANIFEST_PATH) {
        continue
      }
      if (path === USER_PATH) {
        continue
      }
      const sessionId = parseSessionPath(path)
      if (sessionId !== null) {
        known.add(sessionId)
        if (only !== undefined && !only.has(sessionId)) {
          continue
        }
        if (imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        const localAt = options.localUpdatedAt?.get(sessionId)
        const merging = existing.has(sessionId) && options.localUpdatedAt !== undefined
        if (existing.has(sessionId) && !merging) {
          skipped += 1
          done += 1
          report()
          continue
        }
        const blob = (await readEntryByPath(file, path)) ?? fail('backupIncomplete')
        const parsed = await parseSessionAsync(await blob.text())
        if (parsed.session.id !== sessionId) {
          fail('backupIncomplete')
        }
        if (merging) {
          // 远端不比本地新就不动本地，避免同步把本地更近的续聊冲掉
          const remoteAt = parsed.session.updatedAt ?? 0
          if (remoteAt <= (localAt ?? 0)) {
            skipped += 1
            done += 1
            report()
            continue
          }
          // 覆盖前把本地这一版另存成副本：同步只按 updatedAt 判新旧，
          // 两边各自往后聊过时，输的一方不能就这么没了
          const local = await db.loadSession(sessionId).catch(() => undefined)
          if (local && local.messages.length > 0) {
            const copyAt = Date.now()
            pendingSessions.push({
              ...local,
              id: createId(),
              title: `${local.title || translate('untitledChat')} · ${translate('syncConflictSuffix')}`,
              createdAt: copyAt,
              updatedAt: copyAt,
              pinned: false,
            })
            conflicts += 1
          }
          updated += 1
        }
        imported.add(sessionId)
        for (const [imagePath, id] of parsed.images) {
          images.set(imagePath, id)
        }
        if (parsed.hasFiles) {
          sessionsWithFiles.add(sessionId)
        }
        maxTokens = Math.max(maxTokens, historyTokens(parsed.session.messages))
        pendingSessions.push(
          available === undefined
            ? parsed.session
            : dropMissingFiles(parsed.session, parsed.images, available)
        )
        if (pendingSessions.length >= SESSION_BATCH) {
          await flushSessions()
        }
        done += 1
        report()
        continue
      }
      if (path === INDEX_PATH && !index) {
        const blob = (await readEntryByPath(file, path)) ?? fail('backupIncomplete')
        index = readSessionIndex(JSON.parse(await blob.text()))
        continue
      }
      // 图片条目留到第二遍处理，其余未知条目视为损坏
      if (/^chat_sessions\/[^/]+_files\//.test(path)) {
        continue
      }
      fail('backupIncomplete')
    }

    // index 列出归档内全部会话，与「已见过的会话」一一对应（含跳过的）。
    const listed = new Set(index?.map((entry) => entry.id))
    if (
      !index ||
      listed.size !== index.length ||
      listed.size !== known.size ||
      [...known].some((id) => !listed.has(id))
    ) {
      fail('backupIncomplete')
    }

    await flushSessions()

    // 第二遍：需要时按偏移读图片原件（跳过图片时这一遍完全不读）
    if (!skipFiles) {
      for (const entry of entries) {
        if (cancelRequested) {
          fail('historyImportCancelled')
        }
        const owner = /^chat_sessions\/([^/]+)_files\//.exec(entry.path)?.[1]
        if (owner === undefined || !known.has(owner)) {
          continue
        }
        const id = images.get(entry.path)
        if (id === undefined || stored.has(id)) {
          continue
        }
        await saveImage(entry.path, id)
      }
    }
    await flushFiles()
  } catch (error) {
    if (error instanceof BackupError) {
      throw error
    }
    throw new BackupError(
      error instanceof ArchiveError ? 'backupIncomplete' : 'historyImportStorageFailed'
    )
  }
  try {
    await db.updateStagingFileTypes(stored, sessionsWithFiles)
  } catch {
    fail('historyImportStorageFailed')
  }
  report(true)
  return { imported: imported.size - updated, updated, conflicts, skipped, maxTokens }
}
