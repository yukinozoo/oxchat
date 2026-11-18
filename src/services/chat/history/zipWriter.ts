import { Zip, ZipPassThrough } from 'fflate'

// ZIP32 字段中的哨兵值表示需要 ZIP64；当前格式不支持 ZIP64。
const ZIP64_SIZE = 0xffffffff
const ZIP64_COUNT = 0xffff

export class ArchiveLimitError extends Error {
  constructor() {
    super('History archive requires unsupported ZIP64 fields')
    this.name = 'ArchiveLimitError'
  }
}

const invalid = (): never => {
  throw new Error('Invalid history archive entry')
}

/** 与读取端保持相同路径规则，成品必须能再次导入。 */
const entryName = (name: string) => {
  const normalized = name.normalize('NFC')
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    invalid()
  }
  const bytes = new TextEncoder().encode(normalized)
  if (bytes.length > 0xffff) {
    throw new ArchiveLimitError()
  }
  // 拒绝孤立代理项，避免编码时替换成 U+FFFD 后改变附件的关联路径。
  if (new TextDecoder().decode(bytes) !== normalized) {
    invalid()
  }
  return { name: normalized, byteLength: bytes.length }
}

export type ArchiveEntryInput = { name: string; blob: Blob }

/**
 * 流式生成 ZIP：逐条目消费、边压缩边吐出分片，调用方写完一片才继续生成。
 * 峰值内存只有当前条目与压缩缓冲，数百 MB 的原件也不会整包进内存。
 */
export async function* streamArchive(
  entries: AsyncGenerator<ArchiveEntryInput>
): AsyncGenerator<Uint8Array> {
  let count = 0
  let size = 0
  const names = new Set<string>()
  const pending: Uint8Array[] = []
  let failure: Error | null = null
  let ended = false
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      ended = true
      return
    }
    pending.push(chunk)
    if (final) {
      ended = true
    }
  })
  try {
    for await (const { name, blob } of entries) {
      const normalized = entryName(name)
      if (names.has(normalized.name)) {
        invalid()
      }
      names.add(normalized.name)
      count += 1
      if (count >= ZIP64_COUNT || blob.size >= ZIP64_SIZE) {
        throw new ArchiveLimitError()
      }
      const entry = new ZipPassThrough(normalized.name)
      entry.mtime = new Date(1980, 0, 1)
      zip.add(entry)
      const reader = blob.stream().getReader()
      let written = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          written += value.byteLength
          if (written > blob.size) {
            invalid()
          }
          size += value.byteLength
          if (size >= ZIP64_SIZE) {
            throw new ArchiveLimitError()
          }
          entry.push(value)
          while (pending.length) {
            yield pending.shift() as Uint8Array
          }
        }
        if (written !== blob.size) {
          invalid()
        }
        entry.push(new Uint8Array(), true)
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      while (pending.length) {
        yield pending.shift() as Uint8Array
      }
      if (failure) {
        throw failure
      }
    }
    zip.end()
    // 中央目录在 end() 里同步生成，排空即可
    while (pending.length) {
      yield pending.shift() as Uint8Array
    }
    if (failure) {
      throw failure
    }
    if (!ended) {
      invalid()
    }
  } finally {
    zip.terminate()
  }
}

/** 兜底给网页端：分片拼成 Blob 一次性下载 */
export const chunksToBlob = (chunks: AsyncGenerator<Uint8Array>): Promise<Blob> => {
  const parts: Blob[] = []
  return (async () => {
    for await (const chunk of chunks) {
      parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]))
    }
    return new Blob(parts, { type: 'application/zip' })
  })()
}
