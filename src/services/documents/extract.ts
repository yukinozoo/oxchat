import { strFromU8, unzipSync } from 'fflate'

/**
 * 本地把 Office / 电子书抽成纯文本（零新依赖：它们本质都是 ZIP + XML）。
 *
 * 动机：整段上传让服务端做版面解析时，既不能本地截断、也没法告诉用户读了多少，
 * 超大文件还容易直接 400。抽不动（加密、损坏、非标准结构）时返回 null，调用方退回整段上传。
 *
 * 用正则而不是 DOMParser：这段代码在 Node 冒烟里也要能跑，且只做纯文本抽取、不还原排版。
 */
const EXTRACTABLE = new Set(['docx', 'pptx', 'xlsx', 'epub', 'rtf'])

/** 单次抽取的硬上限：再大也只是占内存，后面还要按预算截断 */
const MAX_EXTRACT_CHARS = 2_000_000

export const isExtractableDocument = (name: string): boolean =>
  EXTRACTABLE.has(name.split('.').pop()?.toLowerCase() ?? '')

const decode = (bytes: Uint8Array) => strFromU8(bytes)
const stripTags = (xml: string) =>
  xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")

/** docx：正文在 word/document.xml，段落用换行分隔 */
const readDocx = (files: Record<string, Uint8Array>): string | null => {
  const main = files['word/document.xml']
  return main ? stripTags(decode(main).replace(/<\/w:p>/g, '\n')) : null
}

/** pptx：逐页抽 <a:t>，页与页之间空行 */
const readPptx = (files: Record<string, Uint8Array>): string | null => {
  const slides = Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.replace(/\D+/g, '')) - Number(b.replace(/\D+/g, '')))
  if (slides.length === 0) {
    return null
  }
  return slides.map((path) => stripTags(decode(files[path]).replace(/<\/a:p>/g, '\n'))).join('\n\n')
}

/** xlsx：共享字符串 + 每张表，单元格用制表符、行用换行 */
const readXlsx = (files: Record<string, Uint8Array>): string | null => {
  const sheets = Object.keys(files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
  if (sheets.length === 0) {
    return null
  }
  const shared = files['xl/sharedStrings.xml']
  const sharedStrings = shared
    ? [...decode(shared).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1])
    : []
  return sheets
    .map((path) => {
      const rows = [...decode(files[path]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
      return rows
        .map((row) =>
          [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
            .map(([, attrs, body]) => {
              const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
              const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
              if (type === 's') {
                return sharedStrings[Number(value)] ?? ''
              }
              const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1]
              return inline ?? value
            })
            .join('\t')
        )
        .join('\n')
    })
    .join('\n')
}

/** epub：按文件名顺序读 XHTML，去掉标签 */
const readEpub = (files: Record<string, Uint8Array>): string | null => {
  const pages = Object.keys(files)
    .filter((path) => /\.x?html?$/i.test(path))
    .sort()
  if (pages.length === 0) {
    return null
  }
  return pages.map((path) => stripTags(decode(files[path]))).join('\n\n')
}

/** rtf：去掉控制字与分组符号，保留可读文本 */
const readRtf = (bytes: Uint8Array): string =>
  decode(bytes)
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .trim()

/** 抽取文档纯文本；不支持的格式或抽不动时返回 null */
export const extractDocumentText = async (name: string, blob: Blob): Promise<string | null> => {
  if (!isExtractableDocument(name)) {
    return null
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  try {
    if (ext === 'rtf') {
      const text = readRtf(new Uint8Array(await blob.arrayBuffer()))
      return text ? text.slice(0, MAX_EXTRACT_CHARS) : null
    }
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const text =
      ext === 'docx'
        ? readDocx(files)
        : ext === 'pptx'
          ? readPptx(files)
          : ext === 'xlsx'
            ? readXlsx(files)
            : readEpub(files)
    if (!text || text.trim() === '') {
      return null
    }
    return text.slice(0, MAX_EXTRACT_CHARS)
  } catch {
    return null
  }
}
