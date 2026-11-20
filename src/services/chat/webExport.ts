import { exportHistoryStream, type ExportOptions } from './backup.js'

/**
 * 网页版流式导出：Chrome/Edge 支持 File System Access API，
 * 可以边压缩边写文件，内存恒定；不支持的浏览器让调用方退回 Blob 下载。
 */

type Writable = {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}

type Picker = (options: {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable: () => Promise<Writable> }>

type PickerWindow = Window & {
  showSaveFilePicker?: Picker
}

const picker = (): Picker | undefined =>
  typeof window === 'undefined' ? undefined : (window as PickerWindow).showSaveFilePicker

/** 当前浏览器能否边压边存 */
export const canStreamExport = (): boolean => typeof picker() === 'function'

export type WebExportResult = 'saved' | 'cancelled' | 'unsupported'

/**
 * 让用户选一个文件，把导出分片直接写进去。
 * 返回 unsupported 时调用方退回 Blob 下载；cancelled 表示用户主动取消。
 */
export const streamExportToFile = async (
  suggestedName: string,
  only: ReadonlySet<string> | undefined,
  onProgress: (bytes: number) => void,
  options: ExportOptions = {}
): Promise<WebExportResult> => {
  const save = picker()
  if (!save) {
    return 'unsupported'
  }
  let handle: Awaited<ReturnType<Picker>>
  try {
    // 必须在用户手势里调用，所以这里不做任何前置 await
    handle = await save({
      suggestedName,
      types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))) {
      return 'cancelled'
    }
    // 被浏览器策略拦截（如非安全上下文）：退回 Blob 下载
    return 'unsupported'
  }
  const writable = await handle.createWritable()
  let written = 0
  try {
    await exportHistoryStream(
      only,
      async (chunk) => {
        await writable.write(chunk)
        written += chunk.byteLength
        onProgress(written)
      },
      options
    )
    await writable.close()
    return 'saved'
  } catch (error) {
    await writable.abort?.().catch(() => undefined)
    throw error
  }
}
