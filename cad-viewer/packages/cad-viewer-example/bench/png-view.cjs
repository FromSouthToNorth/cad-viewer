/**
 * Minimal PNG viewer for headless verification: decodes 8-bit RGB/RGBA PNGs
 * without interlace using Node's built-in zlib and prints a downsampled ASCII
 * brightness map plus per-channel statistics.
 *
 * Usage: node bench/png-view.cjs file.png [cols]
 */
const fs = require('fs')
const zlib = require('zlib')

function decodePng(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported bitDepth=${bitDepth} colorType=${colorType}`)
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x]
      const left = x >= channels ? out[dst + x - channels] : 0
      const up = y > 0 ? out[dst - stride + x] : 0
      const upLeft = y > 0 && x >= channels ? out[dst - stride + x - channels] : 0
      let value
      switch (filter) {
        case 0:
          value = rawByte
          break
        case 1:
          value = rawByte + left
          break
        case 2:
          value = rawByte + up
          break
        case 3:
          value = rawByte + ((left + up) >> 1)
          break
        case 4:
          value = rawByte + paeth(left, up, upLeft)
          break
        default:
          throw new Error(`unknown filter ${filter}`)
      }
      out[dst + x] = value & 0xff
    }
  }
  return { width, height, channels, data: out }
}

const file = process.argv[2]
const cols = Number(process.argv[3] ?? 120)
const { width, height, channels, data } = decodePng(file)

let nonBg = 0
let colored = 0
let blue = 0
const sum = { r: 0, g: 0, b: 0 }
for (let i = 0; i < data.length; i += channels) {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  sum.r += r
  sum.g += g
  sum.b += b
  if (r > 20 || g > 20 || b > 20) nonBg++
  if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++
  if (b > r + 30 && b > g + 30) blue++
}
const total = width * height
console.log(
  `${file}: ${width}x${height} ch=${channels} nonBg=${((nonBg / total) * 100).toFixed(1)}% colored=${((colored / total) * 100).toFixed(1)}% blue=${((blue / total) * 100).toFixed(1)}% avgRGB=(${(sum.r / total) | 0},${(sum.g / total) | 0},${(sum.b / total) | 0})`
)

const rows = Math.floor((cols * height) / width / 2.2)
const chars = ' .:-=+*#%@'
for (let ry = 0; ry < rows; ry++) {
  let line = ''
  for (let cx = 0; cx < cols; cx++) {
    const x = Math.floor((cx / cols) * width)
    const y = Math.floor((ry / rows) * height)
    const i = (y * width + x) * channels
    const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
    line += chars[Math.min(9, Math.floor(luma * 10))]
  }
  console.log(line)
}
