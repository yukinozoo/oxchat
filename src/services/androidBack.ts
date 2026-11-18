import { useEffect, useRef } from 'react'

type BackButtonEvent = { canGoBack: boolean }
type ListenerHandle = { remove: () => Promise<void> }
type NativeApp = {
  addListener: (
    eventName: 'backButton',
    listener: (event: BackButtonEvent) => void
  ) => Promise<ListenerHandle>
  exitApp: () => Promise<void>
}
type CapacitorWindow = Window & {
  Capacitor?: { Plugins?: { App?: NativeApp } }
}

const getNativeApp = () => (window as CapacitorWindow).Capacitor?.Plugins?.App

/** 后注册的页面或弹层优先接收返回事件，与视觉层级一致。 */
const backHandlers: (() => void)[] = []

/** 在组件显示期间注册一个 Android 返回动作；回调更新时不会改变层级。 */
export const useAndroidBackHandler = (active: boolean, onBack: () => void) => {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!active) {
      return
    }
    const handler = () => onBackRef.current()
    backHandlers.push(handler)
    return () => {
      const index = backHandlers.lastIndexOf(handler)
      if (index >= 0) {
        backHandlers.splice(index, 1)
      }
    }
  }, [active])
}

/** 原生壳只注册一个监听器；网页版没有 Capacitor App 插件时保持原样。 */
export const setupAndroidBack = () => {
  const app = getNativeApp()
  if (!app) {
    return
  }

  let disposed = false
  let listener: ListenerHandle | undefined
  const onBackButton = (event: BackButtonEvent) => {
    const handler = backHandlers.at(-1)
    if (handler) {
      handler()
    } else if (event.canGoBack) {
      window.history.back()
    } else {
      void app.exitApp()
    }
  }

  try {
    // 原生桥异常只影响系统返回键，不能让 React 因 effect 抛错而卸载整页。
    void Promise.resolve(app.addListener('backButton', onBackButton))
      .then((handle) => {
        if (disposed) {
          void handle.remove()
        } else {
          listener = handle
        }
      })
      .catch(() => undefined)
  } catch {
    return
  }

  return () => {
    disposed = true
    if (listener) {
      void listener.remove()
    }
  }
}
