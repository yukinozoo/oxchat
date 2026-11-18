import type { Session } from '../types.js'
import { BackupError } from './errors.js'
import { parseSessionText, type ParsedSession } from './sessionParse.js'

type Reply = {
  id: number
  ok: boolean
  session?: Session
  images?: [string, string][]
  hasFiles?: boolean
  key?: string
  message?: string
}

let parser: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, (error: Error) => void>()

const getParser = (): Worker | null => {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (!parser) {
    try {
      parser = new Worker(new URL('./sessionParse.worker.ts', import.meta.url))
      parser.addEventListener('error', () => {
        const failed = [...pending.values()]
        pending.clear()
        for (const reject of failed) {
          // 普通 Error：调用方据此退回主线程解析，不当作数据错误
          reject(new Error('session parser worker crashed'))
        }
        parser = null
      })
    } catch {
      // 创建失败（旧内核/策略限制）时退回主线程解析
      return null
    }
  }
  return parser
}

/**
 * 在 Worker 里解析会话 JSON：解析、校验与树构建不再阻塞主线程。
/**
 * 低于该长度的会话直接在主线程解析：一次 Worker 消息往返（含结构化克隆）的开销
 * 往往大于解析本身，小会话走 Worker 反而拖慢批量导入；只有大会话才值得挪走。
 */
const WORKER_PARSE_MIN_CHARS = 256 * 1024

/**
 * 解析会话 JSON：小会话同步解析，大会话交给 Worker，避免阻塞界面。
 * Worker 不可用或崩溃时退回主线程，保证导入不会因运行环境差异失败；
 * 数据本身不合法（BackupError）则原样抛出。
 */
export const parseSessionAsync = async (text: string): Promise<ParsedSession> => {
  if (text.length < WORKER_PARSE_MIN_CHARS) {
    return parseSessionText(text)
  }
  const worker = getParser()
  if (!worker) {
    return parseSessionText(text)
  }
  try {
    return await postToWorker(worker, text)
  } catch (error) {
    if (error instanceof BackupError) {
      throw error
    }
    // Worker 环境异常：丢弃它，退回同步解析
    parser = null
    return parseSessionText(text)
  }
}

const postToWorker = (worker: Worker, text: string): Promise<ParsedSession> => {
  const id = ++nextRequestId
  return new Promise<ParsedSession>((resolve, reject) => {
    pending.set(id, reject)
    const onMessage = (event: MessageEvent<Reply>) => {
      const data = event.data
      if (data.id !== id) {
        return
      }
      worker.removeEventListener('message', onMessage)
      pending.delete(id)
      if (!data.ok || !data.session) {
        reject(
          data.key
            ? new BackupError(data.key as BackupError['key'])
            : new Error(data.message ?? 'session parse failed')
        )
        return
      }
      resolve({
        session: data.session,
        images: data.images ?? [],
        hasFiles: data.hasFiles ?? false,
      })
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ id, text })
  })
}
