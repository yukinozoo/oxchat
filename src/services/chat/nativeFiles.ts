import { fromBase64, toBase64 } from '../../utils/base64.js'
import type { StoredFile } from './db.js'

/**
 * 附件原件的原生存储桥（Android 私有目录）。
 *
 * 为什么搬出 IndexedDB：WebView 的存储会被系统清理/断连（用户看到"附件全丢"），
 * 而 Blob 在 IndexedDB 里走一趟 base64，内存峰值是文件的两倍多，几 MB 的图就能顶到 OOM。
 *
 * 网页版没有这个插件，`nativeFilesAvailable()` 返回 false，调用方自动落回 IndexedDB。
 */
type FileStoreBridge = {
  writeFile: (options: {
    id: string
    data: string
    mime: string
  }) => Promise<{ size: number }>
  readFile: (options: {
    id: string
  }) => Promise<{ data: string; mime: string; size: number }>
  deleteFile: (options: { id: string }) => Promise<void>
  listFiles: () => Promise<{ files: { id: string; size: number }[]; bytes: number }>
  stat: () => Promise<{ count: number; bytes: number }>
}

const bridge = (): FileStoreBridge | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { FileStore?: FileStoreBridge } } }).Capacitor
    ?.Plugins?.FileStore

export const nativeFilesAvailable = (): boolean => Boolean(bridge())

/** 写一个附件原件；失败抛错，由调用方决定是否回退 IndexedDB */
export const writeNativeFile = async (file: StoredFile, mime: string): Promise<number> => {
  const instance = bridge()
  if (!instance) {
    throw new Error('native file store unavailable')
  }
  const bytes = new Uint8Array(await file.blob.arrayBuffer())
  const { size } = await instance.writeFile({
    id: file.id,
    data: toBase64(bytes),
    mime,
  })
  return size
}

/** 读回附件原件；文件不存在时返回 undefined（迁移前的旧数据就会走这条路） */
export const readNativeFile = async (id: string): Promise<Blob | undefined> => {
  const instance = bridge()
  if (!instance) {
    return undefined
  }
  try {
    const { data, mime } = await instance.readFile({ id })
    const bytes = fromBase64(data)
    return new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' })
  } catch {
    return undefined
  }
}

export const deleteNativeFile = async (id: string): Promise<void> => {
  const instance = bridge()
  if (!instance) {
    return
  }
  try {
    await instance.deleteFile({ id })
  } catch {
    // 删不掉不阻断主流程：pruneFiles 下次还会扫到
  }
}

export const nativeFileIds = async (): Promise<Set<string>> => {
  const instance = bridge()
  if (!instance) {
    return new Set()
  }
  const { files } = await instance.listFiles()
  return new Set(files.map((file) => file.id))
}

export const nativeFileStat = async (): Promise<{ count: number; bytes: number } | null> => {
  const instance = bridge()
  if (!instance) {
    return null
  }
  try {
    return await instance.stat()
  } catch {
    return null
  }
}
