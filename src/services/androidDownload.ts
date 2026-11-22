/**
 * 网页版里的「下载 Android 版」入口。
 *
 * 安装包挂在 GitHub Release 上；Pages 构建时会把最新那一个一起放进站点根目录，
 * 所以优先用同源地址（不受第三方代理挂掉的影响），失败再退到 GitHub 直连。
 */
export const ANDROID_APK_URL = './OxChat-latest.apk'

/** 不走代理的原始地址：站点里没有安装包时用它 */
export const ANDROID_APK_DIRECT_URL =
  'https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk'

/** 用 a 标签在新标签打开，避免 window.open 被拦截 */
const openLink = (url: string): void => {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noreferrer noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** 同源地址有没有真的东西：没有就退到直连，省得用户点了下载却拿到 404 页面 */
const resolveApkUrl = async (): Promise<string> => {
  try {
    const response = await fetch(ANDROID_APK_URL, { method: 'HEAD', cache: 'no-store' })
    if (response.ok) {
      return ANDROID_APK_URL
    }
  } catch {
    // 取不到就当作站点里没有安装包
  }
  return ANDROID_APK_DIRECT_URL
}

export const downloadAndroidApk = async (): Promise<void> => {
  openLink(await resolveApkUrl())
}
