/** 是否运行在 Capacitor 原生壳里（App）而不是浏览器 */
export const isNativePlatform = (): boolean =>
  Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.()
  )
