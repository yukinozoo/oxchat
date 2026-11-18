/** 二进制转 base64：分段编码，避免超长字符串（安卓 WebView 字符串约 512MB 上限） */
export const toBase64 = (bytes: Uint8Array): string => {
  const sliceBytes = 0x8000
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += sliceBytes) {
    parts.push(
      String.fromCharCode.apply(
        null,
        bytes.subarray(offset, Math.min(offset + sliceBytes, bytes.length)) as unknown as number[]
      )
    )
  }
  return btoa(parts.join(''))
}

/** base64 转字节：分段解码，避免大文件一次性生成超长字符串 */
export const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
