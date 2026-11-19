/**
 * 背景图片压缩：本地选中的图片先缩到合适尺寸再转 data URL，
 * 避免把原图整张写进 localStorage（体积上限约 5MB，且会影响首屏）。
 */

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    image.src = url
  })

const encode = (image: HTMLImageElement, maxSize: number, quality: number): string => {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('canvas unavailable')
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** 压缩到最长边 1440px、JPEG 0.82；仍然过大时再降一档重来 */
export const readBackgroundImage = async (file: File): Promise<string> => {
  const image = await loadImage(file)
  const first = encode(image, 1440, 0.82)
  return first.length > 2_200_000 ? encode(image, 1080, 0.68) : first
}
