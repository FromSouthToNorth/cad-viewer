import {
  acdbMakeAsciiDxfPairReader,
  acdbMakeWindowedAsciiDxfPairReader
} from '../src/base/AcDbDxfPairReader'
import type { AcDbDxfPair } from '../src/base/AcDbDxfPair'

/**
 * Differential tests for the span-based value parsing in the ASCII pair
 * readers. The "reference" helpers below re-implement the exact semantics of
 * the previous slice-based parser (`Number`, `parseInt`, `BigInt`, trim …), so
 * every pair must match them strictly.
 */

function acdbRefIsWs(c: number): boolean {
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

function refDouble(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function refInt(raw: string): number {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

function refLong(raw: string): number | bigint {
  const n = Number(raw)
  if (Number.isSafeInteger(n)) return n
  try {
    return BigInt(raw.trim())
  } catch {
    return 0
  }
}

function refBool(raw: string): boolean {
  let start = 0
  let end = raw.length
  while (start < end && acdbRefIsWs(raw.charCodeAt(start))) start++
  while (end > start && acdbRefIsWs(raw.charCodeAt(end - 1))) end--
  if (start >= end) return false
  return !(end - start === 1 && raw.charCodeAt(start) === 0x30)
}

function refHandle(raw: string): string {
  const len = raw.length
  if (len > 0) {
    const first = raw.charCodeAt(0)
    const last = raw.charCodeAt(len - 1)
    if (!acdbRefIsWs(first) && !acdbRefIsWs(last)) return raw
  }
  return raw.trim()
}

function refHexNibble(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10
  return 0
}

function refBinary(raw: string): Uint8Array {
  const trimmed = raw.trim()
  const bytes = new Uint8Array(trimmed.length >>> 1)
  for (let j = 0; j < bytes.length; j++) {
    bytes[j] =
      (refHexNibble(trimmed.charCodeAt(j * 2)) << 4) |
      refHexNibble(trimmed.charCodeAt(j * 2 + 1))
  }
  return bytes
}

type RefValue = number | bigint | boolean | string | Uint8Array

function refValue(code: number, raw: string): RefValue {
  if (code === 10 || code === 11) return refDouble(raw)
  if (code === 70) return refInt(raw)
  if (code === 160) return refLong(raw)
  if (code === 290) return refBool(raw)
  if (code === 5) return refHandle(raw)
  if (code === 310) return refBinary(raw)
  return raw
}

function buildText(pairs: Array<[number, string]>): string {
  const lines: string[] = []
  for (const [code, value] of pairs) {
    lines.push(String(code), value)
  }
  return lines.join('\r\n') + '\r\n'
}

function collectPairs(reader: ReturnType<typeof acdbMakeAsciiDxfPairReader>) {
  const out: AcDbDxfPair[] = []
  for (;;) {
    const pair = reader.next()
    if (pair === undefined) return out
    out.push(pair)
  }
}

function expectPairMatches(pair: AcDbDxfPair, raw: string) {
  const expected = refValue(pair.code, raw)
  if (expected instanceof Uint8Array) {
    const actual = pair.value as Uint8Array
    expect(actual).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
  } else if (pair.code === 160) {
    // 'long' may be number or bigint; toEqual distinguishes 9007199254740992n
    // from the rounded double, exactly like the previous implementation.
    expect(pair.value).toEqual(expected)
  } else if (pair.code === 10 || pair.code === 11) {
    // Strict `===` for doubles (Object.is: distinguishes NaN, which never
    // occurs here since both sides map non-finite to 0).
    expect(pair.value).toBe(expected)
  } else {
    expect(pair.value).toBe(expected)
  }
}

function checkPairs(
  pairs: Array<[number, string]>,
  reader: ReturnType<typeof acdbMakeAsciiDxfPairReader>
) {
  const collected = collectPairs(reader)
  expect(collected.length).toBe(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    expectPairMatches(collected[i]!, pairs[i]![1])
  }
}

describe('span-based value parsing differential', () => {
  // code → type: 10 double, 70 int, 160 long, 290 bool, 5 handle, 310 binary, 1 string
  const crafted: Array<[number, string]> = [
    // doubles — grammar corners
    [10, '0'],
    [10, '-0'],
    [10, '0.0'],
    [10, '-0.0'],
    [10, '.5'],
    [10, '-.5'],
    [10, '+.5'],
    [10, '5.'],
    [10, '-5.'],
    [10, '0.1'],
    [10, '2.5'],
    [10, '007'],
    [10, ' 1.5 '],
    [10, '\t-2.25\t'],
    [10, '1e3'],
    [10, '1E3'],
    [10, '1e-3'],
    [10, '1e+3'],
    [10, '1e-006'],
    [10, '2.5E+1'],
    [10, '1.e5'],
    [10, '.5e-2'],
    [10, '+.5e-2'],
    [10, '1e22'],
    [10, '1e-22'],
    [10, '1.5e-20'],
    [10, '123456789012345'],
    [10, '-123456789012345'],
    [10, '9.99999999999999'],
    [10, '0.000000000000001'],
    [10, '0.123456789012345'],
    [10, '1e-006'],
    [10, '1234.5678901235'],
    [10, '360'],
    [10, '3.141592653589793'],
    // doubles — bail-out domain (long digits / huge exponents / literals)
    [10, '1234567890123456'],
    [10, '12345678901234567890'],
    [10, '0.123456789012345678'],
    [10, '1e23'],
    [10, '1e-23'],
    [10, '1e999'],
    [10, '1e-999'],
    [10, '123456789012345e10'],
    [10, '1.7976931348623157e308'],
    [10, '5e-324'],
    [10, '0x10'],
    [10, '0x1A'],
    [10, '0b101'],
    [10, '0o17'],
    [10, 'Infinity'],
    [10, '-Infinity'],
    [10, '+Infinity'],
    [10, 'NaN'],
    [10, '1_000'],
    [10, '1 000'],
    [10, '1,5'],
    [10, '1e'],
    [10, '1e+'],
    [10, 'e5'],
    [10, '12abc'],
    [10, '1.2.3'],
    [10, ''],
    [10, '   '],
    [10, '-'],
    [10, '+'],
    [10, '.'],
    [10, '-x'],
    [10, '0x'],
    // ints
    [70, '12'],
    [70, '-12'],
    [70, '+7'],
    [70, ' 12'],
    [70, '12 '],
    [70, ' 12 '],
    [70, '12abc'],
    [70, '0x10'],
    [70, ''],
    [70, 'abc'],
    [70, '   '],
    [70, '000123'],
    [70, '-007'],
    [70, '9007199254740992'],
    [70, '9007199254740993'],
    [70, '999999999999999999999'],
    [70, '0000000000000000001'],
    [70, '123'],
    [70, '0'],
    [70, '-0'],
    // longs
    [160, '12'],
    [160, '-12'],
    [160, '+7'],
    [160, ' 123 '],
    [160, '0'],
    [160, '-0'],
    [160, ''],
    [160, '   '],
    [160, '-'],
    [160, '9007199254740991'],
    [160, '9007199254740992'],
    [160, '9007199254740993'],
    [160, '-9007199254740993'],
    [160, '999999999999999999999999999999'],
    [160, '123abc'],
    [160, '0x10'],
    [160, ' 9007199254740993 '],
    [160, '000123'],
    // bools
    [290, '1'],
    [290, '0'],
    [290, ' 0 '],
    [290, ' 1 '],
    [290, ''],
    [290, '   '],
    [290, '00'],
    [290, '01'],
    [290, 'true'],
    [290, '10'],
    [290, '\t0\t'],
    // handles
    [5, 'ABC'],
    [5, ' ABC '],
    [5, 'ABC '],
    [5, ' ABC'],
    [5, '\tDEF\t'],
    [5, ''],
    [5, '   '],
    [5, '1F'],
    [5, 'A B'],
    // binary
    [310, '0A0B'],
    [310, ' 0A0B '],
    [310, '0a0b'],
    [310, ''],
    [310, '   '],
    [310, 'ABCDEF'],
    [310, '0'],
    // strings
    [1, 'ABC'],
    [1, ' ABC '],
    [1, ''],
    [1, '中文文本'],
    [1, ' leading and trailing  '],
    // comments get filtered by the reader, not by span parsing
  ]

  it('ascii reader matches the slice-based reference semantics', () => {
    const reader = acdbMakeAsciiDxfPairReader(buildText(crafted))
    checkPairs(crafted, reader)
  })

  it('windowed reader matches the slice-based reference semantics', () => {
    const reader = acdbMakeWindowedAsciiDxfPairReader(
      new TextEncoder().encode(buildText(crafted)),
      'utf-8'
    )
    checkPairs(crafted, reader)
  })

  it('windowed and full-text readers agree on multibyte string values', () => {
    const text = buildText(crafted)
    const a = collectPairs(acdbMakeAsciiDxfPairReader(text))
    const b = collectPairs(
      acdbMakeWindowedAsciiDxfPairReader(new TextEncoder().encode(text), 'utf-8')
    )
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.code).toBe(a[i]!.code)
      expect(b[i]!.type).toBe(a[i]!.type)
      if (a[i]!.value instanceof Uint8Array) {
        expect(
          Buffer.from(b[i]!.value as Uint8Array).equals(
            Buffer.from(a[i]!.value as Uint8Array)
          )
        ).toBe(true)
      } else {
        expect(b[i]!.value).toEqual(a[i]!.value)
      }
    }
  })

  it('filters 999 comment pairs without slicing their value line', () => {
    const text = ['999', 'a comment', '10', '1.5', '999', 'another', '70', '3'].join('\r\n')
    const reader = acdbMakeAsciiDxfPairReader(text)
    expect(collectPairs(reader).map((p) => [p.code, p.value])).toEqual([
      [10, 1.5],
      [70, 3]
    ])
  })
})

/** Deterministic PRNG so fuzz failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDoubleValue(rng: () => number): string {
  const roll = rng()
  if (roll < 0.02) {
    // digit-less / special forms
    const specials = ['', '   ', '-', '+', '.', 'Infinity', '-Infinity', 'NaN', 'e5', '0x10']
    return specials[Math.floor(rng() * specials.length)]!
  }
  if (roll < 0.05) {
    // hex/binary/octal literals
    const prefix = ['0x', '0X', '0b', '0B', '0o', '0O'][Math.floor(rng() * 6)]!
    return prefix + Math.floor(rng() * 0xffff).toString(16)
  }
  let s = ''
  if (rng() < 0.5) s += rng() < 0.5 ? '-' : '+'
  const intDigits = 1 + Math.floor(rng() * 18)
  for (let i = 0; i < intDigits; i++) s += Math.floor(rng() * 10)
  if (rng() < 0.6) {
    s += '.'
    const fracDigits = Math.floor(rng() * 12)
    for (let i = 0; i < fracDigits; i++) s += Math.floor(rng() * 10)
  }
  if (rng() < 0.35) {
    s += rng() < 0.5 ? 'e' : 'E'
    if (rng() < 0.5) s += rng() < 0.5 ? '-' : '+'
    s += Math.floor(rng() * 400)
  }
  if (rng() < 0.1) {
    const garbage = ['x', 'a', '_', ' ', ',', '.']
    s += garbage[Math.floor(rng() * garbage.length)]
    if (rng() < 0.3) s += Math.floor(rng() * 10)
  }
  if (rng() < 0.2) {
    const ws = [' ', '\t', '\u00a0']
    const w = ws[Math.floor(rng() * ws.length)]!
    if (rng() < 0.5) s = w + s
    if (rng() < 0.5) s = s + w
  }
  return s
}

function randomIntValue(rng: () => number): string {
  let s = ''
  if (rng() < 0.5) s += rng() < 0.5 ? '-' : '+'
  const digits = Math.floor(rng() * 21)
  for (let i = 0; i < digits; i++) s += Math.floor(rng() * 10)
  if (rng() < 0.15) s += ['x', 'a', ' '][Math.floor(rng() * 3)]!
  if (rng() < 0.2) s = (rng() < 0.5 ? ' ' : '\t') + s
  return s
}

describe('span-based value parsing fuzz differential', () => {
  it('matches Number() on 100k random double value lines', () => {
    const rng = mulberry32(0xd0b1e)
    const pairs: Array<[number, string]> = []
    for (let i = 0; i < 100000; i++) pairs.push([10, randomDoubleValue(rng)])
    const text = buildText(pairs)
    checkPairs(pairs, acdbMakeAsciiDxfPairReader(text))
  })

  it('matches Number() on random doubles through the windowed reader', () => {
    const rng = mulberry32(0xd0b1e)
    const pairs: Array<[number, string]> = []
    for (let i = 0; i < 100000; i++) pairs.push([10, randomDoubleValue(rng)])
    const text = buildText(pairs)
    checkPairs(
      pairs,
      acdbMakeWindowedAsciiDxfPairReader(new TextEncoder().encode(text), 'utf-8')
    )
  })

  it('matches parseInt() on 30k random int value lines', () => {
    const rng = mulberry32(0x1f17)
    const pairs: Array<[number, string]> = []
    for (let i = 0; i < 30000; i++) pairs.push([70, randomIntValue(rng)])
    const text = buildText(pairs)
    checkPairs(pairs, acdbMakeAsciiDxfPairReader(text))
  })

  it('matches Number()/BigInt on 30k random long value lines', () => {
    const rng = mulberry32(0x10f7)
    const pairs: Array<[number, string]> = []
    for (let i = 0; i < 30000; i++) pairs.push([160, randomIntValue(rng)])
    const text = buildText(pairs)
    checkPairs(pairs, acdbMakeAsciiDxfPairReader(text))
  })
})
