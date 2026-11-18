import { BackupError } from './errors.js'
import { parseSessionText } from './sessionParse.js'

/**
 * 会话解析 Worker：JSON.parse、schema 校验与会话树构建都在这里跑，
 * 主线程只接收结果对象，大对话解析不再卡住界面。
 */

type Request = { id: number; text: string }
type Success = {
  id: number
  ok: true
  session: unknown
  images: [string, string][]
  hasFiles: boolean
}
type Failure = { id: number; ok: false; key?: string; message: string }

const post = (message: Success | Failure) => self.postMessage(message)

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, text } = event.data
  try {
    post({ id, ok: true, ...parseSessionText(text) })
  } catch (error) {
    post({
      id,
      ok: false,
      key: error instanceof BackupError ? error.key : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
