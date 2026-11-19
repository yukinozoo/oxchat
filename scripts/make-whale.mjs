#!/usr/bin/env node
/**
 * 从应用图标里抠出鲸鱼剪影，生成「白色 + alpha」的遮罩图：
 * 前端用 CSS mask 把它染成品牌色，于是白鲸变蓝、原来的蓝底变透明。
 *
 * 用法：node scripts/make-whale.mjs [输入.png] [输出.png]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const input = process.argv[2] ?? 'src/assets/icon-512.png'
const output = process.argv[3] ?? 'src/assets/whale-alpha.png'

const png = readFileSync(input)
let offset = 8
let width = 0
let height = 0
let colorType = 0
const idat = []
while (offset < png.length) {
  const length = png.readUInt32BE(offset)
  const type = png.toString('ascii', offset + 4, offset + 8)
  const data = png.subarray(offset + 8, offset + 8 + length)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    colorType = data[9]
    if (data[8] !== 8 || (colorType !== 6 && colorType !== 2) || data[12] !== 0) {
      throw new Error('只支持 8 位 RGB/RGBA 非隔行 PNG')
    }
  } else if (type === 'IDAT') {
    idat.push(data)
  } else if (type === 'IEND') {
    break
  }
  offset += 12 + length
}

const raw = inflateSync(Buffer.concat(idat))
const bpp = colorType === 6 ? 4 : 3
const stride = width * bpp
const pixels = Buffer.alloc(stride * height)

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

for (let y = 0; y < height; y += 1) {
  const filter = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
  for (let x = 0; x < stride; x += 1) {
    const left = x >= bpp ? pixels[y * stride + x - bpp] : 0
    const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
    const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0
    let value = line[x]
    if (filter === 1) value += left
    else if (filter === 2) value += up
    else if (filter === 3) value += (left + up) >> 1
    else if (filter === 4) value += paeth(left, up, upLeft)
    pixels[y * stride + x] = value & 0xff
  }
}

// 白色鲸鱼（亮度高）与蓝色底（亮度低）之间取 alpha，边缘自然抗锯齿
const BG_LUMA = 118
const WHALE_LUMA = 255
const out = Buffer.alloc(width * height * 4)
let covered = 0
for (let i = 0; i < width * height; i += 1) {
  const r = pixels[i * bpp]
  const g = pixels[i * bpp + 1]
  const b = pixels[i * bpp + 2]
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const raw = Math.max(0, Math.min(1, (luma - BG_LUMA) / (WHALE_LUMA - BG_LUMA)))
  const alpha = raw < 0.08 ? 0 : raw
  out[i * 4] = 255
  out[i * 4 + 1] = 255
  out[i * 4 + 2] = 255
  out[i * 4 + 3] = Math.round(alpha * 255)
  if (alpha > 0.5) covered += 1
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crc])
}

const outStride = width * 4
const scanlines = Buffer.alloc((outStride + 1) * height)
for (let y = 0; y < height; y += 1) {
  scanlines[y * (outStride + 1)] = 0
  out.copy(scanlines, y * (outStride + 1) + 1, y * outStride, (y + 1) * outStride)
}
const header = Buffer.alloc(13)
header.writeUInt32BE(width, 0)
header.writeUInt32BE(height, 4)
header[8] = 8
header[9] = 6
const file = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(output, file)
console.log(`${output}: ${width}x${height}，鲸鱼像素占比 ${((covered / (width * height)) * 100).toFixed(1)}%`)
