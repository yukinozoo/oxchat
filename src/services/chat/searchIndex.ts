import { openDB, type IDBPDatabase } from 'idb'
import * as db from './db.js'
import { messageText } from './searchText.js'
import type { Session } from './types.js'

/**
 * 正文搜索索引。
 *
 * 为什么单独一个库：把索引放进主库 `oxchat` 就得升 DB 版本，而版本号是**不可逆**的
 * （旧版本代码打开新库会 `VersionError`，网页端旧缓存尤其容易踩）。放进独立的
 * `oxchat-search` 之后，旧版本根本不会打开这个库 —— 退回去只是「没有索引、搜索变慢」，
 * 数据与功能都正常。
 *
 * 数据形态：一个会话一条记录 `{ id, updatedAt, docVersion, docs[] }`，
 * 每条 doc 是「一条消息的可见文本」。搜索时整体读进内存做 `indexOf`，
 * 搜索期间零 IO；会话保存后防抖重建，删除时同步清掉。
 */
const DB_NAME = 'oxchat-search'
const DB_VERSION = 1
const STORE = 'sessionDocs'
/** 文档格式版本：取文本的规则变了就加一，旧文档会被当成脏的重建 */
export const DOC_VERSION = 1
/** 保存会话后多久重建索引：流式输出时会连续保存，攒一下再写 */
const REINDEX_DELAY_MS = 1_200
/** 一次启动最多补多少条历史会话：避免首次升级时把手机拖住 */
export const WARM_LIMIT = 120
/** 内存快照的字数上限：超过就不再把新会话读进内存（剩下的走直读兜底） */
const SNAPSHOT_CHAR_LIMIT = 30_000_000

export type SearchDoc = {
  messageId: string
  role: 'user' | 'assistant'
  text: string
}

type SessionDocs = {
  id: string
  updatedAt: number
  docVersion: number
  docs: SearchDoc[]
}

let dbPromise: Promise<IDBPDatabase | null> | null = null

/** 索引库不可用（网页被禁、Node 环境）时返回 null，调用方自动退回直读 */
const getDB = (): Promise<IDBPDatabase | null> => {
  if (dbPromise) {
    return dbPromise
  }
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'id' })
      }
    },
    blocking() {
      void dbPromise?.then((database) => database?.close()).catch(() => undefined)
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
  })
    .then((database) => database as unknown as IDBPDatabase)
    .catch(() => {
      dbPromise = null
      return null
    })
  return dbPromise
}

/** 会话 → 文档列表（只留非空文本） */
export const buildSessionDocs = (session: Session): SearchDoc[] => {
  const docs: SearchDoc[] = []
  for (const message of session.messages) {
    const text = messageText(message).trim()
    if (!text) {
      continue
    }
    docs.push({ messageId: message.id, role: message.role, text })
  }
  return docs
}

/** 立刻写入一条会话的索引（updatedAt 没变就跳过） */
export const indexSession = async (session: Session): Promise<boolean> => {
  const database = await getDB()
  if (!database) {
    return false
  }
  try {
    const existing = (await database.get(STORE, session.id)) as SessionDocs | undefined
    if (existing && existing.updatedAt === session.updatedAt && existing.docVersion === DOC_VERSION) {
      return false
    }
    const record: SessionDocs = {
      id: session.id,
      updatedAt: session.updatedAt,
      docVersion: DOC_VERSION,
      docs: buildSessionDocs(session),
    }
    await database.put(STORE, record)
    invalidateSnapshot()
    return true
  } catch {
    return false
  }
}

/** 待重建的会话（防抖用） */
const pending = new Map<string, Session>()
let timer: number | null = null

/** 保存会话后调用：攒 1.2 秒再重建，流式输出期间不会每帧写一次索引 */
export const scheduleSessionIndex = (session: Session): void => {
  pending.set(session.id, session)
  if (timer !== null) {
    return
  }
  timer = (globalThis.setTimeout(() => {
    timer = null
    void flushSearchIndex()
  }, REINDEX_DELAY_MS) as unknown) as number
}

/** 立刻把待写入的会话落到索引（切后台、页面隐藏时调用） */
export const flushSearchIndex = async (): Promise<void> => {
  if (timer !== null) {
    globalThis.clearTimeout(timer as unknown as number)
    timer = null
  }
  if (pending.size === 0) {
    return
  }
  const batch = [...pending.values()]
  pending.clear()
  for (const session of batch) {
    await indexSession(session)
  }
}

export const dropSessionIndex = async (id: string): Promise<void> => {
  pending.delete(id)
  const database = await getDB()
  if (!database) {
    return
  }
  try {
    await database.delete(STORE, id)
    invalidateSnapshot()
  } catch {
    // 删不掉只是留下孤儿索引，不影响搜索正确性（快照会按会话列表过滤）
  }
}

/** 已索引会话的 updatedAt：启动时据此判断哪些是脏的 */
export const indexedVersions = async (): Promise<Map<string, number>> => {
  const database = await getDB()
  if (!database) {
    return new Map()
  }
  const map = new Map<string, number>()
  try {
    for (const record of (await database.getAll(STORE)) as SessionDocs[]) {
      if (record.docVersion === DOC_VERSION) {
        map.set(record.id, record.updatedAt)
      }
    }
  } catch {
    return new Map()
  }
  return map
}

export type IndexSnapshot = {
  /** 已进内存的会话：id → 文档 */
  byId: Map<string, SearchDoc[]>
  /** 内存里的总字数，用于判断是否还装得下 */
  chars: number
}

let snapshot: IndexSnapshot | null = null

export const invalidateSnapshot = (): void => {
  snapshot = null
}

/**
 * 读一份内存快照（全量索引）。
 *
 * 只包含**已经建好索引**的会话；没建好的由调用方直读兜底，所以结果不会漏。
 */
export const loadIndexSnapshot = async (): Promise<IndexSnapshot> => {
  if (snapshot) {
    return snapshot
  }
  const empty: IndexSnapshot = { byId: new Map(), chars: 0 }
  const database = await getDB()
  if (!database) {
    snapshot = empty
    return empty
  }
  const byId = new Map<string, SearchDoc[]>()
  let chars = 0
  try {
    for (const record of (await database.getAll(STORE)) as SessionDocs[]) {
      if (record.docVersion !== DOC_VERSION) {
        continue
      }
      if (chars >= SNAPSHOT_CHAR_LIMIT) {
        break
      }
      byId.set(record.id, record.docs)
      chars += record.docs.reduce((total, doc) => total + doc.text.length, 0)
    }
  } catch {
    // 读失败就当没有索引，全部走直读
  }
  snapshot = { byId, chars }
  return snapshot
}

/**
 * 后台补索引：把「没有索引 / 索引过期」的会话补上，每次最多 WARM_LIMIT 条。
 * 首次升级到带索引的版本时，会在前几次启动里慢慢补完，不会卡住界面。
 */
export const warmSearchIndex = async (
  sessions: readonly { id: string; updatedAt: number }[],
  options: { limit?: number } = {}
): Promise<number> => {
  const versions = await indexedVersions()
  const limit = options.limit ?? WARM_LIMIT
  let done = 0
  for (const summary of sessions) {
    if (done >= limit) {
      break
    }
    if (versions.get(summary.id) === summary.updatedAt) {
      continue
    }
    const session = await db.loadSession(summary.id).catch(() => undefined)
    if (!session) {
      continue
    }
    if (await indexSession(session)) {
      done += 1
    }
  }
  return done
}
