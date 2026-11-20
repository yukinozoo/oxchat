import { toBase64 } from '../../utils/base64.js'
import { exportHistory, exportHistoryStream } from './backup.js'
import { canStreamExport, streamExportToFile } from './webExport.js'

/**
 * 导出会话（一个或多个）到文件。
 *
 * 三条路径：
 * - 原生壳：分片写 CACHE，再交给系统「保存 / 分享」；
 * - 网页版（Chrome/Edge）：边压边写，内存恒定；
 * - 其它浏览器：整包拼 Blob 下载。
 */

type NativeFilesystem = {
  deleteFile: (options: { path: string; directory: string }) => Promise<unknown>
  writeFile: (options: {
    path: string
    data: string
    directory: string
    recursive?: boolean
  }) => Promise<unknown>
  appendFile: (options: { path: string; data: string; directory: string }) => Promise<unknown>
  getUri: (options: { path: string; directory: string }) => Promise<{ uri: string }>
}

export type NativeBackupPlugins = {
  filesystem: NativeFilesystem
  share: {
    share: (options: { title: string; url: string; dialogTitle: string }) => Promise<unknown>
  }
}

export const nativeBackupPlugins = (): NativeBackupPlugins | null => {
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    ?.Plugins
  const filesystem = plugins?.Filesystem as NativeFilesystem | undefined
  const share = plugins?.Share as NativeBackupPlugins['share'] | undefined
  return filesystem && share ? { filesystem, share } : null
}

export type ExportOutcome = 'saved' | 'cancelled'

export type ExportOptions = {
  /** 只导出这些会话；省略表示全部 */
  only?: ReadonlySet<string>
  includeImages?: boolean
  /** 文件名（不含路径）：原生壳写 CACHE、网页版做默认文件名 */
  fileName: string
  /** 已写入字节数，约每 1MB 回调一次 */
  onProgress?: (bytes: number) => void
  /** 原生「保存 / 分享」面板的标题 */
  shareTitle?: string
}

const CHUNK_FLUSH = 512 * 1024

/** 原生壳：分片写缓存文件后拉起分享面板 */
const exportNative = async (native: NativeBackupPlugins, options: ExportOptions) => {
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let first = true
  const flush = async () => {
    if (pendingBytes === 0) {
      return
    }
    const merged = new Uint8Array(pendingBytes)
    let offset = 0
    for (const piece of pending) {
      merged.set(piece, offset)
      offset += piece.byteLength
    }
    pending = []
    pendingBytes = 0
    const data = toBase64(merged)
    if (first) {
      first = false
      await native.filesystem.writeFile({
        path: options.fileName,
        data,
        directory: 'CACHE',
        recursive: true,
      })
    } else {
      await native.filesystem.appendFile({
        path: options.fileName,
        data,
        directory: 'CACHE',
      })
    }
  }
  try {
    await native.filesystem.deleteFile({ path: options.fileName, directory: 'CACHE' })
  } catch {
    // 首次导出没有旧文件
  }
  let written = 0
  let lastReport = 0
  await exportHistoryStream(
    options.only,
    async (chunk) => {
      written += chunk.byteLength
      pending.push(chunk)
      pendingBytes += chunk.byteLength
      if (written - lastReport >= 1_048_576) {
        lastReport = written
        options.onProgress?.(written)
      }
      if (pendingBytes >= CHUNK_FLUSH) {
        await flush()
      }
    },
    { includeImages: options.includeImages }
  )
  await flush()
  options.onProgress?.(written)
  const { uri } = await native.filesystem.getUri({
    path: options.fileName,
    directory: 'CACHE',
  })
  await native.share.share({
    title: options.fileName,
    url: uri,
    dialogTitle: options.shareTitle ?? '',
  })
}

/** 网页版兜底：整包拼 Blob 再触发下载 */
const downloadAsBlob = async (options: ExportOptions) => {
  const { blob } = await exportHistory(options.only, { includeImages: options.includeImages })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = options.fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const exportSessionsToFile = async (options: ExportOptions): Promise<ExportOutcome> => {
  const native = nativeBackupPlugins()
  if (native) {
    await exportNative(native, options)
    return 'saved'
  }
  if (canStreamExport()) {
    const result = await streamExportToFile(
      options.fileName,
      options.only,
      (bytes) => options.onProgress?.(bytes),
      { includeImages: options.includeImages }
    )
    if (result === 'unsupported') {
      await downloadAsBlob(options)
      return 'saved'
    }
    return result === 'cancelled' ? 'cancelled' : 'saved'
  }
  await downloadAsBlob(options)
  return 'saved'
}
