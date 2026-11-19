import { Inflate, inflateSync } from 'fflate'
import { parseSessionPath } from './paths.js'

const READ_CHUNK_BYTES = 256 * 1024

/** 解压放到 Worker，主线程只负责读文件与写库；不支持 Worker 时退回同步解压 */
type InflateSink = { push: (chunk: Uint8Array, final: boolean) => Promise<Uint8Array[]> }

let inflateWorker: Worker | null = null
/** 正在等待 Worker 回包的请求，Worker 崩溃时统一拒绝，避免导入永久挂起 */
const pendingInflate = new Map<string, (error: Error) => void>()

const getInflateWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (!inflateWorker) {
    try {
      inflateWorker = new Worker(new URL('./zipInflate.worker.ts', import.meta.url))
      inflateWorker.addEventListener('error', () => {
        const failed = [...pendingInflate.values()]
        pendingInflate.clear()
        for (const reject of failed) {
          reject(new ArchiveError())
        }
        inflateWorker = null
      })
    } catch {
      // 创建失败（旧内核/策略限制）时退回主线程解压
      return null
    }
  }
  return inflateWorker
}

const openInflateSink = (id: string): InflateSink | null => {
  const worker = getInflateWorker()
  if (!worker) {
    return null
  }
  return {
    push: (chunk, final) =>
      new Promise<Uint8Array[]>((resolve, reject) => {
        pendingInflate.set(id, reject)
        const onMessage = (event: MessageEvent) => {
          const data = event.data as { id: string; chunks?: Uint8Array[]; error?: string }
          if (data.id !== id) {
            return
          }
          worker.removeEventListener('message', onMessage)
          pendingInflate.delete(id)
          if (data.error) {
            reject(new ArchiveError())
            return
          }
          resolve(data.chunks ?? [])
        }
        worker.addEventListener('message', onMessage)
        // 复制一份再转移，避免 detach 掉后面还要用到的分片
        const copy = new Uint8Array(chunk)
        worker.postMessage({ id, data: copy, final }, [copy.buffer])
      }),
  }
}
// 控制每轮同步解压的工作量；输出交给调用方保存后才继续读取。
// 分片越大，主线程与 Worker 间的往返越少；64KB 在内存占用与通信开销间取平衡。
const INFLATE_CHUNK_BYTES = 64 * 1024

/** ZIP 结构损坏或使用了不支持的特性 */
export class ArchiveError extends Error {
  constructor() {
    super('Invalid or unsupported history archive')
    this.name = 'ArchiveError'
  }
}

const invalid = (): never => {
  throw new ArchiveError()
}

/** 本地文件头签名 PK\x03\x04，用于在解析前区分 ZIP 与其他文件。 */
export const isZipFile = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return bytes.length === 4 && bytes.every((byte, index) => byte === [0x50, 0x4b, 3, 4][index])
}

/**
 * 预扫描：只读 ZIP 中央目录，统计会话 JSON 条目数，不解压数据。
 * 仅用于进度显示，任何失败都返回 0，绝不阻断导入。
 */
export const countArchiveSessions = async (file: File): Promise<number> => {
  try {
    const { entries } = await readDirectoryCached(file)
    return entries.filter((entry) => parseSessionPath(entry.path) !== null).length
  } catch {
    return 0
  }
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

const readBytes = async (file: File, start: number, length: number) => {
  if (start < 0 || length < 0 || start + length > file.size) {
    invalid()
  }
  const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
  if (bytes.length !== length) {
    invalid()
  }
  return bytes
}

/** ZIP64、分卷与加密文件不属于导出格式，一律拒绝。 */
const checkExtra = (bytes: Uint8Array) => {
  const view = viewOf(bytes)
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length || view.getUint16(offset, true) === 1) {
      invalid()
    }
    offset += 4 + view.getUint16(offset + 2, true)
    if (offset > bytes.length) {
      invalid()
    }
  }
}

const decodePath = (bytes: Uint8Array, flags: number) => {
  // 非 UTF-8 编码的 ZIP 文件名仅接受 ASCII，确保附件路径解码准确。
  if (!(flags & 0x800) && bytes.some((byte) => byte > 0x7f)) {
    invalid()
  }
  const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC')
  if (!path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    invalid()
  }
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid()
  }
  return path
}

type Entry = {
  path: string
  name: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
}

const readDirectory = async (file: File): Promise<{ entries: Entry[]; offset: number }> => {
  if (file.size < 22) {
    invalid()
  }
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = await readBytes(file, tailStart, file.size - tailStart)
  const tailView = viewOf(tail)
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tailView.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tailView.getUint16(end + 20, true) !== tail.length)
  ) {
    end--
  }
  if (end < 0) {
    invalid()
  }
  const count = tailView.getUint16(end + 10, true)
  const size = tailView.getUint32(end + 12, true)
  const offset = tailView.getUint32(end + 16, true)
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    offset + size !== tailStart + end
  ) {
    invalid()
  }
  const entries: Entry[] = []
  const paths = new Set<string>()
  // 中央目录一次读完再解析：Android WebView 里每次 file.slice() 都是跨进程异步调用，
  // 按条目逐字段读取会产生 3×条目数 次调用（100 条对话约 300 次），是导入慢的主因。
  const directory = await readBytes(file, offset, size)
  const view = viewOf(directory)
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size) {
      invalid()
    }
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      invalid()
    }
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const entrySize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const next = cursor + 46 + nameLength + extraLength + view.getUint16(cursor + 32, true)
    const entryOffset = view.getUint32(cursor + 42, true)
    // 只允许 deflate 选项、data descriptor 与 UTF-8 标志。
    if (
      flags & ~0x80e ||
      (method !== 0 && method !== 8) ||
      compressedSize === 0xffffffff ||
      entrySize === 0xffffffff ||
      (method === 0 && compressedSize !== entrySize) ||
      entryOffset >= offset ||
      view.getUint16(cursor + 34, true) !== 0 ||
      ((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) === 0xa000 ||
      next > size
    ) {
      invalid()
    }
    const name = directory.subarray(cursor + 46, cursor + 46 + nameLength)
    const path = decodePath(name, flags)
    // 目录和同名文件也不能互相覆盖。
    const identity = path.endsWith('/') ? path.slice(0, -1) : path
    if (paths.has(identity) || (path.endsWith('/') && entrySize !== 0)) {
      invalid()
    }
    paths.add(identity)
    checkExtra(directory.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength))
    entries.push({
      path,
      name,
      flags,
      method,
      crc: view.getUint32(cursor + 16, true),
      compressedSize,
      size: entrySize,
      offset: entryOffset,
    })
    cursor = next
  }
  if (cursor !== size) {
    invalid()
  }
  return { entries: entries.sort((a, b) => a.offset - b.offset), offset }
}

/**
 * 同一个 File 的中央目录只解析一次：预校验、数量预扫描与正式导入共用。
 * 失败不缓存，允许后续重试。
 */
const directoryCache = new WeakMap<File, Promise<{ entries: Entry[]; offset: number }>>()

/**
 * 按中央目录的偏移直接读一个条目，不线性扫描整个归档。
 * 只取 index 这类小文件时，几百兆的包也只读几千字节。
 */
export const readEntryByPath = async (file: File, target: string): Promise<Blob | null> => {
  const { entries } = await readDirectoryCached(file)
  const wanted = target.normalize('NFC')
  const entry = entries.find((item) => item.path.normalize('NFC') === wanted)
  if (!entry) {
    return null
  }
  const head = await readBytes(
    file,
    entry.offset,
    Math.min(META_READ_BYTES, Math.max(0, file.size - entry.offset))
  )
  if (head.length < 30) {
    invalid()
  }
  const view = viewOf(head)
  if (view.getUint32(0, true) !== 0x04034b50) {
    invalid()
  }
  const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true)
  const parts: Uint8Array[] = []
  for (let offset = 0; offset < entry.compressedSize; offset += READ_CHUNK_BYTES) {
    parts.push(
      await readBytes(
        file,
        start + offset,
        Math.min(READ_CHUNK_BYTES, entry.compressedSize - offset)
      )
    )
  }
  const compressed = new Uint8Array(entry.compressedSize)
  let written = 0
  for (const part of parts) {
    compressed.set(part, written)
    written += part.length
  }
  const data = entry.method === 8 ? inflateSync(compressed) : compressed
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    invalid()
  }
  return new Blob([data])
}

/** 与归档里一致的 CRC32 校验 */
const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    value = (value >>> 8) ^ crcTable[(value ^ bytes[index]) & 0xff]
  }
  return (value ^ 0xffffffff) >>> 0
}

/** 只读中央目录列出条目：导入时按偏移跳读，不再顺序扫描整个归档 */
export const listArchiveEntries = async (
  file: File
): Promise<{ path: string; size: number }[]> => {
  const { entries } = await readDirectoryCached(file)
  return entries.map((entry) => ({ path: entry.path.normalize('NFC'), size: entry.size }))
}

/** 只读中央目录列出条目名：判断引用是否还有对应文件时用，不解压任何数据 */
export const listArchivePaths = async (file: File): Promise<Set<string>> => {
  const { entries } = await readDirectoryCached(file)
  return new Set(entries.map((entry) => entry.path.normalize('NFC')))
}

const readDirectoryCached = (file: File): Promise<{ entries: Entry[]; offset: number }> => {
  const cached = directoryCache.get(file)
  if (cached) {
    return cached
  }
  const task = readDirectory(file)
  directoryCache.set(file, task)
  task.catch(() => directoryCache.delete(file))
  return task
}

/** 本地头 + 文件名 + extra 的合并读取上限：一次覆盖常见条目，超出再补读 */
const META_READ_BYTES = 30 + 1024

const readEntryOffset = async (file: File, entry: Entry, boundary: number) => {
  if (entry.offset + 30 > boundary) {
    invalid()
  }
  // 一次读出本地头与文件名/extra：Android 上每次 slice() 都是跨进程调用，
  // 合并后每个条目少一次调用，大归档导入明显更快。
  let meta = await readBytes(file, entry.offset, Math.min(boundary - entry.offset, META_READ_BYTES))
  let view = viewOf(meta)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const metaEnd = 30 + nameLength + extraLength
  if (metaEnd > meta.length) {
    meta = await readBytes(file, entry.offset, Math.min(boundary - entry.offset, metaEnd))
    view = viewOf(meta)
  }
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.method ||
    nameLength !== entry.name.length ||
    end > boundary
  ) {
    invalid()
  }
  for (const [position, expected] of [
    [14, entry.crc],
    [18, entry.compressedSize],
    [22, entry.size],
  ]) {
    const actual = view.getUint32(position, true)
    if (actual !== expected && (!(entry.flags & 8) || actual !== 0)) {
      invalid()
    }
  }
  const metadata = meta.subarray(30, metaEnd)
  if (entry.name.some((byte, index) => byte !== metadata[index])) {
    invalid()
  }
  checkExtra(metadata.subarray(nameLength))
  if (entry.flags & 8) {
    if (end + 12 > boundary) {
      invalid()
    }
    const descriptor = viewOf(await readBytes(file, end, Math.min(16, boundary - end)))
    const shift = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0
    if (
      shift + 12 > descriptor.byteLength ||
      descriptor.getUint32(shift, true) !== entry.crc ||
      descriptor.getUint32(shift + 4, true) !== entry.compressedSize ||
      descriptor.getUint32(shift + 8, true) !== entry.size
    ) {
      invalid()
    }
  }
  return start
}

export type ArchiveEntry = {
  path: string
  size: number
  stream: AsyncIterable<Uint8Array>
}

/**
 * 按条目在文件中的物理顺序逐条、逐块解压，跳过目录条目。
 * 调用方必须消费完当前条目的数据，再请求下一个条目。
 * 进度按已处理的压缩字节报告，大归档下平滑推进。
 */
export async function* readArchive(
  file: File,
  onProgress?: (done: number, total: number) => void
): AsyncGenerator<ArchiveEntry> {
  const directory = await readDirectoryCached(file)
  const origin = directory.entries[0]?.offset ?? 0
  const total = Math.max(0, directory.offset - origin)
  const report = (position: number) =>
    onProgress?.(Math.min(total, Math.max(0, position - origin)), total)
  report(0)
  for (const [index, entry] of directory.entries.entries()) {
    const boundary = directory.entries[index + 1]?.offset ?? directory.offset
    const start = await readEntryOffset(file, entry, boundary)
    if (entry.path.endsWith('/')) {
      report(start)
      continue
    }
    let completed = false
    const stream = async function* (): AsyncGenerator<Uint8Array> {
      let written = 0
      let crc = 0xffffffff
      const pending: Uint8Array[] = []
      const append = (chunk: Uint8Array) => {
        written += chunk.length
        if (written > entry.size) {
          invalid()
        }
        // 索引循环 + 局部变量：大归档（数百 MB）下比 for...of 迭代快数倍
        let value = crc
        for (let index = 0; index < chunk.length; index++) {
          value = (value >>> 8) ^ crcTable[(value ^ chunk[index]) & 0xff]
        }
        crc = value
        if (chunk.length) {
          pending.push(chunk)
        }
      }
      const sink = entry.method === 8 ? openInflateSink(`${entry.offset}`) : null
      const inflate = entry.method === 8 && !sink ? new Inflate(append) : null
      for (let offset = 0; offset < entry.compressedSize; offset += READ_CHUNK_BYTES) {
        const chunk = await readBytes(
          file,
          start + offset,
          Math.min(READ_CHUNK_BYTES, entry.compressedSize - offset)
        )
        report(start + offset + chunk.length)
        if (!inflate && !sink) {
          append(chunk)
          yield* pending.splice(0)
          continue
        }
        for (let cursor = 0; cursor < chunk.length; cursor += INFLATE_CHUNK_BYTES) {
          const end = Math.min(cursor + INFLATE_CHUNK_BYTES, chunk.length)
          const final = offset + end === entry.compressedSize
          if (sink) {
            for (const piece of await sink.push(chunk.subarray(cursor, end), final)) {
              append(piece)
            }
          } else {
            inflate?.push(chunk.subarray(cursor, end), final)
          }
          // yield 暂停解压，等待调用方完成异步写入；不缓存整个条目。
          yield* pending.splice(0)
        }
      }
      if ((inflate || sink) && entry.compressedSize === 0) {
        if (sink) {
          for (const piece of await sink.push(new Uint8Array(), true)) {
            append(piece)
          }
        } else {
          inflate?.push(new Uint8Array(), true)
        }
        yield* pending.splice(0)
      }
      if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        invalid()
      }
      completed = true
    }
    yield { path: entry.path, size: entry.size, stream: stream() }
    if (!completed) {
      invalid()
    }
    report(start + entry.compressedSize)
  }
  report(directory.offset)
}

/**
 * 读取指定条目、跳过其余：用于从官网导出的整包里取索引或选中的会话。
 * keep 返回 true 时读出该条目内容，否则丢弃（仍会校验数据完整性）。
 */
export async function* readArchiveSelected(
  file: File,
  keep: (path: string) => boolean
): AsyncGenerator<{ path: string; blob: Blob }> {
  for await (const entry of readArchive(file)) {
    if (keep(entry.path)) {
      yield { path: entry.path, blob: await readEntry(entry) }
    } else {
      await skipEntry(entry)
    }
  }
}

/** 读出整个条目：会话 JSON 需要完整解析，图片需要识别类型后整张保存。 */
export const readEntry = async (entry: ArchiveEntry): Promise<Blob> => {
  const parts: Blob[] = []
  for await (const chunk of entry.stream) {
    parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]))
  }
  return new Blob(parts)
}

/** 不需要的条目也要读完，以校验大小与 CRC。 */
export const skipEntry = async (entry: ArchiveEntry): Promise<void> => {
  const reader = entry.stream[Symbol.asyncIterator]()
  while (!(await reader.next()).done) {
    // 丢弃数据。
  }
}
