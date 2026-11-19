import { downloadExportArchive, websiteImportAvailable } from './websiteImport.js'
import { fromBase64 } from '../../utils/base64.js'

/** 原生壳把下载的文件放在缓存目录，这里读回成 File */
const readFromCache = async (path: string): Promise<File> => {
  const filesystem = (
    window as {
      Capacitor?: {
        Plugins?: {
          Filesystem?: {
            readFile: (o: { path: string; directory: string }) => Promise<{ data: string }>
          }
        }
      }
    }
  ).Capacitor?.Plugins?.Filesystem
  if (!filesystem) {
    throw new Error('filesystem unavailable')
  }
  const name = path.split('/').pop() ?? 'export.zip'
  const { data } = await filesystem.readFile({ path: name, directory: 'CACHE' })
  const bytes = fromBase64(data)
  return new File([bytes as unknown as BlobPart], name, { type: 'application/zip' })
}

/**
 * 按下载链接取回整包：App 内交给原生插件下载（避免 WebView 跨域），
 * 网页版直接 fetch。两条路径都返回可直接交给归档导入流程的 File。
 */
export const loadArchiveFromUrl = async (url: string): Promise<File> => {
  if (websiteImportAvailable()) {
    const { path } = await downloadExportArchive(url)
    return readFromCache(path)
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return new File([blob], 'deepseek_export.zip', { type: 'application/zip' })
}
