import type { Session } from '../types.js'
import { fail } from './errors.js'
import { sessionFilesDir } from './paths.js'
import { readSessionFile } from './schema.js'
import { toLocalSession } from './toLocal.js'

/** 会话 JSON 的解析产物：本地会话 + 图片路径映射 + 是否引用附件 */
export type ParsedSession = {
  session: Session
  images: [string, string][]
  hasFiles: boolean
}

/**
 * 清理坏掉的附件节点：导出的 JSON 里常出现「图片条目已不存在」「export_path 不在本会话目录」
 * 「同一路径指向不同文件」这类残留，严格校验会直接让整条会话导入失败。
 * 这里就地丢弃这些节点，并在同一消息的提问正文后补一行占位，保证对话文字还能进来。
 */
const sanitizeFiles = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value
  }
  const file = value as { id?: unknown; messages?: unknown }
  const sessionId = typeof file.id === 'string' ? file.id : ''
  if (!sessionId || !Array.isArray(file.messages)) {
    return value
  }
  const prefix = sessionFilesDir(sessionId).normalize('NFC')
  for (const message of file.messages) {
    if (!message || typeof message !== 'object') {
      continue
    }
    const fragments = (message as { fragments?: unknown }).fragments
    if (!Array.isArray(fragments)) {
      continue
    }
    const dropped: string[] = []
    for (const fragment of fragments) {
      if (!fragment || typeof fragment !== 'object') {
        continue
      }
      const item = fragment as { type?: unknown; files?: unknown }
      if (item.type !== 'FILE' || !Array.isArray(item.files)) {
        continue
      }
      const seen = new Map<string, string>()
      item.files = item.files.filter((entry) => {
        if (!entry || typeof entry !== 'object') {
          return false
        }
        const node = entry as Record<string, unknown>
        const id = typeof node.id === 'string' ? node.id : ''
        const name = typeof node.file_name === 'string' && node.file_name ? node.file_name : ''
        if (!id) {
          dropped.push(name || '附件')
          return false
        }
        // export_path 为 null：非图片或没导出本体，元数据仍然保留
        if (node.export_path === undefined || node.export_path === null) {
          return true
        }
        const path = String(node.export_path).normalize('NFC')
        if (!path.startsWith(prefix)) {
          dropped.push(name || '附件')
          return false
        }
        const previous = seen.get(path)
        if (previous !== undefined && previous !== id) {
          dropped.push(name || '附件')
          return false
        }
        seen.set(path, id)
        return true
      })
    }
    if (dropped.length > 0) {
      const placeholder = dropped.map((name) => `[附件不可用：${name}]`).join('')
      const request = fragments.find(
        (fragment) =>
          fragment && typeof fragment === 'object' && (fragment as { type?: unknown }).type === 'REQUEST'
      ) as { content?: unknown } | undefined
      if (request && typeof request.content === 'string') {
        request.content += `\n\n${placeholder}`
      } else {
        fragments.push({ type: 'TIP', content: placeholder, style: 'INFO' })
      }
    }
  }
  return value
}

/**
 * 会话 JSON → 本地会话：JSON.parse + schema 校验 + 树构建。
 * 这段是 CPU 密集的纯计算，主线程与 Worker 共用同一份实现；
 * Worker 里执行时避免了大文本解析阻塞界面。
 */
export const parseSessionText = (text: string): ParsedSession => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
  const local = toLocalSession(readSessionFile(sanitizeFiles(value)))
  return {
    session: local.session,
    images: [...local.images],
    hasFiles: local.session.messages.some(
      (message) => message.role === 'user' && message.files.length > 0
    ),
  }
}
