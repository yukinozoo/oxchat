import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './ImageLightbox.module.css'

/** 图片放大查看：点遮罩或按 Esc 关闭，覆盖整屏并避开安全区 */
export const ImageLightbox = ({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) =>
  createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <img className={styles.image} src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
    </div>,
    document.body
  )

/** 挂载期间监听 Esc（放在组件里方便复用） */
export const useLightboxEscape = (active: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      // 图片查看器在弹窗之上打开时，一次 Esc 不能把下面的设置弹窗也关掉：
      // 用捕获阶段先吃掉这一次事件（弹窗的监听在冒泡阶段，收不到）。
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [active, onClose])
}
