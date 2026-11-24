import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './ImageCrop.module.css'

/**
 * 图片裁剪。
 *
 * 背景图以前只能整张铺上：手机竖图放进横屏桌面会被拉伸，长图则只看到中间一条。
 * 这里给一个固定比例的取景框，拖动 + 缩放决定裁哪一块，输出统一尺寸的 JPEG。
 *
 * 几何换算做成纯函数 `cropSourceRect`，方便冒烟直接验（不依赖 DOM）。
 */
export type CropFrame = { width: number; height: number }

export type CropState = {
  /** 缩放倍率：1 = 图片恰好铺满取景框 */
  zoom: number
  /** 取景框内的拖动偏移（像素，相对居中位置） */
  offsetX: number
  offsetY: number
}

/**
 * 计算「取景框对应原图的哪一块」。
 * 返回值是原图坐标系的矩形，供 canvas.drawImage 使用；越界自动夹到图内。
 */
export const cropSourceRect = (
  image: CropFrame,
  frame: CropFrame,
  state: CropState
): { sx: number; sy: number; sw: number; sh: number } => {
  const zoom = Math.max(1, state.zoom)
  // 铺满取景框所需的基础缩放（cover：取两边比例里较大的那个）
  const base = Math.max(frame.width / image.width, frame.height / image.height)
  const scale = base * zoom
  const sw = Math.min(image.width, frame.width / scale)
  const sh = Math.min(image.height, frame.height / scale)
  const centerX = image.width / 2 - state.offsetX / scale
  const centerY = image.height / 2 - state.offsetY / scale
  const sx = Math.min(Math.max(0, centerX - sw / 2), image.width - sw)
  const sy = Math.min(Math.max(0, centerY - sh / 2), image.height - sh)
  return { sx, sy, sw, sh }
}

const MAX_OUTPUT = 1600

/** 把选中的区域画到 canvas 并导出 data URL（JPEG，体积可控） */
const renderCrop = (
  image: HTMLImageElement,
  frame: CropFrame,
  state: CropState,
  outputWidth = MAX_OUTPUT
): string => {
  const { sx, sy, sw, sh } = cropSourceRect(
    { width: image.naturalWidth, height: image.naturalHeight },
    frame,
    state
  )
  const outputHeight = Math.max(1, Math.round((outputWidth * frame.height) / frame.width))
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('canvas unavailable')
  }
  context.drawImage(image, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** 取景框比例：背景图按 16:10，头像按 1:1 */
export const FRAME_RATIO = { wide: 16 / 10, square: 1 } as const

export const ImageCropDialog = ({
  src,
  ratio = 'wide',
  onCancel,
  onConfirm,
}: {
  src: string
  ratio?: keyof typeof FRAME_RATIO
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}) => {
  const t = useTranslate()
  const [state, setState] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 })
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    const element = new Image()
    element.onload = () => setImage(element)
    element.onerror = () => setError(true)
    element.src = src
    return () => {
      element.onload = null
      element.onerror = null
    }
  }, [src])

  const frame = frameRef.current
  const frameSize: CropFrame = frame
    ? { width: frame.clientWidth, height: frame.clientHeight }
    : { width: 320, height: Math.round(320 / FRAME_RATIO[ratio]) }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      setState((current) => ({
        ...current,
        offsetX: drag.offsetX + (event.clientX - drag.x),
        offsetY: drag.offsetY + (event.clientY - drag.y),
      }))
    },
    []
  )
  const onPointerUp = () => {
    dragRef.current = null
  }

  const confirm = () => {
    if (!image) {
      return
    }
    try {
      onConfirm(renderCrop(image, frameSize, state))
    } catch {
      setError(true)
    }
  }

  return (
    <Modal
      title={t('cropTitle')}
      closable
      // 从整屏设置页（z-index 1100）里弹出：不抬层级会被盖住，表现成「点了没反应」
      overlayClassName={styles.overlay}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button size="m" disabled={!image} onClick={confirm}>
            {t('cropApply')}
          </Button>
        </>
      }
    >
      <div className={styles.stage}>
        <div
          ref={frameRef}
          className={styles.frame}
          style={{ aspectRatio: String(FRAME_RATIO[ratio]) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {image ? (
            <img
              className={styles.preview}
              src={src}
              alt=""
              draggable={false}
              style={{
                transform: `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.zoom})`,
              }}
            />
          ) : null}
          <span className={styles.grid} aria-hidden="true" />
        </div>
      </div>
      {error ? <p className={styles.error}>{t('cropFailed')}</p> : null}
      <div className={styles.row}>
        <span className={styles.label}>{t('cropZoom')}</span>
        <input
          type="range"
          className={styles.range}
          min={1}
          max={3}
          step={0.05}
          value={state.zoom}
          aria-label={t('cropZoom')}
          onChange={(event) =>
            setState((current) => ({ ...current, zoom: Number(event.target.value) }))
          }
        />
      </div>
      <p className={styles.hint}>{t('cropHint')}</p>
    </Modal>
  )
}
