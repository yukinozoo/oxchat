import { loadFile } from '../services/chat/db.js'

/**
 * 附件打开策略。
 *
 * 图片和 PDF 直接在标签页预览；SVG 和其他文件一律下载原件——
 * 让 SVG 以 blob: URL 顶层打开时，它会继承应用同源、可以执行脚本，
 * 而 IndexedDB / localStorage 里有对话和 API Key，不能冒这个险。
 */
export type AttachmentViewKind = 'image' | 'pdf' | 'svg' | 'other'

const IMAGE_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'gif',
  'webp',
  'bmp',
  'dib',
  'ico',
  'cur',
  'avif',
  'apng',
])

export const attachmentViewKind = (name: string): AttachmentViewKind => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'svg') {
    return 'svg'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  return IMAGE_EXT.has(ext) ? 'image' : 'other'
}

const clickLink = (url: string, name: string, download: boolean) => {
  const link = document.createElement('a')
  link.href = url
  if (download) {
    link.download = name
  } else {
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
  }
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** 打开一条已保存的附件：可预览的新标签打开，其余下载原件 */
export const openAttachment = async (fileId: string, name: string): Promise<void> => {
  const blob = await loadFile(fileId)
  if (!blob) {
    return
  }
  const kind = attachmentViewKind(name)
  const type =
    kind === 'pdf' ? 'application/pdf' : kind === 'image' ? blob.type || 'image/*' : blob.type
  const url = URL.createObjectURL(type === blob.type ? blob : new Blob([blob], { type }))
  clickLink(url, name, kind === 'svg' || kind === 'other')
  // 下载/预览都交给浏览器，稍后回收地址
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
