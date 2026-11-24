import { downloadExportArchive, websiteImportAvailable } from './websiteImport.js'
import { createNativeArchiveFile } from './nativeArchive.js'

/**
 * 链接下载失败的两类原因：
 * - cors：浏览器把跨域拒绝（下载地址不给我们发 CORS 头）或断网都报成 TypeError；
 * - http：服务端明确返回了非 2xx（签名过期 403、链接被删 404 等）。
 * 网页版只能走 fetch，跨域这一关是浏览器拦的，改不了；原生壳走插件下载没有这个问题。
 */
export type ArchiveLinkFailure = 'cors' | 'http'

export class ArchiveLinkError extends Error {
  constructor(
    readonly kind: ArchiveLinkFailure,
    message: string
  ) {
    super(message)
    this.name = 'ArchiveLinkError'
  }
}

/**
 * 按下载链接取回整包：App 内交给原生插件下载（避免 WebView 跨域），
 * 网页版直接 fetch。两条路径都返回可直接交给归档导入流程的 File。
 */
export const loadArchiveFromUrl = async (url: string): Promise<File> => {
  if (websiteImportAvailable()) {
    try {
      const { path } = await downloadExportArchive(url)
      return await createNativeArchiveFile(path)
    } catch (error) {
      throw new ArchiveLinkError(
        'http',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // 跨域被拦与断网在浏览器里同形：都按「取不到」处理，交给用户改用下载 + 上传
    throw new ArchiveLinkError('cors', 'cross-origin or network blocked')
  }
  if (!response.ok) {
    throw new ArchiveLinkError('http', `HTTP ${response.status}`)
  }
  const blob = await response.blob()
  if (blob.size === 0) {
    throw new ArchiveLinkError('http', 'empty archive')
  }
  return new File([blob], 'deepseek_export.zip', { type: 'application/zip' })
}
