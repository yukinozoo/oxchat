import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { usableCustomChannel } from '../../services/channels.js'

/** 设置页：主页面（general）与各子页 */
export type SettingsSection =
  | 'general'
  | 'api'
  | 'data'
  | 'theme'
  | 'locale'
  | 'voice'
  | 'personalize'
  | 'chat'
  | 'fontSize'
  | 'cost'
  | 'backup'
  | 'backupGuide'
  | 'tutorials'
  | 'changelog'
  | 'roles'
  | 'roleGuide'
  | 'memoryManage'
  | 'memoryGuide'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  /** true：从聊天页跳进来的临时页，左上角返回＝直接关设置回对话，而不是退到设置首页 */
  closeOnBack: false,
}))

export const openSettings = (section: SettingsSection, options: { closeOnBack?: boolean } = {}) =>
  useSettingsDialog.setState({ open: true, section, closeOnBack: Boolean(options.closeOnBack) })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置的「API 管理」子页，返回是否已有 Key */
export const ensureApiKey = () => {
  // 只用自定义渠道时也算「能开聊」，别再把用户拦到模型管理去
  if (useSettings.getState().apiKey || usableCustomChannel()) {
    return true
  }
  // 从对话页被拦下来（发消息没 Key）：返回要回对话，不要停在设置首页
  openSettings('api', { closeOnBack: true })
  return false
}
