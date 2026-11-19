#!/usr/bin/env node
/**
 * 精简 DeepSeek 导出包：默认丢掉全部会话图片条目，并清理会话 JSON 里失效的图片引用
 * （路径不在本会话目录、同一路径指向不同文件），在原提问正文后补一行「[附件不可用：文件名]」。
 *
 * 用法：
 *   node scripts/shrink-export.mjs <输入.zip> [输出.zip]
 *   node scripts/shrink-export.mjs <输入.zip> --keep-images   # 只清理 JSON，不动图片
 *
 * 结果是流式读写：输入多大都不会整包进内存，几百兆的包通常能压到二三十兆。
 */
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { once } from 'node:events'
import path from 'node:path'
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const keepImages = args.includes('--keep-images')
const output =
  args.filter((arg) => !arg.startsWith('--'))[1] ??
  (input ? input.replace(/\.zip$/i, keepImages ? '-clean.zip' : '-light.zip') : '')

if (!input || !output) {
  console.error('用法: node scripts/shrink-export.mjs <输入.zip> [输出.zip] [--keep-images]')
  process.exit(1)
}

const IMAGE_ENTRY = /^chat_sessions\/([^/]+)_files\//
const SESSION_ENTRY = /^chat_sessions\/([^/]+)\.json$/

/** 与运行期一致：丢弃坏附件节点，补占位文本，图片引用置空 */
const cleanSessionJson = (text, sessionId) => {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { text, dropped: 0, failed: true }
  }
  const prefix = `chat_sessions/${sessionId}_files/`
  let dropped = 0
  const messages = Array.isArray(value?.messages) ? value.messages : []
  for (const message of messages) {
    const fragments = Array.isArray(message?.fragments) ? message.fragments : []
    const placeholders = []
    for (const fragment of fragments) {
      if (fragment?.type !== 'FILE' || !Array.isArray(fragment.files)) {
        continue
      }
      const seen = new Map()
      fragment.files = fragment.files.filter((entry) => {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) {
          dropped += 1
          return false
        }
        const name = typeof entry.file_name === 'string' && entry.file_name ? entry.file_name : '附件'
        if (entry.export_path == null) {
          return true
        }
        const entryPath = String(entry.export_path).normalize('NFC')
        if (!entryPath.startsWith(prefix)) {
          dropped += 1
          placeholders.push(name)
          return false
        }
        const previous = seen.get(entryPath)
        if (previous !== undefined && previous !== entry.id) {
          dropped += 1
          placeholders.push(name)
          return false
        }
        seen.set(entryPath, entry.id)
        // 图片条目已经被这个脚本删掉，引用一并置空，导入时不再去找
        entry.export_path = null
        return true
      })
    }
    if (placeholders.length === 0) {
      continue
    }
    const text = placeholders.map((name) => `[附件不可用：${name}]`).join('')
    const request = fragments.find((fragment) => fragment?.type === 'REQUEST')
    if (request && typeof request.content === 'string') {
      request.content += `\n\n${text}`
    } else {
      fragments.push({ type: 'TIP', content: text, style: 'INFO' })
    }
  }
  return { text: JSON.stringify(value), dropped, failed: false }
}

const size = statSync(input).size
let droppedEntries = 0
let droppedBytes = 0
let cleanedSessions = 0
let cleanedNodes = 0
let keptEntries = 0
let written = 0

const out = createWriteStream(output)
let blocked = false
const zip = new Zip((error, chunk, final) => {
  if (error) {
    throw error
  }
  written += chunk.length
  if (!out.write(Buffer.from(chunk))) {
    blocked = true
  }
  if (final) {
    out.end()
  }
})

const addEntry = (name, data) => {
  const compressible = /\.json$/i.test(name)
  const file = compressible ? new ZipDeflate(name, { level: 9 }) : new ZipPassThrough(name)
  zip.add(file)
  file.push(data, true)
  keptEntries += 1
}

const unzip = new Unzip()
unzip.register(UnzipInflate)
unzip.onfile = (file) => {
  const name = file.name
  const isImage = IMAGE_ENTRY.test(name)
  if (isImage && !keepImages) {
    // 丢掉字节，但仍要把条目读完才能继续解析后面的条目
    droppedEntries += 1
    file.ondata = (error, chunk) => {
      if (error) {
        throw error
      }
      droppedBytes += chunk.length
    }
    file.start()
    return
  }
  const chunks = []
  file.ondata = (error, chunk, final) => {
    if (error) {
      throw error
    }
    chunks.push(chunk)
    if (!final) {
      return
    }
    const data = Buffer.concat(chunks)
    const match = SESSION_ENTRY.exec(name)
    if (match && !keepImages) {
      const result = cleanSessionJson(data.toString('utf8'), match[1])
      if (result.failed) {
        addEntry(name, data)
        return
      }
      cleanedSessions += 1
      cleanedNodes += result.dropped
      addEntry(name, strToU8(result.text))
      return
    }
    addEntry(name, data)
  }
  file.start()
}

for await (const chunk of createReadStream(input)) {
  unzip.push(new Uint8Array(chunk), false)
  if (blocked) {
    blocked = false
    await once(out, 'drain')
  }
}
unzip.push(new Uint8Array(0), true)
zip.end()
await once(out, 'finish')

const kb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
console.log(`输入: ${path.basename(input)}（${kb(size)}）`)
console.log(`输出: ${path.basename(output)}（${kb(written)}，${((written / size) * 100).toFixed(1)}%）`)
console.log(
  `保留条目 ${keptEntries}；${keepImages ? '保留图片' : `丢弃图片条目 ${droppedEntries}（${kb(droppedBytes)}）`}`
)
if (!keepImages) {
  console.log(`清理会话 ${cleanedSessions} 条，失效附件节点 ${cleanedNodes} 个`)
}
