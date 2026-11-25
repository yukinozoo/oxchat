import { channelById } from './channels.js'
import { useSettings } from './settings.js'

/**
 * 请求实际能用的 Key。
 *
 * 以前各处都只看 `settings.apiKey`（官方 Key），于是「只用自定义渠道」的用户
 * 点压缩 / 生成笔记 / 接续向导都会被告知「输入 API Key 开始使用」——
 * 但 `streamMessage` 早就按当前渠道分流、用的是渠道自己的 Key（见 api/client.ts）。
 *
 * 规则：官方 Key 优先；没有就拿当前渠道的 Key；`deepseek` 渠道没 Key 就返回空串。
 */
export const effectiveApiKey = (): string => {
  const official = (useSettings.getState().apiKey ?? '').trim()
  if (official) {
    return official
  }
  const channel = channelById(useSettings.getState().activeChannel)
  return channel.id === 'deepseek' ? '' : channel.apiKey.trim()
}

/** 能不能发请求（官方 Key 或当前渠道 Key 有一个就行） */
export const hasRequestKey = (): boolean => effectiveApiKey() !== ''
