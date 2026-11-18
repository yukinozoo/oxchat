import type { Session } from '../types.js'
import { fail } from './errors.js'
import { readSessionFile } from './schema.js'
import { toLocalSession } from './toLocal.js'

/** 会话 JSON 的解析产物：本地会话 + 图片路径映射 + 是否引用附件 */
export type ParsedSession = {
  session: Session
  images: [string, string][]
  hasFiles: boolean
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
  const local = toLocalSession(readSessionFile(value))
  return {
    session: local.session,
    images: [...local.images],
    hasFiles: local.session.messages.some(
      (message) => message.role === 'user' && message.files.length > 0
    ),
  }
}
