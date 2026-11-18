import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAndroidBackHandler } from '../../services/androidBack.js'
import { IconCameraOutline20, IconFileOutline20, IconPhotosOutline20 } from '../base/icons.js'
import styles from './AttachSheet.module.css'

/** 移动端上传附件面板：拍照 / 相册 / 文件。点遮罩或返回键关闭 */
export const AttachSheet = ({
  open,
  onCamera,
  onGallery,
  onFiles,
  onClose,
}: {
  open: boolean
  onCamera: () => void
  onGallery: () => void
  onFiles: () => void
  onClose: () => void
}) => {
  const t = useTranslate()
  const sheetRef = useRef<HTMLDivElement>(null)
  useAndroidBackHandler(open, onClose)

  // 把面板实际高度写进 CSS 变量，页面据此把底部输入区顶上去
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const root = document.documentElement
    const apply = () => {
      const h = sheetRef.current?.offsetHeight ?? 0
      root.style.setProperty('--attach-sheet-height', `${h}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    if (sheetRef.current) {
      observer.observe(sheetRef.current)
    }
    return () => {
      observer.disconnect()
      root.style.removeProperty('--attach-sheet-height')
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const pick = (action: () => void) => () => {
    onClose()
    // 等面板收起再触发选择器，否则部分机型会把弹层一起截进去/抢焦点
    requestAnimationFrame(action)
  }

  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('uploadFile')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.tiles}>
          <button type="button" className={styles.tile} onClick={pick(onCamera)}>
            <IconCameraOutline20 />
            <span className={styles.label}>{t('attachSheetCamera')}</span>
          </button>
          <button type="button" className={styles.tile} onClick={pick(onGallery)}>
            <IconPhotosOutline20 />
            <span className={styles.label}>{t('attachSheetGallery')}</span>
          </button>
          <button type="button" className={styles.tile} onClick={pick(onFiles)}>
            <IconFileOutline20 />
            <span className={styles.label}>{t('attachSheetFile')}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
