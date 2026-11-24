import { translate } from '../../i18n/index.js'
import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import type { Message, Session } from './types.js'

/**
 * 导出「当前对话」为可读文本。
 *
 * 导出的是**当前分支**（和界面上看到的一致），可开关思考过程、时间与模型、附件占位行。
 * 只产出文本，不碰图片原件：需要原件时用 ZIP 备份那条路。
 */
export type ExportTxtOptions = {
  /** 是否包含思考过程（默认不含：多数时候是噪音） */
  includeThinking: boolean
  /** 是否在每条前面加时间与模型（默认含） */
  includeMeta: boolean
  /** 附件是否列成占位行（默认含） */
  includeFiles: boolean
  /** 用户显示名；留空使用「我」 */
  userName?: string
}

export const DEFAULT_TXT_OPTIONS: ExportTxtOptions = {
  includeThinking: false,
  includeMeta: true,
  includeFiles: true,
}

const pad = (value: number) => String(value).padStart(2, '0')

export const formatStamp = (time: number): string => {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

const fileList = (message: Message): string => {
  if (message.role !== 'user' || message.files.length === 0) {
    return ''
  }
  return message.files
    .map((file) => `[${file.isImage ? '图片' : '文件'} ${file.name}]`)
    .join(' ')
}

const assistantBody = (message: Message, options: ExportTxtOptions): string => {
  if (message.role !== 'assistant') {
    return ''
  }
  const parts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'thinking' && options.includeThinking) {
      parts.push(`${translate('exportTxtThinking')}\n${block.thinking}`)
    }
  }
  return parts.join('\n\n').trim()
}

/** 单条会话 → 文本；空会话返回空串（调用方负责跳过） */
export const sessionToTxt = (session: Session, options: ExportTxtOptions): string => {
  const userName = options.userName?.trim() || translate('exportTxtMe')
  const lines: string[] = [`# ${session.title || translate('untitledChat')}`, '']
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      const head = options.includeMeta ? `[${formatStamp(message.createdAt)}] ` : ''
      const body = [message.content.trim(), options.includeFiles ? fileList(message) : '']
        .filter(Boolean)
        .join('\n')
      if (!body) {
        continue
      }
      lines.push(`${head}${userName}：${body}`, '')
      continue
    }
    const body = assistantBody(message, options)
    if (!body) {
      continue
    }
    if (options.includeMeta) {
      const model = message.model ? ` · ${message.model}` : ''
      lines.push(`[${formatStamp(message.createdAt)}${model}] ${translate('exportTxtAi')}：`, body, '')
    } else {
      lines.push(`${translate('exportTxtAi')}：`, body, '')
    }
  }
  return lines.join('\n').trim() + '\n'
}

/** 文件名：标题里的非法字符换成下划线，避免各平台拒绝保存 */
export const txtFileName = (title: string, now: Date = new Date()): string => {
  const clean = (title.trim() || translate('untitledChat'))
    .replace(/[\\/:*?"<>|\n\r\t]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${clean || 'oxchat'}-${date}.txt`
}

/** 批量导出：多条会话之间加分隔线，一次保存成一个文件 */
export const sessionsToTxt = (sessions: readonly Session[], options: ExportTxtOptions): string =>
  sessions
    .map((session) => sessionToTxt(session, options))
    .filter((text) => text.length > 0)
    .join('\n---\n\n')

type NativeFs = {
  writeFile: (options: Record<string, unknown>) => Promise<unknown>
  getUri: (options: Record<string, unknown>) => Promise<{ uri: string }>
}
type NativeShare = { share: (options: Record<string, unknown>) => Promise<unknown> }

const nativePlugins = (): { filesystem?: NativeFs; share?: NativeShare } | null => {
  const capacitor = (window as unknown as { Capacitor?: { Plugins?: unknown } }).Capacitor
  return capacitor?.Plugins ? (capacitor.Plugins as { filesystem?: NativeFs; share?: NativeShare }) : null
}

/**
 * 保存文本：原生壳写缓存再交给系统「保存/分享」，网页版直接触发下载。
 * 失败抛错，由调用方决定提示文案。
 */
export const saveTxt = async (fileName: string, text: string, shareTitle = ''): Promise<void> => {
  const native = nativePlugins()
  if (native?.filesystem && native.share) {
    await native.filesystem.writeFile({
      path: fileName,
      data: text,
      directory: 'CACHE',
      recursive: true,
      encoding: 'utf8',
    })
    const { uri } = await native.filesystem.getUri({ path: fileName, directory: 'CACHE' })
    await native.share.share({ title: fileName, url: uri, dialogTitle: shareTitle })
    return
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 按 id 批量读取会话（未打开的会话从库里读），跳过不存在的 */
export const loadSessionsForTxt = async (ids: readonly string[]): Promise<Session[]> => {
  const sessions: Session[] = []
  for (const id of ids) {
    const session = await db.loadSession(id).catch(() => undefined)
    if (session) {
      sessions.push(session)
    }
  }
  return sessions
}
