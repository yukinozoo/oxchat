import * as db from '../db.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { EXTRAS_PATH, toExtrasFile } from './extras.js'
import { exportCharacterCards } from '../characters.js'
import { collectPortablePrefs } from '../portablePrefs.js'
import { tombstoneMap } from '../tombstones.js'
import { INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import type { ArchiveEntryInput } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 按导出格式逐条生成 ZIP 条目：manifest → 每个会话的 JSON + 它引用的图片 → index。
 * 顺序与导入端兼容（会话在 index 之前，图片跟在自己会话后面）。
 * 每个会话目录各写一份图片原件；其他附件只有元数据。
 * 生成是惰性的：同一时间只在内存里保留一个会话和它的图片，大库导出不再整包进内存。
 * loadImage 由调用方注入（正式环境读 IndexedDB，测试注入假实现）。
 */
export async function* archiveEntries(
  sessions: Iterable<Session> | AsyncIterable<Session>,
  loadImage: (id: string) => Promise<Blob | undefined> = db.loadFile,
  options: { includeImages?: boolean; includeExtras?: boolean } = {}
): AsyncGenerator<ArchiveEntryInput> {
  const includeImages = options.includeImages !== false
  /** 附加数据（记忆/角色/置顶/墓碑/偏好）默认带；关掉时整包只剩官方四段 */
  const includeExtras = options.includeExtras !== false
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  yield { name: MANIFEST_PATH, blob: json(manifest) }
  const index: SessionIndexEntry[] = []
  /** 官方格式装不下的本机数据（记忆笔记、折叠状态、置顶），最后单独写一个文件 */
  const extrasSessions: Session[] = []
  for await (const session of sessions) {
    extrasSessions.push(session)
    // 先取本会话引用的图片原件，会话写完即释放；不导出图片时完全不读原件
    const originals = new Map<string, Blob | undefined>()
    if (includeImages) {
      for (const message of session.messages) {
        if (message.role === 'user') {
          for (const file of message.files) {
            if (file.isImage && !originals.has(file.id)) {
              originals.set(file.id, await loadImage(file.id))
            }
          }
        }
      }
    }
    const images = new Map<string, Blob>()
    const data = toSessionFile(session, ({ id, name, isImage }) => {
      if (!includeImages) {
        return null
      }
      const blob = originals.get(id)
      if (!blob || !isImage) {
        return null
      }
      const path = imagePath(session.id, id, name)
      images.set(path, blob)
      return path
    })
    yield { name: sessionPath(session.id), blob: json(data) }
    for (const [name, blob] of images) {
      yield { name, blob }
    }
    index.push(toIndexEntry(data))
  }
  yield { name: INDEX_PATH, blob: json(index) }
  if (!includeExtras) {
    return
  }
  // 墓碑随包走：别的设备拉到包之后才知道哪些会话是「被删了」而不是「没打包」
  const extras = toExtrasFile(
    extrasSessions,
    tombstoneMap(),
    exportCharacterCards(),
    collectPortablePrefs()
  )
  if (extras) {
    yield { name: EXTRAS_PATH, blob: json(extras) }
  }
}
