/**
 * 头像图片处理：读文件 → 居中裁成正方形 → 缩到 160px → data URL。
 *
 * 头像要存进 localStorage（用户名字那头），所以不能直接存原图；
 * 160px 在手机上显示（顶栏 20px、列表 36px、弹窗 72px）足够清晰，体积约 10–20KB。
 */
const AVATAR_SIZE = 160

export const makeAvatarDataUrl = async (file: File): Promise<string> => {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    const sx = (image.naturalWidth - side) / 2
    const sy = (image.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('canvas unavailable')
    }
    context.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = src
  })
