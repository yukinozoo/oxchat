/**
 * 附件存储位置偏好（`native` = App 私有目录，`idb` = WebView 的 IndexedDB）。
 *
 * 单独成模块是为了打破循环依赖：`settings.ts` 依赖 `db.ts`（背景图等大设置项），
 * 而 `db.ts` 又需要知道这个偏好。这里直接读 localStorage，不引入任何上层模块。
 */
const KEY = 'oxchat:file-store'

export const fileStorePreference = (): 'native' | 'idb' => {
  try {
    return localStorage.getItem(KEY) === 'idb' ? 'idb' : 'native'
  } catch {
    // 存储不可用时按默认值走（原生优先）
    return 'native'
  }
}
