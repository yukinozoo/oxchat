import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { cleanSessionText } from './clean.js'
import { fromSettingRecord, toSettingRecord } from './settingsRecord.js'
import { summarizeRows } from './summaryRows.js'
import {
  deleteNativeFile,
  nativeFileIds,
  nativeFilesAvailable,
  readNativeFile,
  writeNativeFile,
} from './nativeFiles.js'
import { fileStorePreference } from './fileStorePreference.js'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 12

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
  /** 少量大设置项（如背景图 base64），避免和 API Key 抢 localStorage 的 5MB */
  settings: { key: string; value: string }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('oxchat', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of [
        'sessions',
        'files',
        'sessionsStaging',
        'filesStaging',
        'settings',
      ] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
    /**
     * 另一个标签页要用更高版本打开数据库：主动断开自己，别把它卡在 blocked。
     * 不加的话，用户同时开着两个标签页时，新版本页面会一直停在「正在加载对话…」。
     */
    blocking() {
      void dbPromise
        ?.then((db) => db.close())
        .catch(() => undefined)
      dbPromise = null
    },
    // 自己这个连接收到版本变更请求时同样让路
    terminated() {
      dbPromise = null
    },
    /** 升级被别的标签页挡住：旧版本页面没有让路逻辑，只能等它关闭 */
    blocked() {
      // eslint-disable-next-line no-console
      console.warn('[storage] 数据库升级被其他标签页占用，关闭其他页面后刷新即可')
    },
  }).then((db) => {
    db.addEventListener('versionchange', () => db.close())
    return db
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

/**
 * 读取会话列表。
 *
 * `getAll` 是整批反序列化：任意一条坏记录都会让整个读取 reject，界面表现为
 * 「会话全没了」。所以失败时退化成按主键逐条读，坏的那条只丢自己。
 */
export const loadSessionSummaries = async (): Promise<SessionSummary[]> => {
  const db = await getDB()
  try {
    return summarizeRows(await db.getAll('sessionSummaries'))
  } catch {
    const keys = await db.getAllKeys('sessionSummaries')
    const rows = await Promise.all(
      keys.map((key) => db.get('sessionSummaries', key).catch(() => undefined))
    )
    return summarizeRows(rows)
  }
}

/** 读会话：顺手清洗文本，让已经写进库里的脏历史自愈（没有改动时返回原对象） */
export const loadSession = async (id: string): Promise<Session | undefined> => {
  const session = await (await getDB()).get('sessions', id)
  return session === undefined ? undefined : cleanSessionText(session)
}

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  // 写库前清洗：协议标记与孤立代理不进库（thinking 原文保留，续写签名要用）
  const cleaned = cleanSessionText(session)
  const summary = storedSummary(cleaned)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(cleaned)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 置顶/取消置顶：只改摘要里的标记，未加载的会话也能直接标记。 */
export const setSessionPinned = async (id: string, pinned: boolean): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.pinned = pinned
          await sessions.put(session)
        }
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(id)
        if (summary) {
          if (pinned) {
            summary.pinned = true
          } else {
            delete summary.pinned
          }
          await summaries.put(summary)
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  /** 事务里删掉的附件 id：事务结束后再删原生目录里的原件 */
  const orphaned: string[] = []
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
            orphaned.push(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/**
 * 附件原件是否走原生目录。
 *
 * 条件：插件存在（只在安卓壳里）+ 用户没显式选回 IndexedDB。
 * 迁移没跑完时读路径仍然回退 IndexedDB，所以中途切换不会丢文件。
 */
export const useNativeFiles = (): boolean =>
  nativeFilesAvailable() && fileStorePreference() !== 'idb'

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  if (store === 'files' && useNativeFiles()) {
    // 落原生目录：不进 IndexedDB，省掉 base64 与 Blob 双份内存
    for (const file of files) {
      await writeNativeFile(file, file.blob.type || 'application/octet-stream')
    }
    return
  }
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> => {
  if (useNativeFiles()) {
    const native = await readNativeFile(id)
    if (native) {
      return native
    }
    // 迁移前写入的旧附件还在 IndexedDB 里：读路径继续兜住
  }
  return (await (await getDB()).get('files', id))?.blob
}

/**
 * 把 IndexedDB 里的附件一次性搬到原生目录。
 *
 * 顺序刻意保守：先写原生 → 逐条确认能读回同样大小 → 再删 IndexedDB 那一行。
 * 中途失败可以直接重跑（原生写是覆盖写），不会留下"两边都没有"的窗口。
 * 返回搬迁数量；没有插件或已搬过时返回 0。
 */
export const migrateFilesToNative = async (): Promise<number> => {
  if (!useNativeFiles()) {
    return 0
  }
  const db = await getDB()
  const stored = await db.getAll('files')
  let moved = 0
  for (const file of stored) {
    try {
      await writeNativeFile(file, file.blob.type || 'application/octet-stream')
      const back = await readNativeFile(file.id)
      if (!back || back.size !== file.blob.size) {
        continue
      }
      await (await getDB()).delete('files', file.id)
      moved += 1
    } catch {
      // 单条失败就跳过，下次启动重试；不能因为一个坏文件卡住整次迁移
    }
  }
  return moved
}

/** 反向：原生目录里多余的文件（会话已删但文件还在）清掉；返回清理数量 */
export const pruneNativeFiles = async (): Promise<number> => {
  if (!useNativeFiles()) {
    return 0
  }
  const db = await getDB()
  const referenced = new Set<string>()
  for (const summary of await db.getAll('sessionSummaries')) {
    for (const id of (summary as StoredSessionSummary).fileIds ?? []) {
      referenced.add(id)
    }
  }
  let removed = 0
  for (const id of await nativeFileIds()) {
    if (!referenced.has(id)) {
      await deleteNativeFile(id)
      removed += 1
    }
  }
  return removed
}

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

/** 批量写暂存会话：一次事务写完一批，避免一条会话一次事务的提交开销。 */
export const addStagingSessions = async (sessions: Session[]): Promise<void> => {
  if (sessions.length === 0) {
    return
  }
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([...sessions.map((session) => tx.store.add(session)), tx.done])
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。
 * 传入 sessionIds 时只扫这些会话，避免大导入时把全部会话重读一遍。 */
export const updateStagingFileTypes = async (
  types: ReadonlyMap<string, string>,
  sessionIds?: ReadonlySet<string>
): Promise<void> => {
  if (types.size === 0) {
    return
  }
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  const iterate = async function* () {
    if (!sessionIds) {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        yield cursor
      }
      return
    }
    for (const id of sessionIds) {
      const cursor = await tx.store.openCursor(IDBKeyRange.only(id))
      if (cursor) {
        yield cursor
      }
    }
  }
  await Promise.all([
    (async () => {
      for await (const cursor of iterate()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 * merge 为 true 时不清理正式数据，只把暂存内容并入（导入去重后的新增会话）。
 */
export const commitStaging = async (merge = false): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      if (!merge) {
        await target.clear()
        if (to === 'sessions') {
          await tx.objectStore('sessionSummaries').clear()
        }
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const summary = storedSummary(cursor.value as Session)
          await tx.objectStore('sessionSummaries').put(summary)
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  if (useNativeFiles()) {
    // 原生模式：暂存里的附件先落到私有目录，再清空暂存（不进 IndexedDB）
    const staging = await (await getDB()).getAll('filesStaging')
    for (const file of staging) {
      await writeNativeFile(file, file.blob.type || 'application/octet-stream')
    }
    await Promise.all([
      move('sessionsStaging', 'sessions'),
      (await getDB()).clear('filesStaging'),
      tx.done,
    ])
  } else {
    await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  }
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}

/** 大设置项读写（背景图等）：value 直接存字符串 */

/**
 * 设置表兼容两种建表方式：
 * - 新库：`createObjectStore('settings', { keyPath: 'id' })` → 只能 put({ id, value })
 * - 旧库：外置键 → put(value, key)
 * 之前一律按外置键写，新库上 `put(value, key)` 会抛 DataError（背景图一直存不进去）。
 */
/** 只用到这几个成员的窄接口：两种建表方式共用 */
type SettingStore = {
  keyPath: string | string[] | null
  get(key: string): Promise<unknown>
  put(value: unknown, key?: string): Promise<unknown>
  delete(key: string): Promise<void>
}

const settingsStore = async (mode: IDBTransactionMode): Promise<SettingStore> => {
  const db = await getDB()
  return db.transaction('settings', mode).objectStore('settings') as unknown as SettingStore
}

export const getSetting = async (key: string): Promise<string | undefined> => {
  const store = await settingsStore('readonly')
  return fromSettingRecord(await store.get(key))
}

export const setSetting = async (key: string, value: string): Promise<void> => {
  const store = await settingsStore('readwrite')
  if (store.keyPath) {
    await store.put(toSettingRecord(key, value))
  } else {
    await store.put(value, key)
  }
}

export const deleteSetting = async (key: string): Promise<void> => {
  const store = await settingsStore('readwrite')
  await store.delete(key)
}

/** 清理没有被任何会话引用的附件原件（IndexedDB 与原生目录都扫一遍） */
export const pruneFiles = async (): Promise<{ removed: number; bytes: number }> => {
  const db = await getDB()
  const tx = db.transaction(['files', 'sessionSummaries'], 'readwrite')
  const summaries = tx.objectStore('sessionSummaries')
  const files = tx.objectStore('files')
  let removed = 0
  let bytes = 0
  await Promise.all([
    (async () => {
      for (let cursor = await files.openCursor(); cursor; cursor = await cursor.continue()) {
        const id = String(cursor.key)
        if ((await summaries.index('fileIds').count(id)) === 0) {
          bytes += cursor.value.blob.size
          await cursor.delete()
          removed += 1
        }
      }
    })(),
    tx.done,
  ])
  const nativeRemoved = await pruneNativeFiles()
  return { removed: removed + nativeRemoved, bytes }
}
