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
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onClose])
}
