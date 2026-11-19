/** 颜色换算：十六进制与 HSV 互转，供取色盘与色值输入共用 */

export type Hsv = { h: number; s: number; v: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const normalizeHex = (value: string): string => {
  const trimmed = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .split('')
      .map((char) => char + char)
      .join('')
      .toLowerCase()}`
  }
  return /^[0-9a-f]{6}$/i.test(trimmed) ? `#${trimmed.toLowerCase()}` : ''
}

export const hexToHsv = (hex: string): Hsv => {
  const value = normalizeHex(hex) || '#000000'
  const r = Number.parseInt(value.slice(1, 3), 16) / 255
  const g = Number.parseInt(value.slice(3, 5), 16) / 255
  const b = Number.parseInt(value.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }
  }
  // 色相保留小数：取色盘拖动和色值往返都不该被整数化拉偏
  h = (h * 60 + 360) % 360
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const index = Math.floor(((h % 360) + 360) % 360 / 60) % 6
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][index]
  return `#${rgb
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** 取色盘坐标：横向为饱和度、纵向为明度 */
export const hsvFromPoint = (h: number, x: number, y: number): Hsv => ({
  h,
  s: clamp01(x),
  v: clamp01(1 - y),
})
