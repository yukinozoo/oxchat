import { fromBase64 } from '../../utils/base64.js'

/**
 * 原生壳里下载的整包动辄几百兆，不能一次性读进 JS（会直接 OOM）。
 * 这里用原生分片读取拼出一个「惰性 File」：只暴露 ZIP 读取器用到的 size 与
 * slice(start, end).arrayBuffer()，每次只把需要的那一段读进来。
 */

type ArchiveBridge = {
  statArchive: (options: { path: string }) => Promise<{ size: number }>
  readArchiveChunk: (options: {
    path: string
    offset: number
    length: number
  }) => Promise<{ data: string; bytes: number }>
}

/** 单次读取上限：8MB 以内，base64 后仍是可接受的字符串长度 */
const CHUNK_LIMIT = 4 * 1024 * 1024

const bridge = (): ArchiveBridge | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { WebsiteImport?: ArchiveBridge } } }).Capacitor
    ?.Plugins?.WebsiteImport

export const nativeArchiveAvailable = (): boolean => Boolean(bridge())

export const createNativeArchiveFile = async (path: string): Promise<File> => {
  const instance = bridge()
  if (!instance) {
    throw new Error('native archive reader unavailable')
  }
  const { size } = await instance.statArchive({ path })
  const slice = (start: number, end: number) => {
    const from = Math.max(0, Math.min(start, size))
    const to = Math.max(from, Math.min(end, size))
    const length = to - from
    return {
      size: length,
      type: 'application/zip',
      arrayBuffer: async () => {
        const parts: Uint8Array[] = []
        let offset = 0
        while (offset < length) {
          const take = Math.min(CHUNK_LIMIT, length - offset)
          const { data, bytes } = await instance.readArchiveChunk({
            path,
            offset: from + offset,
            length: take,
          })
          const chunk = fromBase64(data)
          parts.push(chunk)
          const step = bytes || chunk.byteLength
          if (step <= 0) {
            break
          }
          offset += step
        }
        const joined = new Uint8Array(length)
        let written = 0
        for (const part of parts) {
          joined.set(part, written)
          written += part.byteLength
        }
        return joined.buffer.slice(0, written)
      },
    }
  }
  return {
    name: path.split('/').pop() ?? 'export.zip',
    size,
    type: 'application/zip',
    slice,
  } as unknown as File
}
