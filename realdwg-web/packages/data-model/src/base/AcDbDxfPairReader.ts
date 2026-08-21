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

/**
 * Decodes a hex pair value straight from the span. Trims exactly the
 * characters `String.prototype.trim` strips (see `acdbIsTrimWhitespace`),
 * so it matches the previous `decodeHexBinary(slice)` byte for byte.
 */
function acdbDecodeHexBinarySpan(
  text: string,
  start: number,
  end: number
): Uint8Array {
  while (start < end && acdbIsTrimWhitespace(text.charCodeAt(start))) start++
  while (end > start && acdbIsTrimWhitespace(text.charCodeAt(end - 1))) end--
  const byteLength = (end - start) >>> 1
  const bytes = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    const hi = HEX_NIBBLE[text.charCodeAt(start + j * 2) & 0x7f]!
    const lo = HEX_NIBBLE[text.charCodeAt(start + j * 2 + 1) & 0x7f]!
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
function acdbDxfRawBoolIsTrue(
  text: string,
  start: number,
  end: number
): boolean {
  while (start < end && acdbIsTrimWhitespace(text.charCodeAt(start))) start++
  while (end > start && acdbIsTrimWhitespace(text.charCodeAt(end - 1))) end--
  if (start >= end) return false
  return !(end - start === 1 && text.charCodeAt(start) === 0x30)
}

/**
 * Fast path for `double` value lines: parses `[+-]?digits[.digits][eE[+-]digits]`
 * straight from the span, without slicing the line or calling `Number()`.
 *
 * Exactness: the mantissa is accumulated as an integer double (exact while it
 * has at most 15 significant digits, since 10^15 - 1 < 2^53) and the power-of-ten
 * scale is built by repeated multiplication (exact for |exp| <= 22, since
 * 10^22 < 2^53). Multiplying or dividing two exact doubles rounds exactly once,
 * so the result is the same correctly-rounded value `Number()` produces for the
 * whole line. Any input outside that domain — more than 15 significant digits,
 * |effective exponent| > 22, hex/word literals, garbage — returns `undefined`
 * and the caller falls back to `slice` + `Number`.
 */
function acdbParseDoubleSpan(
  text: string,
  start: number,
  end: number
): number | undefined {
  let i = start
  while (i < end && acdbIsTrimWhitespace(text.charCodeAt(i))) i++
  if (i >= end) return 0

  let sign = 1
  const c0 = text.charCodeAt(i)
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }

  let mantissa = 0
  let digits = 0
  let exp10 = 0
  let anyDigit = false
  let tooLong = false

  while (i < end) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) break
    anyDigit = true
    i++
    if (mantissa === 0 && c === 0x30) continue
    if (digits >= 15) {
      tooLong = true
      continue
    }
    mantissa = mantissa * 10 + (c - 0x30)
    digits++
  }

  if (i < end && text.charCodeAt(i) === 0x2e) {
    i++
    while (i < end) {
      const c = text.charCodeAt(i)
      if (c < 0x30 || c > 0x39) break
      anyDigit = true
      i++
      if (mantissa === 0 && c === 0x30) {
        exp10--
        continue
      }
      if (digits >= 15) {
        tooLong = true
        continue
      }
      mantissa = mantissa * 10 + (c - 0x30)
      digits++
      exp10--
    }
  }

  if (i < end && (text.charCodeAt(i) === 0x65 || text.charCodeAt(i) === 0x45)) {
    i++
    let expSign = 1
    const sc = text.charCodeAt(i)
    if (sc === 0x2d) {
      expSign = -1
      i++
    } else if (sc === 0x2b) {
      i++
    }
    let expVal = 0
    let expDigits = 0
    while (i < end) {
      const c = text.charCodeAt(i)
      if (c < 0x30 || c > 0x39) break
      i++
      expDigits++
      if (expVal <= 10000) expVal = expVal * 10 + (c - 0x30)
    }
    if (expDigits === 0) return undefined
    exp10 += expSign * expVal
  }

  // The rest of the line must be whitespace: `Number()` trims the ends but
  // rejects interior garbage, and hex/binary/octal literals like `0x1A`.
  while (i < end) {
    if (!acdbIsTrimWhitespace(text.charCodeAt(i))) return undefined
    i++
  }

  // Every digit-less value `Number()` accepts ('', whitespace, 'Infinity',
  // 'NaN', …) maps to 0 through the finite check; a bare sign maps to NaN.
  // Both yield +0 (Number('-') is NaN → 0), while '-0.0' keeps its sign.
  if (!anyDigit) return 0

  if (tooLong) return undefined
  if (mantissa === 0) return sign * mantissa

  if (exp10 > 22 || exp10 < -22) return undefined

  let scale = 1
  const k = exp10 < 0 ? -exp10 : exp10
  for (let n = 0; n < k; n++) scale *= 10
  return sign * (exp10 < 0 ? mantissa / scale : mantissa * scale)
}

/**
 * Fast path for `int` value lines with `parseInt(slice, 10)` semantics:
 * skips leading whitespace, takes the longest digit run, ignores the rest.
 * Returns `undefined` for digit runs longer than 15 (the caller falls back to
 * `slice` + `parseInt` to keep the float rounding identical).
 */
function acdbParseIntSpan(
  text: string,
  start: number,
  end: number
): number | undefined {
  let i = start
  while (i < end && acdbIsTrimWhitespace(text.charCodeAt(i))) i++

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
  let anyDigit = false
  while (i < end) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) break
    i++
    anyDigit = true
    if (value === 0 && c === 0x30) continue
    if (digits >= 15) return undefined
    value = value * 10 + (c - 0x30)
    digits++
  }
  // parseInt('-') is NaN → +0, parseInt('-0') is -0: keep the sign only
  // when at least one digit was consumed.
  return anyDigit ? sign * value : 0
}

/**
 * Fast path for `long` value lines with `Number(slice)` semantics (whole line
 * must be numeric, unlike `parseInt`). Returns the integer when it has at most
 * 15 significant digits (exact, always a safe integer); otherwise returns
 * `undefined` and the caller falls back to the `Number`/`BigInt` path.
 */
function acdbParseLongSpan(
  text: string,
  start: number,
  end: number
): number | undefined {
  let i = start
  while (i < end && acdbIsTrimWhitespace(text.charCodeAt(i))) i++

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
  let anyDigit = false
  while (i < end) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) break
    i++
    anyDigit = true
    if (value === 0 && c === 0x30) continue
    if (digits >= 15) return undefined
    value = value * 10 + (c - 0x30)
    digits++
  }

  while (i < end) {
    if (!acdbIsTrimWhitespace(text.charCodeAt(i))) return undefined
    i++
  }
  // Number('-') is NaN → 0 through the safe-integer fallback, Number('-0')
  // is -0: keep the sign only when at least one digit was consumed.
  return anyDigit ? sign * value : 0
}

function parseAsciiValueSpan(
  code: number,
  text: string,
  start: number,
  end: number
): AcDbDxfPair | null {
  const type = acdbDxfValueType(code)
  if (type === 'comment') return null

  switch (type) {
    case 'string':
      return { code, type, value: text.slice(start, end) }
    case 'int': {
      const fast = acdbParseIntSpan(text, start, end)
      // parseInt skips leading whitespace and stops at trailing garbage, so
      // the value line needs no trimmed copy here.
      const n = fast === undefined ? parseInt(text.slice(start, end), 10) : fast
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'long': {
      const fast = acdbParseLongSpan(text, start, end)
      if (fast !== undefined) return { code, type, value: fast }
      const valueRaw = text.slice(start, end)
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
      const fast = acdbParseDoubleSpan(text, start, end)
      const n =
        fast === undefined ? Number(text.slice(start, end)) : fast
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'bool':
      return { code, type, value: acdbDxfRawBoolIsTrue(text, start, end) }
    case 'handle': {
      const first = text.charCodeAt(start)
      const last = text.charCodeAt(end - 1)
      if (!acdbIsTrimWhitespace(first) && !acdbIsTrimWhitespace(last)) {
        return { code, type, value: text.slice(start, end) }
      }
      return { code, type, value: text.slice(start, end).trim() }
    }
    case 'binary':
      return { code, type, value: acdbDecodeHexBinarySpan(text, start, end) }
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

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeSpan = readLineSpan()
      if (codeSpan === undefined) return undefined
      const code = acdbReadDxfCodeFromChars(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (readLineSpan() === undefined) return undefined
        continue
      }

      const valueSpan = readLineSpan()
      if (valueSpan === undefined) return undefined

      const pair = parseAsciiValueSpan(code, text, valueSpan.start, valueSpan.end)
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
 * Returns whether the given encoding label is safe for line-aligned windowed
 * decoding (see {@link acdbMakeWindowedAsciiDxfPairReader}).
 *
 * Excludes the UTF-16 family — 0x0A can occur as the low byte of any two-byte
 * code unit — and any label `TextDecoder` does not recognize (unknown labels
 * fall back to the full-decode path).
 */
export function acdbSupportsWindowedDecode(encoding: string): boolean {
  const e = encoding.toLowerCase().replace(/_/g, '-')
  if (
    e === 'utf-16' ||
    e === 'utf-16le' ||
    e === 'utf-16be' ||
    e === 'ucs-2' ||
    e === 'ucs2'
  ) {
    return false
  }
  try {
    new TextDecoder(encoding)
    return true
  } catch {
    return false
  }
}

/**
 * Bytes scanned by {@link acdbValidateUtf8Prefix} when a drawing declares a
 * legacy codepage. Large enough that a real legacy-encoded file (GBK, Big5,
 * Shift-JIS, …) fails validation with overwhelming probability, small enough
 * that the scan stays negligible.
 */
export const UTF8_SNIFF_BYTES = 256 * 1024

/**
 * Strict RFC 3629 UTF-8 validation over a byte prefix, used to detect
 * "UTF-8 bytes with a stale header" files — e.g. domestic tools that emit
 * UTF-8 content but keep `$DWGCODEPAGE: ANSI_936` from a template while the
 * `$ACADVER` predates the UTF-8 codepage.
 *
 * Returns `true` only when the whole scanned prefix is valid UTF-8 **and**
 * contains at least one multi-byte sequence. Pure-ASCII prefixes return
 * `false` so ASCII files keep their declared legacy codepage (the two
 * decodings agree on ASCII anyway, and the windowed path must not needlessly
 * change labels). Legacy encodings use trail bytes in [0x40, 0x7F] or lead
 * bytes below 0xC2, which fail the continuation checks; a 256 KiB sample
 * makes a false "valid UTF-8" verdict on a real GBK/Big5 file vanishingly
 * unlikely.
 *
 * A multi-byte sequence straddling the end of the scan window is completed
 * (up to 3 bytes past the window) so the verdict is not biased by the cut.
 */
export function acdbValidateUtf8Prefix(
  bytes: Uint8Array,
  maxBytes: number
): boolean {
  let limit = Math.min(bytes.length, maxBytes)
  let multibyte = false
  let i = 0
  while (i < limit) {
    const b = bytes[i]!
    if (b < 0x80) {
      i++
      continue
    }
    let len: number
    if (b >= 0xc2 && b <= 0xdf) len = 2
    else if (b >= 0xe0 && b <= 0xef) len = 3
    else if (b >= 0xf0 && b <= 0xf4) len = 4
    else return false
    if (i + len > bytes.length) return false
    if (i + len > limit) limit = Math.min(i + len, bytes.length)
    const c1 = bytes[i + 1]!
    if (len === 3 && ((b === 0xe0 && c1 < 0xa0) || (b === 0xed && c1 > 0x9f))) {
      return false
    }
    if (len === 4 && ((b === 0xf0 && c1 < 0x90) || (b === 0xf4 && c1 > 0x8f))) {
      return false
    }
    for (let k = 1; k < len; k++) {
      const c = bytes[i + k]!
      if (c < 0x80 || c > 0xbf) return false
    }
    multibyte = true
    i += len
  }
  return multibyte
}

/**
 * Bytes decoded per `TextDecoder` call in {@link acdbMakeWindowedAsciiDxfPairReader}.
 *
 * Sized as a compromise: large enough that a multi-MB DXF costs hundreds of
 * decode calls rather than one per line, small enough that windows still holding
 * a retained value slice do not pin much memory.
 */
const WINDOWED_DECODE_WINDOW_BYTES = 64 * 1024

/**
 * ASCII pair reader that decodes one line-aligned window at a time, instead of
 * allocating a full-file decoded string (peak memory ≈ input bytes plus one
 * window).
 *
 * The byte-level window scan looks for 0x0A/0x0D line breaks, which can never
 * occur inside a multi-byte sequence of any line-safe encoding: UTF-8
 * continuation bytes are >= 0x80, GBK/Big5/Shift-JIS/EUC-KR trail bytes are
 * >= 0x40, and the remaining code pages are single-byte. Each window therefore
 * ends on a line break and decodes standalone without decoder state.
 *
 * Only pass encodings accepted by {@link acdbSupportsWindowedDecode};
 * `acdbCreateDxfPairReader` is the gate for real-world files.
 */
export function acdbMakeWindowedAsciiDxfPairReader(
  bytes: Uint8Array,
  encoding: string
): AcDbDxfPairReader {
  if (!acdbSupportsWindowedDecode(encoding)) {
    throw new Error(
      `acdbMakeWindowedAsciiDxfPairReader: encoding '${encoding}' is not ` +
        'safe for line-aligned windowed decoding'
    )
  }

  // Skip the UTF-8 BOM when present (the other line-safe encodings have no
  // BOM convention this reader needs to handle).
  const utf8 = isUtf8Encoding(encoding)
  const start =
    utf8 &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? 3
      : 0

  let lineNumber = 1
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false
  const decoder = new TextDecoder(encoding)

  // Decoded window covering bytes [windowStart, windowEnd), scanned by a
  // character cursor. Windows end just past a line break, and a break byte can
  // never appear inside a multi-byte sequence of the encodings accepted here,
  // so each window decodes standalone and no line ever straddles two windows.
  let windowStart = start
  let windowEnd = start
  let text = ''
  let textPos = 0

  /** Decodes the next window. Returns `false` once the input is exhausted. */
  function advanceWindow(): boolean {
    if (windowEnd >= bytes.length) return false
    windowStart = windowEnd
    let end = Math.min(windowStart + WINDOWED_DECODE_WINDOW_BYTES, bytes.length)
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

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeSpan = readLineSpan()
      if (codeSpan === undefined) return undefined
      const code = acdbReadDxfCodeFromChars(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (readLineSpan() === undefined) return undefined
        continue
      }

      const valueSpan = readLineSpan()
      if (valueSpan === undefined) return undefined

      const pair = parseAsciiValueSpan(code, text, valueSpan.start, valueSpan.end)
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

/**
 * Backwards-compatible wrapper around {@link acdbMakeWindowedAsciiDxfPairReader}
 * for UTF-8 input.
 */
export function acdbMakeUtf8AsciiDxfPairReader(
  bytes: Uint8Array
): AcDbDxfPairReader {
  return acdbMakeWindowedAsciiDxfPairReader(bytes, 'utf-8')
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
  /**
   * When true (default) and the header declares a legacy codepage for a
   * pre-2007 drawing, validate the byte prefix with
   * {@link acdbValidateUtf8Prefix} and treat the file as UTF-8 when it passes.
   * Covers "UTF-8 bytes with a stale header" files; set false to always trust
   * the declared codepage.
   */
  sniffUtf8?: boolean
}

/**
 * Create a pair reader from DXF bytes (ASCII or binary).
 *
 * ASCII path: peek HEADER for version/codepage when needed. Line-safe encodings
 * (UTF-8, GBK, Big5, Shift-JIS, EUC-KR, single-byte code pages) decode one
 * line-aligned window at a time (no full-file string). The UTF-16 family and
 * unknown labels decode once via `TextDecoder`, then scan with a character
 * cursor.
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
  const autoDetected = encoding == null
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

  // Only sniff automatically detected legacy labels — an explicit
  // `options.encoding` always wins. If the byte prefix is strictly valid
  // UTF-8 with at least one multi-byte sequence, override the declared
  // codepage (stale headers from tools that write UTF-8 content).
  if (
    autoDetected &&
    !isUtf8Encoding(encoding) &&
    options.sniffUtf8 !== false &&
    acdbValidateUtf8Prefix(bytes, UTF8_SNIFF_BYTES)
  ) {
    encoding = 'utf-8'
  }

  if (acdbSupportsWindowedDecode(encoding)) {
    return acdbMakeWindowedAsciiDxfPairReader(bytes, encoding)
  }

  // UTF-16 family or unknown labels: decode the whole buffer in one pass.
  const text = new TextDecoder(encoding).decode(bytes)
  return acdbMakeAsciiDxfPairReader(text)
}
