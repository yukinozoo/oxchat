/**
 * 网页版下载安装包：分片并行 + 进度 + 校验。
 *
 * GitHub Pages 在国内单连接只有几十 KB/s，5 MB 要等两分钟；改成多段 Range 并行后
 * 实测能到 5 倍以上（6 段 / 200 KB/s 左右）。服务端不支持 Range 或任何一段失败时，
 * 调用方退回「浏览器直接下载」。
 */

/** 单个分片的信息，供界面展示 */
export type ApkProgress = {
  /** 已收到的字节 */
  received: number
  /** 总字节；服务端没给 Content-Length 时为 0 */
  total: number
  /** 平均速度（字节/秒） */
  bytesPerSecond: number
  /** 分片数 */
  parts: number
}

export type ApkFile = {
  blob: Blob
  /** 保存时用的文件名，带版本号 */
  fileName: string
}

/** 分片上限：并发太多会被服务端限流，6 段在实测里最稳 */
const MAX_PARTS = 6
/** 小于这个体积没必要并行 */
const PARALLEL_THRESHOLD = 1.5 * 1024 * 1024

const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** 下载一段字节区间；服务端不支持 Range 时抛错，由调用方降级 */
const readPart = async (
  url: string,
  start: number,
  end: number,
  onBytes: (count: number) => void,
  signal?: AbortSignal
): Promise<Uint8Array> => {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  })
  if (response.status !== 206) {
    throw new Error(`range unsupported: ${response.status}`)
  }
  const body = response.body
  if (!body) {
    const buffer = await response.arrayBuffer()
    onBytes(buffer.byteLength)
    return new Uint8Array(buffer)
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      chunks.push(value)
      size += value.byteLength
      onBytes(value.byteLength)
    }
  }
  return concat(chunks, size)
}

/** 取站点里的更新清单：里面有体积、sha256 与版本号，用来校验下载结果 */
const readManifest = async (): Promise<{ sha256?: string; versionName?: string } | null> => {
  try {
    const response = await fetch('./update.json', { cache: 'no-store' })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as { sha256?: string; versionName?: string }
  } catch {
    return null
  }
}

/**
 * 下载安装包：先探体积与 Range 支持，再分片并发拉取，最后按清单校验 sha256。
 * 进度回调是节流的（每 200ms 一次），避免 React 每秒重渲染几十次。
 */
export const fetchApkFile = async (
  url: string,
  onProgress: (progress: ApkProgress) => void,
  signal?: AbortSignal
): Promise<ApkFile> => {
  const head = await fetch(url, { method: 'HEAD', cache: 'no-store', signal })
  if (!head.ok) {
    throw new Error(`head ${head.status}`)
  }
  const total = Number(head.headers.get('content-length') ?? 0) || 0
  const ranges = (head.headers.get('accept-ranges') ?? '').includes('bytes')
  const manifest = await readManifest()

  const useParts = ranges && total > PARALLEL_THRESHOLD
  const parts = useParts ? MAX_PARTS : 1

  const started = Date.now()
  let received = 0
  let lastNotify = 0
  const notify = (force: boolean) => {
    const now = Date.now()
    if (!force && now - lastNotify < 200) {
      return
    }
    lastNotify = now
    const elapsed = Math.max(1, now - started) / 1000
    onProgress({
      received,
      total,
      bytesPerSecond: Math.round(received / elapsed),
      parts,
    })
  }

  let bytes: Uint8Array
  if (useParts) {
    const size = Math.ceil(total / parts)
    const rangesToFetch = Array.from({ length: parts }, (_, index) => {
      const start = index * size
      const end = Math.min(total - 1, start + size - 1)
      return { start, end }
    })
    const results = await Promise.all(
      rangesToFetch.map(({ start, end }) =>
        readPart(
          url,
          start,
          end,
          (count) => {
            received += count
            notify(false)
          },
          signal
        )
      )
    )
    bytes = new Uint8Array(results.reduce((sum, part) => sum + part.byteLength, 0))
    let offset = 0
    for (const part of results) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
  } else {
    const response = await fetch(url, { cache: 'no-store', signal })
    if (!response.ok) {
      throw new Error(`get ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    bytes = new Uint8Array(buffer)
    received = bytes.byteLength
  }
  notify(true)

  if (total && bytes.byteLength !== total) {
    throw new Error(`size mismatch: ${bytes.byteLength} != ${total}`)
  }
  // 切成一段干净的 ArrayBuffer：digest 与 Blob 都不接受 SharedArrayBuffer 视图
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  if (manifest?.sha256) {
    const digest = toHex(await crypto.subtle.digest('SHA-256', buffer))
    if (digest !== manifest.sha256) {
      throw new Error('sha256 mismatch')
    }
  }
  const version = manifest?.versionName ?? ''
  return {
    blob: new Blob([buffer], { type: 'application/vnd.android.package-archive' }),
    fileName: version ? `OxChat-${version}.apk` : 'OxChat.apk',
  }
}

/** 把下载好的安装包交给浏览器保存（走 blob，不再依赖页面跳转） */
export const saveApkFile = (file: ApkFile): void => {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 留足时间给浏览器接管，再回收
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
