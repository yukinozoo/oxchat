/**
 * 网页版里的「下载 Android 版」入口。
 *
 * 安装包挂在 GitHub Release 上，国内直连 GitHub 不稳定，
 * 所以默认走 gh-proxy 转发；直连地址留作备注与排查用。
 */
export const ANDROID_APK_URL =
  'https://gh-proxy.com/https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk'

/** 不走代理的原始地址：代理失效时可以改成这个试 */
export const ANDROID_APK_DIRECT_URL =
  'https://github.com/yukinozoo/oxchat/releases/latest/download/OxChat-latest.apk'

/** 新标签打开下载地址：用 a 标签点击，避免 window.open 被拦截 */
export const downloadAndroidApk = (): void => {
  const link = document.createElement('a')
  link.href = ANDROID_APK_URL
  link.target = '_blank'
  link.rel = 'noreferrer noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
