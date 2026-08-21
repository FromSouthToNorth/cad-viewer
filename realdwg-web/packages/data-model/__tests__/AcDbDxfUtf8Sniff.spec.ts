import {
  acdbCreateDxfPairReader,
  acdbValidateUtf8Prefix,
  UTF8_SNIFF_BYTES
} from '../src/base/AcDbDxfPairReader'
import type { AcDbDxfPair } from '../src/base/AcDbDxfPair'

function collectPairs(reader: ReturnType<typeof acdbCreateDxfPairReader>) {
  const out: AcDbDxfPair[] = []
  for (;;) {
    const pair = reader.next()
    if (pair === undefined) return out
    out.push(pair)
  }
}

function hasValue(pairs: AcDbDxfPair[], value: unknown): boolean {
  return pairs.some((p) => p.value === value)
}

/**
 * DXF with a pre-2007 header that declares `ANSI_936` (GBK) while the file
 * content itself is UTF-8 — the "stale header" case from domestic tools.
 */
function buildStaleHeaderUtf8Dxf(): Uint8Array {
  const lines = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1015',
    '9', '$DWGCODEPAGE',
    '3', 'ANSI_936',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'TEXT',
    '8', '图层',
    '1', '中文文本',
    '0', 'ENDSEC',
    '0', 'EOF'
  ]
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n')
}

describe('acdbValidateUtf8Prefix', () => {
  function v(bytes: number[]): boolean {
    return acdbValidateUtf8Prefix(new Uint8Array(bytes), UTF8_SNIFF_BYTES)
  }

  it('rejects pure ASCII (no multi-byte sequence)', () => {
    expect(v([0x41, 0x42, 0x43, 0x0d, 0x0a])).toBe(false)
  })

  it('accepts ASCII with a valid 2-byte sequence', () => {
    expect(v([0x41, 0xc2, 0xa2, 0x42])).toBe(true)
  })

  it('rejects overlong 2-byte leads (0xC0/0xC1)', () => {
    expect(v([0xc0, 0x80])).toBe(false)
    expect(v([0xc1, 0xbf])).toBe(false)
  })

  it('rejects stray continuation bytes', () => {
    expect(v([0x41, 0x80, 0x42])).toBe(false)
    expect(v([0xbf])).toBe(false)
  })

  it('rejects surrogate encodings and accepts 0xED boundary values', () => {
    expect(v([0xed, 0xa0, 0x80])).toBe(false) // U+D800
    expect(v([0xed, 0xbf, 0xbf])).toBe(false) // U+DFFF
    expect(v([0xed, 0x9f, 0xbf])).toBe(true) // U+D7FF
  })

  it('rejects overlong 3-byte encodings', () => {
    expect(v([0xe0, 0x9f, 0xbf])).toBe(false)
    expect(v([0xe0, 0xa0, 0x80])).toBe(true)
  })

  it('handles 4-byte boundary values', () => {
    expect(v([0xf0, 0x8f, 0xbf, 0xbf])).toBe(false)
    expect(v([0xf0, 0x90, 0x80, 0x80])).toBe(true) // U+10000
    expect(v([0xf4, 0x8f, 0xbf, 0xbf])).toBe(true) // U+10FFFF
    expect(v([0xf4, 0x90, 0x80, 0x80])).toBe(false)
    expect(v([0xf5, 0x80, 0x80, 0x80])).toBe(false)
  })

  it('rejects GBK text whose lead byte is below 0xC2', () => {
    // GBK 图层 = CD BC B2 E3: 层 (B2 E3) has lead 0xB2 < 0xC2.
    expect(v([0xcd, 0xbc, 0xb2, 0xe3])).toBe(false)
  })

  it('rejects sequences truncated at end of input', () => {
    expect(v([0x41, 0xc2])).toBe(false)
    expect(v([0x41, 0xe4, 0xb8])).toBe(false)
  })

  it('completes a sequence straddling the scan window', () => {
    // 中 in UTF-8 (E4 B8 AD) straddles a 2-byte window.
    const bytes = new Uint8Array([0x41, 0xe4, 0xb8, 0xad])
    expect(acdbValidateUtf8Prefix(bytes, 2)).toBe(true)
  })

  it('rejects invalid bytes before a straddling sequence', () => {
    const bytes = new Uint8Array([0x41, 0xff, 0xe4, 0xb8, 0xad])
    expect(acdbValidateUtf8Prefix(bytes, 2)).toBe(false)
  })
})

describe('UTF-8 sniff fallback in acdbCreateDxfPairReader', () => {
  it('decodes UTF-8 content despite the stale ANSI_936 header', () => {
    const pairs = collectPairs(
      acdbCreateDxfPairReader(buildStaleHeaderUtf8Dxf())
    )
    expect(hasValue(pairs, '中文文本')).toBe(true)
    expect(hasValue(pairs, '图层')).toBe(true)
  })

  it('does not override an explicit encoding option', () => {
    const pairs = collectPairs(
      acdbCreateDxfPairReader(buildStaleHeaderUtf8Dxf(), { encoding: 'gbk' })
    )
    expect(hasValue(pairs, '中文文本')).toBe(false)
  })

  it('does not override when sniffUtf8 is disabled', () => {
    const pairs = collectPairs(
      acdbCreateDxfPairReader(buildStaleHeaderUtf8Dxf(), { sniffUtf8: false })
    )
    expect(hasValue(pairs, '中文文本')).toBe(false)
  })
})

const GBK_TABLE: Record<string, number[]> = {
  图: [0xcd, 0xbc],
  层: [0xb2, 0xe3],
  道: [0xb5, 0xc0],
  路: [0xc2, 0xb7]
}

function toGbkBytes(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    const seq = GBK_TABLE[ch]
    if (seq) {
      out.push(...seq)
    } else if (ch.charCodeAt(0) < 0x80) {
      out.push(ch.charCodeAt(0))
    } else {
      throw new Error(`No GBK fixture mapping for character: ${ch}`)
    }
  }
  return new Uint8Array(out)
}

describe('UTF-8 sniff regression for real GBK files', () => {
  it('still decodes GBK content with an ANSI_936 header as GBK', () => {
    const lines = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER',
      '1', 'AC1015',
      '9', '$DWGCODEPAGE',
      '3', 'ANSI_936',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES',
      '0', 'TEXT',
      '8', '图层',
      '1', '道路',
      '0', 'ENDSEC',
      '0', 'EOF'
    ]
    const bytes = toGbkBytes(lines.join('\r\n') + '\r\n')
    // 层 = B2 E3 has a lead byte below 0xC2, so the prefix must fail the
    // UTF-8 validation and keep the declared GBK codepage.
    expect(acdbValidateUtf8Prefix(bytes, UTF8_SNIFF_BYTES)).toBe(false)
    const pairs = collectPairs(acdbCreateDxfPairReader(bytes))
    expect(hasValue(pairs, '图层')).toBe(true)
    expect(hasValue(pairs, '道路')).toBe(true)
  })
})
