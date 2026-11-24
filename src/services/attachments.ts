import { create } from 'zustand'
import type { LinkedMessage, TranslationMessage } from '../i18n/index.js'
import { uploadFile } from './api/client.js'
import { classifyApiError, getUploadErrorInfo, isRetryableApiError } from './api/errors.js'
import type { FilePurpose } from './api/types.js'
import { ACCEPT_FILE_EXTS } from './uploadExts.js'
import { extractDocumentText, isExtractableDocument } from './documents/extract.js'
import { documentBudgetFor, truncateToBudget } from './documents/budget.js'
import { useSettings } from './settings.js'
import { modelCaps } from './modelCaps.js'
import { saveFileExcerpt } from './chat/fileText.js'

/** 允许上传的扩展名，按扩展名白名单过滤，清单见 uploadExts.ts */
export const ACCEPTED_EXTS = ACCEPT_FILE_EXTS
/** 选择文件对话框的过滤条件 */
export const ACCEPT = ACCEPTED_EXTS.map((ext) => `.${ext}`).join(',')
/** 单文件大小上限与 Files API 一致 */
export const MAX_SIZE_MB = 64
/** 按 user_data 上传的文件（纯文本、代码、表格、电子书）原文件上限更小 */
export const MAX_USER_DATA_SIZE_MB = 32
export const MAX_COUNT = 50
/** 同时上传的文件数 */
const MAX_CONCURRENT = 3

/** 文件扩展名（小写，不含点）；没有扩展名时为空 */
export const getFileExt = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isAcceptedExt = (name: string) => ACCEPTED_EXTS.includes(getFileExt(name))

/** 需要服务端做版面解析的文档；其余非图片文件（纯文本、代码、表格、电子书）无需解析 */
const LAYOUT_RECOGNITION_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])

/** 上传时的 purpose：图片不传，PDF 与 Word、PPT 做版面解析，其余按 user_data 上传 */
export const getUploadPurpose = (name: string, isImage: boolean): FilePurpose | null => {
  if (isImage) {
    return null
  }
  return LAYOUT_RECOGNITION_EXTS.has(getFileExt(name)) ? 'rich_layout_recognition' : 'user_data'
}

/** 文件允许的最大体积（MB），按上传时的 purpose 区分 */
const getMaxSizeMB = (file: File) =>
  getUploadPurpose(file.name, isImage(resolveMimeType(file))) === 'user_data'
    ? MAX_USER_DATA_SIZE_MB
    : MAX_SIZE_MB

/** 添加前校验：格式 → 大小 → 数量，任一不满足即整批不添加 */
export const validateFiles = (files: File[], currentCount: number): TranslationMessage | null => {
  if (files.some((file) => !isAcceptedExt(file.name))) {
    return { key: 'uploadUnsupportedFormat' }
  }
  const oversized = files.find((file) => file.size > getMaxSizeMB(file) * 1024 * 1024)
  if (oversized) {
    return { key: 'uploadMaxMBSize', params: { size: getMaxSizeMB(oversized) } }
  }
  if (currentCount + files.length > MAX_COUNT) {
    return { key: 'uploadMaxFiles', params: { count: MAX_COUNT } }
  }
  return null
}

/**
 * 上传失败在附件上显示的文案：与设计稿状态对应的用具体原因，其余统一「上传失败」。
 * 服务端原文多为英文且较长，不直接展示。
 */
export const describeUploadError = (error: unknown): TranslationMessage => {
  const info = getUploadErrorInfo(error)
  // 图片解码失败/格式不支持：不是网络问题，重试也不会成功
  if (error instanceof Error && error.message === 'unsupported image') {
    return { key: 'uploadUnsupportedImage' }
  }
  if (classifyApiError(error) === 'serverBusy') {
    return { key: 'uploadServerBusy' }
  }
  // 配额类 400 以前会落进最后的「上传失败」，用户看不出该删文件还是等配额
  if (info?.code === 'fileCountLimit') {
    return { key: 'uploadFileCountLimitHint', params: { limit: info.limit ?? '' } }
  }
  if (info?.code === 'storageLimit') {
    return { key: 'uploadStorageLimitHint', params: { limit: info.limit ?? '' } }
  }
  if (info?.code === 'parseFailed') {
    return { key: 'uploadParseFailed' }
  }
  return { key: 'uploadFileStatusFailed' }
}

/**
 * 不可重试的上传错误：配额（文件数/存储空间）、格式/解析拒绝、鉴权与参数错误这一类，
 * 再试一次也不会变好。供历史附件补传做「一次性跳过」，避免每次发送都重传同一批必然失败的文件。
 */
export const isNonRetryableUploadError = (error: unknown): boolean => {
  if (getUploadErrorInfo(error) !== null) {
    return true
  }
  return !isRetryableApiError(error)
}

/** 上传选项：`silent` 用于历史/导入附件的补传，失败不写全局任务态、不弹配额提示 */
export type UploadOptions = {
  silent?: boolean
}

type NoticeListener = (notice: LinkedMessage) => void
const noticeListeners = new Set<NoticeListener>()

/** 订阅需要额外提示的上传失败（配额达到上限），由界面层转成 toast */
export const onUploadNotice = (listener: NoticeListener) => {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** 删除已上传文件的接口文档 */
const DELETE_FILE_DOCS_URL = 'https://api-docs.deepseek.com/api/delete-file'

/** 文件数或存储空间达到上限：附件上只放得下「上传失败」，原因另用 toast 说明并引导删除旧文件 */
export const describeUploadQuota = (error: unknown): LinkedMessage | undefined => {
  const info = getUploadErrorInfo(error)
  const link = { key: 'uploadDeleteFiles', href: DELETE_FILE_DOCS_URL } as const
  if (info?.code === 'fileCountLimit') {
    return { type: 'error', key: 'uploadFileCountLimit', params: { limit: info.limit ?? '' }, link }
  }
  if (info?.code === 'storageLimit') {
    return { type: 'error', key: 'uploadStorageLimit', params: { limit: info.limit ?? '' }, link }
  }
  return undefined
}

type Job = () => Promise<void>
const queue: Job[] = []
let running = 0

const next = () => {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift()
    if (!job) {
      return
    }
    running++
    void job().finally(() => {
      running--
      next()
    })
  }
}

/** 排队上传，最多同时上传 MAX_CONCURRENT 个；排队期间中止的任务不会发出请求 */
/** 服务端只接受 JPEG/PNG，且宽高各不超过 4096：不合规的图片先转码/缩放 */
const MAX_IMAGE_EDGE = 4096
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

/**
 * 归一化图片：格式不支持就转码（HEIC、webp、扩展名与内容不符等），
 * 尺寸超限就等比缩小。解码失败说明文件本身有问题，返回 null 表示跳过这张图。
 */
export const prepareImage = async (
  blob: Blob,
  name: string
): Promise<{ blob: Blob; name: string } | null> => {
  if (!blob.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return null
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    // 浏览器都解不开（典型是损坏文件或浏览器不支持的 HEIC）
    return null
  }
  try {
    const oversized = Math.max(bitmap.width, bitmap.height) > MAX_IMAGE_EDGE
    const needsTranscode = !SUPPORTED_IMAGE_TYPES.has(blob.type)
    if (!oversized && !needsTranscode) {
      return { blob, name }
    }
    const scale = oversized ? MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height) : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
    if (!encoded) {
      return null
    }
    const ext = type === 'image/png' ? '.png' : '.jpg'
    return { blob: encoded, name: `${name.replace(/\.[^.]+$/, '')}${ext}` }
  } finally {
    bitmap.close?.()
  }
}

const enqueueUpload = (
  apiKey: string,
  file: Blob,
  name: string,
  isImage: boolean,
  signal: AbortSignal
) =>
  new Promise<string>((resolve, reject) => {
    queue.push(async () => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      try {
        // 历史导入的图片可能格式不支持或尺寸超限：上传前统一归一化
        const prepared = isImage ? await prepareImage(file, name) : { blob: file, name }
        if (!prepared) {
          throw new Error('unsupported image')
        }
        let body =
          prepared.blob instanceof File
            ? prepared.blob
            : new File([prepared.blob], prepared.name, { type: prepared.blob.type })
        // 文档类先本地抽文本：能截断、能告知比例，超大文件也不会把服务端解析撑爆
        let purpose = getUploadPurpose(prepared.name, isImage)
        /** 给压缩摘要留的正文片段（原文本地留一段，压缩时拼进转录） */
        let excerpt: string | null = null
        if (!isImage && isExtractableDocument(prepared.name)) {
          const text = await extractDocumentText(prepared.name, body)
          if (text) {
            excerpt = text
            const budget = documentBudgetFor(
              useSettings.getState().contextWindow,
              modelCaps(useSettings.getState().model).inputLimit
            )
            const { text: kept, ratio } = truncateToBudget(text, budget)
            if (ratio < 1) {
              const notice: LinkedMessage = {
                key: 'documentTruncated',
                params: { percent: Math.max(1, Math.round(ratio * 100)) },
              }
              for (const listener of noticeListeners) {
                listener(notice)
              }
            }
            const txtName = `${prepared.name.replace(/\.[^.]+$/, '')}.txt`
            body = new File([kept], txtName, { type: 'text/plain' })
            purpose = 'user_data'
          }
        }
        const uploaded = await uploadFile(apiKey, body, purpose, signal)
        if (excerpt) {
          void saveFileExcerpt(uploaded.id, excerpt)
        }
        resolve(uploaded.id)
      } catch (error) {
        reject(error)
      }
    })
    next()
  })

/**
 * 上传任务按附件的本地 id 登记：输入框选中即开始上传，全部成功后携带 serverId 发送，
 * 不会重复上传；导入的历史附件没有任务，发送前按本地原件补传。
 * 任务只在内存里，历史附件补传未完成时，刷新后会在下次请求前重新上传。
 */
export type UploadTask =
  | { status: 'uploading' }
  | { status: 'done'; serverId: string }
  | { status: 'error'; error: TranslationMessage; retryable: boolean }

type UploadState = { tasks: Record<string, UploadTask> }

export const useUploads = create<UploadState>(() => ({ tasks: {} }))

const setTask = (id: string, task: UploadTask | null) =>
  useUploads.setState((state) => ({
    tasks: task
      ? { ...state.tasks, [id]: task }
      : Object.fromEntries(Object.entries(state.tasks).filter(([key]) => key !== id)),
  }))

const pending = new Map<string, { promise: Promise<string>; controller: AbortController }>()

/** 开始（或复用进行中的）上传，返回服务端 file_id；失败时任务记为 error 并抛出原错误 */
export const uploadAttachment = (
  apiKey: string,
  id: string,
  blob: Blob,
  name: string,
  isImage: boolean,
  options: UploadOptions = {}
): Promise<string> => {
  const silent = options.silent === true
  const current = pending.get(id)
  if (current) {
    return current.promise
  }
  const controller = new AbortController()
  setTask(id, { status: 'uploading' })
  const promise = enqueueUpload(apiKey, blob, name, isImage, controller.signal)
    .then((serverId) => {
      setTask(id, { status: 'done', serverId })
      return serverId
    })
    .catch((error: unknown) => {
      // 静默补传（历史/导入附件）失败只清掉「上传中」，不把旧消息标成「上传失败」、也不弹配额提示
      if (controller.signal.aborted || silent) {
        setTask(id, null)
      } else {
        setTask(id, {
          status: 'error',
          error: describeUploadError(error),
          retryable: isRetryableApiError(error),
        })
        const notice = describeUploadQuota(error)
        if (notice) {
          for (const listener of noticeListeners) {
            listener(notice)
          }
        }
      }
      throw error
    })
    .finally(() => pending.delete(id))
  pending.set(id, { promise, controller })
  return promise
}

export const cancelUpload = (id: string) => {
  pending.get(id)?.controller.abort()
  setTask(id, null)
}

/** 各扩展名对应的 MIME：部分系统（如 Windows）给不出 file.type，按扩展名补齐 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 取文件的 MIME：优先用浏览器给出的类型，缺失时按扩展名推断 */
export const resolveMimeType = (file: File) => file.type || MIME_BY_EXT[getFileExt(file.name)] || ''

export const isImage = (mimeType: string) => mimeType.startsWith('image/')

/** 文件扩展名（大写），用于卡片元信息 */
export const getExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
