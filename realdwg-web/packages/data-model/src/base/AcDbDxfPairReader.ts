import { AcDbDwgVersion } from '../database/AcDbDwgVersion'
import { AcDbCodePage, acdbDwgCodePageToEncoding } from '../misc/AcDbCodePage'
import {
  acdbDxfIsInt32Code,
  acdbDxfValueType
} from './AcDbDxfGroupCodeTypes'
import type { AcDbDxfPair } from './AcDbDxfPair'

/** Magic prefix for AutoCAD Binary DXF files (22 bytes). */
const BINARY_DXF_MAGIC = (() => {
  const prefix = 'AutoCAD Binary DXF\r\n'
  const bytes = new Uint8Array(22)
  for (let i = 0; i < prefix.length; i++) bytes[i] = prefix.charCodeAt(i)
  bytes[20] = 0x1a
  bytes[21] = 0x00
  return bytes
})()

const HEX_NIBBLE: Int8Array = (() => {
  const t = new Int8Array(128)
  for (let i = 0; i < 10; i++) t[0x30 + i] = i
  for (let i = 0; i < 6; i++) {
    t[0x41 + i] = 10 + i
    t[0x61 + i] = 10 + i
  }
  return t
})()

/**
 * Stream of typed DXF group-code/value pairs.
 *
 * Comment pairs (code 999) are filtered — neither `peek` nor `next` returns them.
 * Implementations must not materialize the whole file as a `string[]` of lines.
 */
export interface AcDbDxfPairReader {
  readonly kind: 'ascii' | 'binary'
  next(): AcDbDxfPair | undefined
  peek(): AcDbDxfPair | undefined
  position(): { line?: number; byteOffset: number }
}

export interface AcDbDxfHeaderInfo {
  version: AcDbDwgVersion | null
  encoding: string | null
}

export function acdbIsBinaryDxf(data: Uint8Array): boolean {
  if (data.length < BINARY_DXF_MAGIC.length) return false
  for (let i = 0; i < BINARY_DXF_MAGIC.length; i++) {
    if (data[i] !== BINARY_DXF_MAGIC[i]) return false
  }
  return true
}

/**
 * Peek `$ACADVER` / `$DWGCODEPAGE` from the HEADER section without decoding
 * the whole file. Uses 64 KiB UTF-8 chunks (same strategy as AcDbDxfParser).
 */
export function acdbPeekDxfHeaderInfo(buffer: ArrayBuffer): AcDbDxfHeaderInfo {
  const chunkSize = 64 * 1024
  const decoder = new TextDecoder('utf-8')
  let offset = 0
  let leftover = ''
  let version: AcDbDwgVersion | null = null
  let encoding: string | null = null
  let inHeader = false

  while (offset < buffer.byteLength) {
    const end = Math.min(offset + chunkSize, buffer.byteLength)
    const chunk = buffer.slice(offset, end)
    offset = end

    const text = leftover + decoder.decode(chunk, { stream: true })
    const lines = text.split(/\r?\n/)
    leftover = lines.pop() ?? ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line === 'SECTION' && lines[i + 2]?.trim() === 'HEADER') {
        inHeader = true
      } else if (line === 'ENDSEC' && inHeader) {
        return { version, encoding }
      }

      if (inHeader && line === '$ACADVER') {
        const value = lines[i + 2]?.trim()
        if (value) version = new AcDbDwgVersion(value)
      } else if (inHeader && line === '$DWGCODEPAGE') {
        const value = lines[i + 2]?.trim()
        if (value) {
          const codePage = AcDbCodePage[value as keyof typeof AcDbCodePage]
          encoding = acdbDwgCodePageToEncoding(codePage)
        }
      }

      if (version && encoding) return { version, encoding }
    }
  }

  return { version, encoding }
}

function decodeHexBinary(hex: string): Uint8Array {
  const trimmed = hex.trim()
  const byteLength = trimmed.length >>> 1
  const bytes = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    const hi = HEX_NIBBLE[trimmed.charCodeAt(j * 2) & 0x7f]!
    const lo = HEX_NIBBLE[trimmed.charCodeAt(j * 2 + 1) & 0x7f]!
    bytes[j] = (hi << 4) | lo
  }
  return bytes
}

/** True for every character `String.prototype.trim` strips (exact JS whitespace set). */
function acdbIsTrimWhitespace(c: number): boolean {
  return (
    c === 0x20 ||
    c === 0xa0 ||
    c === 0x1680 ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff ||
    (c >= 0x09 && c <= 0x0d) ||
    (c >= 0x2000 && c <= 0x200a)
  )
}

/**
 * Parses an integer group code straight from the characters of a code line,
 * without allocating the line string or a trimmed copy.
 *
 * Returns NaN for blank or malformed code lines (matches the previous
 * `Number(line.trim())` + finite check for all real-world inputs).
 */
function acdbReadDxfCodeFromChars(
  text: string,
  start: number,
  end: number
): number {
  let i = start
  while (i < end && acdbIsTrimWhitespace(text.charCodeAt(i))) i++
  if (i >= end) return NaN

  let sign = 1
  const c0 = text.charCodeAt(i)
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }

  let value = 0
  let digits = 0
  while (i < end) {
    const c = text.charCodeAt(i)
    if (c >= 0x30 && c <= 0x39) {
      value = value * 10 + (c - 0x30)
      digits++
      i++
    } else {
      break
    }
  }
  if (digits === 0) return NaN

  // Any trailing non-whitespace makes the line non-numeric, as with Number().
  while (i < end) {
    if (!acdbIsTrimWhitespace(text.charCodeAt(i))) return NaN
    i++
  }
  return sign * value
}

/** Equivalent to `trimmed !== '' && trimmed !== '0'` without allocating. */
function acdbDxfRawBoolIsTrue(valueRaw: string): boolean {
  let start = 0
  let end = valueRaw.length
  while (start < end && acdbIsTrimWhitespace(valueRaw.charCodeAt(start))) start++
  while (end > start && acdbIsTrimWhitespace(valueRaw.charCodeAt(end - 1))) end--
  if (start >= end) return false
  return !(end - start === 1 && valueRaw.charCodeAt(start) === 0x30)
}

/**
 * Returns the raw value as-is when it has no surrounding whitespace (the
 * common case), otherwise a trimmed copy. Handle strings feed map keys and
 * hex parsers, so they must never carry surrounding whitespace.
 */
function acdbDxfHandleValue(valueRaw: string): string {
  const len = valueRaw.length
  if (len > 0) {
    const first = valueRaw.charCodeAt(0)
    const last = valueRaw.charCodeAt(len - 1)
    if (!acdbIsTrimWhitespace(first) && !acdbIsTrimWhitespace(last)) {
      return valueRaw
    }
  }
  return valueRaw.trim()
}

function parseAsciiValue(code: number, valueRaw: string): AcDbDxfPair | null {
  const type = acdbDxfValueType(code)
  if (type === 'comment') return null

  switch (type) {
    case 'string':
      return { code, type, value: valueRaw }
    case 'int': {
      // parseInt skips leading whitespace and stops at trailing garbage, so
      // the value line needs no trimmed copy here.
      const n = parseInt(valueRaw, 10)
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'long': {
      const n = Number(valueRaw)
      if (Number.isSafeInteger(n)) return { code, type, value: n }
      try {
        // BigInt does not skip whitespace; trim only on this rare fallback.
        return { code, type, value: BigInt(valueRaw.trim()) }
      } catch {
        return { code, type, value: 0 }
      }
    }
    case 'double': {
      const n = Number(valueRaw)
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'bool':
      return { code, type, value: acdbDxfRawBoolIsTrue(valueRaw) }
    case 'handle':
      return { code, type, value: acdbDxfHandleValue(valueRaw) }
    case 'binary':
      return { code, type, value: decodeHexBinary(valueRaw) }
    default:
      return null
  }
}

/**
 * ASCII pair reader over a decoded DXF string.
 *
 * Scans with a character cursor (no full-file `string[]` of lines).
 */
export function acdbMakeAsciiDxfPairReader(text: string): AcDbDxfPairReader {
  let pos = 0
  let lineNumber = 1
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  /** Advances past one line and returns its content range, without slicing. */
  function readLineSpan(): { start: number; end: number } | undefined {
    if (pos >= text.length) return undefined
    const start = pos
    let contentEnd = pos
    while (contentEnd < text.length) {
      const c = text.charCodeAt(contentEnd)
      if (c === 10 || c === 13) break
      contentEnd++
    }
    let end = contentEnd
    if (end < text.length && text.charCodeAt(end) === 13) end++
    if (end < text.length && text.charCodeAt(end) === 10) end++
    pos = end
    lineNumber++
    return { start, end: contentEnd }
  }

  function readLine(): string | undefined {
    const span = readLineSpan()
    return span ? text.slice(span.start, span.end) : undefined
  }

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeSpan = readLineSpan()
      if (codeSpan === undefined) return undefined
      const code = acdbReadDxfCodeFromChars(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (readLine() === undefined) return undefined
        continue
      }

      const valueRaw = readLine()
      if (valueRaw === undefined) return undefined

      const pair = parseAsciiValue(code, valueRaw)
      if (pair) return pair
    }
  }

  return {
    kind: 'ascii',
    next() {
      if (lookaheadValid) {
        const p = lookahead
        lookahead = undefined
        lookaheadValid = false
        return p
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      return { line: lineNumber, byteOffset: pos }
    }
  }
}

function isUtf8Encoding(encoding: string): boolean {
  const e = encoding.toLowerCase().replace(/_/g, '-')
  return e === 'utf-8' || e === 'utf8' || e === 'unicode-1-1-utf-8'
}

/**
 * Bytes decoded per `TextDecoder` call in {@link acdbMakeUtf8AsciiDxfPairReader}.
 *
 * Sized as a compromise: large enough that a multi-MB DXF costs hundreds of
 * decode calls rather than one per line, small enough that windows still holding
 * a retained value slice do not pin much memory.
 */
const UTF8_DECODE_WINDOW_BYTES = 64 * 1024

/**
 * ASCII pair reader that decodes UTF-8 bytes one line-aligned window at a time,
 * instead of allocating a full-file decoded string (peak memory ≈ input bytes
 * plus one window).
 *
 * Non-UTF-8 code pages still go through {@link acdbMakeAsciiDxfPairReader}
 * after a full `TextDecoder` pass.
 */
export function acdbMakeUtf8AsciiDxfPairReader(
  bytes: Uint8Array
): AcDbDxfPairReader {
  // Skip UTF-8 BOM when present.
  const start =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? 3
      : 0

  let lineNumber = 1
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false
  const decoder = new TextDecoder('utf-8')

  // Decoded window covering bytes [windowStart, windowEnd), scanned by a
  // character cursor. Windows end just past a line break, and a break byte can
  // never appear inside a multi-byte UTF-8 sequence, so each window decodes
  // standalone and no line ever straddles two windows.
  let windowStart = start
  let windowEnd = start
  let text = ''
  let textPos = 0

  /** Decodes the next window. Returns `false` once the input is exhausted. */
  function advanceWindow(): boolean {
    if (windowEnd >= bytes.length) return false
    windowStart = windowEnd
    let end = Math.min(windowStart + UTF8_DECODE_WINDOW_BYTES, bytes.length)
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++
    if (end < bytes.length && bytes[end] === 13) end++
    if (end < bytes.length && bytes[end] === 10) end++
    windowEnd = end
    text = decoder.decode(bytes.subarray(windowStart, windowEnd))
    textPos = 0
    return true
  }

  /** Advances past one line within the current window and returns its range. */
  function readLineSpan(): { start: number; end: number } | undefined {
    while (textPos >= text.length) {
      if (!advanceWindow()) return undefined
    }
    const start = textPos
    let contentEnd = textPos
    while (contentEnd < text.length) {
      const c = text.charCodeAt(contentEnd)
      if (c === 10 || c === 13) break
      contentEnd++
    }
    let end = contentEnd
    if (end < text.length && text.charCodeAt(end) === 13) end++
    if (end < text.length && text.charCodeAt(end) === 10) end++
    textPos = end
    lineNumber++
    return { start, end: contentEnd }
  }

  function readLine(): string | undefined {
    const span = readLineSpan()
    return span ? text.slice(span.start, span.end) : undefined
  }

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeSpan = readLineSpan()
      if (codeSpan === undefined) return undefined
      const code = acdbReadDxfCodeFromChars(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (readLine() === undefined) return undefined
        continue
      }

      const valueRaw = readLine()
      if (valueRaw === undefined) return undefined

      const pair = parseAsciiValue(code, valueRaw)
      if (pair) return pair
    }
  }

  return {
    kind: 'ascii',
    next() {
      if (lookaheadValid) {
        const p = lookahead
        lookahead = undefined
        lookaheadValid = false
        return p
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      // Interpolated inside the current window: callers use this only to report
      // parse progress, so window-level precision is enough.
      const span = windowEnd - windowStart
      const byteOffset =
        span > 0 && text.length > 0
          ? windowStart + Math.round((textPos / text.length) * span)
          : windowEnd
      return { line: lineNumber, byteOffset }
    }
  }
}

function safeBigIntToNumber(v: bigint): number | bigint {
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  const min = -max
  if (v >= min && v <= max) return Number(v)
  return v
}

/**
 * Binary DXF pair reader. Skips the 22-byte magic prefix.
 *
 * @param legacyR12 - AC1009 uses 1-byte group codes (0xFF escape for >255).
 */
export function acdbMakeBinaryDxfPairReader(
  data: Uint8Array,
  options: { encoding?: string; legacyR12?: boolean } = {}
): AcDbDxfPairReader {
  const encoding = options.encoding ?? 'utf-8'
  const legacyR12 = options.legacyR12 ?? false
  const PREFIX = 22
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = data.length >= PREFIX ? PREFIX : data.length
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  function readCode(): number | undefined {
    if (offset >= data.length) return undefined
    if (legacyR12) {
      const first = data[offset]
      if (first === undefined) return undefined
      if (first === 0xff) {
        if (offset + 3 > data.length) return undefined
        offset += 1
        const lo = data[offset]!
        const hi = data[offset + 1]!
        offset += 2
        return (hi << 8) | lo
      }
      offset += 1
      return first
    }
    if (offset + 2 > data.length) return undefined
    const code = view.getUint16(offset, true)
    offset += 2
    return code
  }

  function readString(): string | undefined {
    const start = offset
    while (offset < data.length && data[offset] !== 0) offset += 1
    if (offset >= data.length) return undefined
    const bytes = data.subarray(start, offset)
    offset += 1
    return new TextDecoder(encoding).decode(bytes)
  }

  function readInt16(): number | undefined {
    if (offset + 2 > data.length) return undefined
    const v = view.getInt16(offset, true)
    offset += 2
    return v
  }

  function readInt32(): number | undefined {
    if (offset + 4 > data.length) return undefined
    const v = view.getInt32(offset, true)
    offset += 4
    return v
  }

  function readInt64(): number | bigint | undefined {
    if (offset + 8 > data.length) return undefined
    const v = view.getBigInt64(offset, true)
    offset += 8
    return safeBigIntToNumber(v)
  }

  function readDouble(): number | undefined {
    if (offset + 8 > data.length) return undefined
    const v = view.getFloat64(offset, true)
    offset += 8
    return v
  }

  function readBool(): boolean | undefined {
    if (offset >= data.length) return undefined
    const v = data[offset]
    if (v === undefined) return undefined
    offset += 1
    return v !== 0
  }

  function readBinaryChunk(): Uint8Array | undefined {
    if (offset >= data.length) return undefined
    const length = data[offset]
    if (length === undefined) return undefined
    offset += 1
    if (offset + length > data.length) return undefined
    const bytes = data.slice(offset, offset + length)
    offset += length
    return bytes
  }

  function readRaw(): AcDbDxfPair | undefined {
    while (offset < data.length) {
      const code = readCode()
      if (code === undefined) return undefined
      if (code === 999) {
        if (readString() === undefined) return undefined
        continue
      }
      const type = acdbDxfValueType(code)
      switch (type) {
        case 'string': {
          const value = readString()
          if (value === undefined) return undefined
          return { code, type: 'string', value }
        }
        case 'int': {
          const v = acdbDxfIsInt32Code(code) ? readInt32() : readInt16()
          if (v === undefined) return undefined
          return { code, type: 'int', value: v }
        }
        case 'long': {
          const v = readInt64()
          if (v === undefined) return undefined
          return { code, type: 'long', value: v }
        }
        case 'double': {
          const v = readDouble()
          if (v === undefined) return undefined
          return { code, type: 'double', value: v }
        }
        case 'bool': {
          const v = readBool()
          if (v === undefined) return undefined
          return { code, type: 'bool', value: v }
        }
        case 'handle': {
          const raw = readString()
          if (raw === undefined) return undefined
          return { code, type: 'handle', value: raw }
        }
        case 'binary': {
          const bytes = readBinaryChunk()
          if (bytes === undefined) return undefined
          return { code, type: 'binary', value: bytes }
        }
        case 'comment':
          continue
        default:
          readString()
          continue
      }
    }
    return undefined
  }

  return {
    kind: 'binary',
    next() {
      if (lookaheadValid) {
        const p = lookahead
        lookahead = undefined
        lookaheadValid = false
        return p
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      return { byteOffset: offset }
    }
  }
}

export interface AcDbCreateDxfPairReaderOptions {
  /** Override text encoding for ASCII DXF. */
  encoding?: string
  /** Force R12 1-byte group codes for binary DXF. */
  legacyR12?: boolean
}

/**
 * Create a pair reader from DXF bytes (ASCII or binary).
 *
 * ASCII path: peek HEADER for version/codepage when needed. UTF-8 drawings
 * decode one line-aligned window at a time (no full-file string). Legacy code
 * pages still decode once via `TextDecoder`, then scan with a character cursor.
 */
export function acdbCreateDxfPairReader(
  data: ArrayBuffer | Uint8Array,
  options: AcDbCreateDxfPairReaderOptions = {}
): AcDbDxfPairReader {
  const bytes =
    data instanceof Uint8Array ? data : new Uint8Array(data)

  if (acdbIsBinaryDxf(bytes)) {
    let encoding = options.encoding
    let legacyR12 = options.legacyR12
    if (encoding == null || legacyR12 == null) {
      encoding = encoding ?? 'utf-8'
      if (legacyR12 == null) {
        // After the 22-byte magic: R12 uses 1-byte codes (`0,'S'`), modern
        // uses 2-byte LE codes (`0,0,'S'`) for the first SECTION marker.
        const PREFIX = 22
        const b0 = bytes[PREFIX]
        const b1 = bytes[PREFIX + 1]
        const b2 = bytes[PREFIX + 2]
        if (b0 === 0 && b1 === 0x53 /* 'S' */) {
          legacyR12 = true
        } else if (b0 === 0 && b1 === 0 && b2 === 0x53 /* 'S' */) {
          legacyR12 = false
        } else {
          legacyR12 = false
        }
      }
    }
    return acdbMakeBinaryDxfPairReader(bytes, { encoding, legacyR12 })
  }

  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

  let encoding = options.encoding
  if (encoding == null) {
    const info = acdbPeekDxfHeaderInfo(buffer)
    // Pre-2007 drawings may declare a non-UTF-8 `$DWGCODEPAGE`.
    if (
      info.version &&
      !info.version.capabilities.supportsUtf8CodePage &&
      info.encoding
    ) {
      encoding = info.encoding
    } else {
      encoding = 'utf-8'
    }
  }

  if (isUtf8Encoding(encoding)) {
    return acdbMakeUtf8AsciiDxfPairReader(bytes)
  }

  const text = new TextDecoder(encoding).decode(bytes)
  return acdbMakeAsciiDxfPairReader(text)
}
