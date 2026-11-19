import { downloadExportArchive, websiteImportAvailable } from './websiteImport.js'
import { createNativeArchiveFile } from './nativeArchive.js'

/**
 * 按下载链接取回整包：App 内交给原生插件下载（避免 WebView 跨域），
 * 网页版直接 fetch。两条路径都返回可直接交给归档导入流程的 File。
 */
export const loadArchiveFromUrl = async (url: string): Promise<File> => {
  if (websiteImportAvailable()) {
    const { path } = await downloadExportArchive(url)
    return createNativeArchiveFile(path)
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return new File([blob], 'deepseek_export.zip', { type: 'application/zip' })
}
