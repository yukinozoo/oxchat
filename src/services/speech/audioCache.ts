/**
 * 朗读音频缓存与语音用量记录。
 *
 * 单独用一个 IndexedDB（`oxchat-speech`）：朗读缓存是「可再生数据」，
 * 不值得跟会话库共用版本迁移，清起来也不影响对话。
 */
const DB_NAME = 'oxchat-speech'
const DB_VERSION = 1
const AUDIO = 'audio'
const USAGE = 'usage'
/** 最多缓存多少段音频（一段十几秒的回复约 100–500KB） */
const AUDIO_LIMIT = 40

type AudioEntry = { key: string; pcm: ArrayBuffer; at: number }
export type SpeechUsage = {
  /** 记录时间戳，同时作为主键 */
  at: number
  kind: 'tts' | 'asr'
  /** 计费字符数（汉字算 2，其余算 1，见 speech/pricing.ts） */
  billedChars: number
  /** 语音包来源 */
  voice: string
}

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(AUDIO)) {
        db.createObjectStore(AUDIO, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(USAGE)) {
        db.createObjectStore(USAGE, { keyPath: 'at' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })

/** 文本指纹：同样内容 + 同样音色才算命中 */
export const audioKeyOf = (voice: string, text: string): string => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${voice}:${text.length}:${(hash >>> 0).toString(36)}`
}

export const loadSpeechAudio = async (key: string): Promise<ArrayBuffer | null> => {
  const db = await openDb()
  if (!db) {
    return null
  }
  return new Promise((resolve) => {
    const request = db.transaction(AUDIO, 'readonly').objectStore(AUDIO).get(key)
    request.onsuccess = () => {
      const entry = request.result as AudioEntry | undefined
      resolve(entry?.pcm ?? null)
    }
    request.onerror = () => resolve(null)
  })
}

export const saveSpeechAudio = async (key: string, pcm: ArrayBuffer): Promise<void> => {
  const db = await openDb()
  if (!db) {
    return
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(AUDIO, 'readwrite')
    tx.objectStore(AUDIO).put({ key, pcm, at: Date.now() } satisfies AudioEntry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  // 超量时按时间清掉最旧的
  const keys = await new Promise<string[]>((resolve) => {
    const request = db.transaction(AUDIO, 'readonly').objectStore(AUDIO).getAll()
    request.onsuccess = () => {
      const rows = request.result as AudioEntry[]
      rows.sort((a, b) => a.at - b.at)
      resolve(rows.map((row) => row.key))
    }
    request.onerror = () => resolve([])
  })
  const stale = keys.slice(0, Math.max(0, keys.length - AUDIO_LIMIT))
  if (stale.length === 0) {
    return
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(AUDIO, 'readwrite')
    for (const key of stale) {
      tx.objectStore(AUDIO).delete(key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

/** 记录一次语音用量（朗读 / 语音识别），供费用页展示 */
export const recordSpeechUsage = async (usage: SpeechUsage): Promise<void> => {
  const db = await openDb()
  if (!db) {
    return
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(USAGE, 'readwrite')
    tx.objectStore(USAGE).put(usage)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export const loadSpeechUsage = async (): Promise<SpeechUsage[]> => {
  const db = await openDb()
  if (!db) {
    return []
  }
  return new Promise((resolve) => {
    const request = db.transaction(USAGE, 'readonly').objectStore(USAGE).getAll()
    request.onsuccess = () => {
      const rows = request.result as SpeechUsage[]
      resolve(rows.sort((a, b) => b.at - a.at))
    }
    request.onerror = () => resolve([])
  })
}
