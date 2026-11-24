import { openDB, type IDBPDatabase } from 'idb'

/**
 * 文档正文片段：上传时从本地抽取结果里留一段，压缩时拼进摘要转录。
 *
 * 为什么单独一个库：主库 `oxchat` 的版本号一旦升就不可逆（旧代码打开新库会 VersionError），
 * 而这个片段只是「摘要的参考资料」，丢了也不影响聊天。放在独立的 `oxchat-file-text` 里，
 * 退版本最多少一段摘要依据，数据本身安然无恙。
 *
 * 键是 Files API 返回的 file_id（消息里 `file.serverId`），不是本地 id：
 * 同一份原件被多条消息引用时也只需要存一份。
 */
const DB_NAME = 'oxchat-file-text'
const DB_VERSION = 1
const STORE = 'excerpts'
/** 每个文档最多留这么多字（进转录时还会再按总量截断） */
export const EXCERPT_CHARS = 2_000

type Row = { text: string; at: number }

let connection: Promise<IDBPDatabase> | undefined
const database = () =>
  (connection ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(store) {
      store.createObjectStore(STORE)
    },
  }))

/** 存一段文档片段；压缩前没读过也没关系，压缩时会退化成只有文件名 */
export const saveFileExcerpt = async (
  fileId: string | null | undefined,
  text: string
): Promise<void> => {
  if (!fileId || !text) {
    return
  }
  // 换行与全角空格压成普通空格：转录里一段连排更好读，也省 token
  const clean = text.replace(/[\s\u3000]+/g, ' ').trim()
  if (!clean) {
    return
  }
  try {
    const db = await database()
    await db.put(STORE, { text: clean.slice(0, EXCERPT_CHARS), at: Date.now() }, fileId)
  } catch {
    // 存不下不影响上传：最多是摘要里少一段依据
  }
}

/** 批量取片段：拿不到的 id 直接跳过 */
export const loadFileExcerpts = async (
  ids: readonly (string | null | undefined)[]
): Promise<Map<string, string>> => {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const result = new Map<string, string>()
  if (unique.length === 0) {
    return result
  }
  try {
    const db = await database()
    const rows = await Promise.all(unique.map((id) => db.get(STORE, id) as Promise<Row | undefined>))
    rows.forEach((row, index) => {
      if (row?.text) {
        result.set(unique[index], row.text)
      }
    })
  } catch {
    // 库不可用（隐私模式 / 老内核）：当作没有片段
  }
  return result
}

/** 清理（给「清理未使用附件」这类维护入口复用） */
export const clearFileExcerpts = async (ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) {
    return
  }
  try {
    const db = await database()
    await Promise.all(ids.map((id) => db.delete(STORE, id)))
  } catch {
    // 忽略
  }
}
