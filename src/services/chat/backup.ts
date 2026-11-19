import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'
export { requestImportCancel } from './history/importArchive.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

export const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 会话快照：列表和已加载内容保留导出开始时的状态；未打开的会话逐条读取。 */
const readSessions = async function* (only?: ReadonlySet<string>): AsyncGenerator<Session> {
  const { sessions, sessionCache } = useChatStore.getState()
  for (const summary of sessions) {
    if (only && !only.has(summary.id)) {
      continue
    }
    const session = Object.hasOwn(sessionCache, summary.id)
      ? sessionCache[summary.id]
      : await db.loadSession(summary.id)
    if (!session) {
      throw new Error(`History session disappeared during export: ${summary.id}`)
    }
    // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
    yield { ...session, ...summary }
  }
}

/**
 * 网页端导出：分片拼成 Blob 一次性下载。
 * 原生端请用 exportHistoryStream，避免大库整包进内存。
 */
export const exportHistory = (only?: ReadonlySet<string>): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { archiveEntries } = await import('./history/exportArchive.js')
    const { streamArchive, chunksToBlob } = await import('./history/zipWriter.js')
    const blob = await chunksToBlob(streamArchive(archiveEntries(readSessions(only))))
    return { name: backupFileName(new Date()), blob }
  })

/**
 * 原生端流式导出：ZIP 分片逐个回调，调用方边收边写盘。
 * 文件名由调用方生成（写盘与分享都用它），返回归档总字节数供界面展示。
 */
export const exportHistoryStream = (
  only: ReadonlySet<string> | undefined,
  onChunk: (chunk: Uint8Array) => Promise<void>
): Promise<{ bytes: number }> =>
  enqueueBackup(async () => {
    const { archiveEntries } = await import('./history/exportArchive.js')
    const { streamArchive } = await import('./history/zipWriter.js')
    let bytes = 0
    for await (const chunk of streamArchive(archiveEntries(readSessions(only)))) {
      bytes += chunk.byteLength
      await onChunk(chunk)
    }
    return { bytes }
  })

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才提交。与本地已有会话同 ID 的跳过（保留现有对话），
 * 新会话并入现有列表；返回导入与跳过的数量。
 */
export const importHistory = (
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<{ imported: number; skipped: number }> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    const { countArchiveSessions } = await import('./history/zipReader.js')
    await checkArchiveFormat(file)
    const existingIds = new Set(useChatStore.getState().sessions.map((session) => session.id))
    const totalSessions = await countArchiveSessions(file)
    const result = await replaceHistory(
      () => importArchive(file, { existingIds, totalSessions, onProgress }),
      'merge'
    )
    return result as { imported: number; skipped: number }
  })

/**
 * 只导入勾选的会话：与本地文件导入共用同一条链路——
 * 先校验 ZIP 与 manifest，再从归档流式写入暂存，100ms 节流进度，可中途取消。
 * 未勾选的条目只跳过字节，不占内存。
 */
export const importSelectedSessions = (
  file: File,
  ids: ReadonlySet<string>,
  options: {
    onProgress?: (done: number, total: number) => void
    skipFiles?: boolean
    cleanMissing?: boolean
  } = {}
): Promise<{ imported: number; skipped: number }> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    const existingIds = new Set(useChatStore.getState().sessions.map((session) => session.id))
    const result = await replaceHistory(
      () =>
        importArchive(file, {
          existingIds,
          onlyIds: ids,
          totalSessions: ids.size,
          skipFiles: options.skipFiles ?? false,
          cleanMissing: options.cleanMissing ?? false,
          onProgress: options.onProgress,
        }),
      'merge'
    )
    return result as { imported: number; skipped: number }
  })

/** 读第三方整包的会话索引（官网导出包）：只解析索引条目，其余跳过 */
export const readArchiveIndex = async (
  file: File
): Promise<{ id: string; title: string }[]> => {
  const { readArchiveSelected } = await import('./history/zipReader.js')
  const { readSessionIndex } = await import('./history/schema.js')
  const { INDEX_PATH } = await import('./history/paths.js')
  for await (const { path, blob } of readArchiveSelected(file, (item) => item === INDEX_PATH)) {
    if (path !== INDEX_PATH) {
      continue
    }
    const list = readSessionIndex(JSON.parse(await blob.text()))
    return list.map((entry) => ({ id: entry.id, title: entry.title ?? '' }))
  }
  return []
}

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })

/** 读第三方整包的会话索引（官网导出包）：只解析索引条目，其余跳过 */
