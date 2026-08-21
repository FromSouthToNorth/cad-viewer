import {
  acdbCreateDxfPairReader,
  acdbMakeAsciiDxfPairReader,
  acdbMakeUtf8AsciiDxfPairReader,
  acdbMakeWindowedAsciiDxfPairReader,
  acdbSupportsWindowedDecode,
  type AcDbDxfPairReader
} from '../src/base/AcDbDxfPairReader'

/**
 * GBK byte sequences for the small set of Chinese characters used in the
 * fixtures. ASCII passes through unchanged (GBK is an ASCII superset for
 * bytes < 0x80).
 */
const GBK_TABLE: Record<string, number[]> = {
  图: [0xcd, 0xbc],
  层: [0xb2, 0xe3],
  中: [0xd6, 0xd0],
  文: [0xce, 0xc4],
  测: [0xb2, 0xe2],
  量: [0xc1, 0xbf],
  道: [0xb5, 0xc0],
  路: [0xc2, 0xb7],
  采: [0xb2, 0xc9],
  区: [0xc7, 0xf8],
  标: [0xb1, 0xea],
  注: [0xd7, 0xa2],
  释: [0xca, 0xcd]
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

function buildGbkDxf(lines: string[]): Uint8Array {
  return toGbkBytes(lines.join('\r\n') + '\r\n')
}

function collectPairs(reader: AcDbDxfPairReader) {
  const pairs: Array<{ code: number; type: string; value: unknown }> = []
  for (;;) {
    const pair = reader.next()
    if (pair === undefined) break
    pairs.push({ code: pair.code, type: pair.type, value: pair.value })
  }
  return pairs
}

function expectPairParity(
  windowedBytes: Uint8Array,
  encoding: string
): void {
  const full = collectPairs(
    acdbMakeAsciiDxfPairReader(new TextDecoder(encoding).decode(windowedBytes))
  )
  const windowed = collectPairs(
    acdbMakeWindowedAsciiDxfPairReader(windowedBytes, encoding)
  )
  expect(windowed).toEqual(full)
}

describe('acdbSupportsWindowedDecode', () => {
  it('accepts line-safe encodings', () => {
    for (const encoding of [
      'utf-8',
      'UTF8',
      'gbk',
      'GB2312',
      'big5',
      'shift-jis',
      'Shift_JIS',
      'euc-kr',
      'windows-1252',
      'iso-8859-1',
      'ibm866',
      'macintosh',
      'windows-874'
    ]) {
      expect(acdbSupportsWindowedDecode(encoding)).toBe(true)
    }
  })

  it('rejects the UTF-16 family and unknown labels', () => {
    for (const encoding of [
      'utf-16',
      'utf-16le',
      'utf-16be',
      'ucs-2',
      'ucs2',
      'not-a-real-encoding'
    ]) {
      expect(acdbSupportsWindowedDecode(encoding)).toBe(false)
    }
  })
})

describe('acdbMakeWindowedAsciiDxfPairReader', () => {
  beforeAll(() => {
    // Guard the hardcoded GBK fixture table against typos, using the
    // platform decoder as the reference for each individual character.
    const decoder = new TextDecoder('gbk')
    for (const [ch, bytes] of Object.entries(GBK_TABLE)) {
      expect(decoder.decode(Uint8Array.from(bytes))).toBe(ch)
    }
  })

  it('throws for encodings that are not line-safe', () => {
    expect(() =>
      acdbMakeWindowedAsciiDxfPairReader(new Uint8Array(), 'utf-16le')
    ).toThrow()
  })

  it('parses a GBK file identically to the full-decode reader', () => {
    const bytes = buildGbkDxf([
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$ACADVER',
      '1',
      'AC1032',
      '9',
      '$DWGCODEPAGE',
      '3',
      'ANSI_936',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '999',
      '中文注释',
      '0',
      'LINE',
      '5',
      '1A',
      '8',
      '图层',
      '10',
      '1.5',
      '20',
      '2.5',
      '30',
      '0',
      '11',
      '9.5',
      '21',
      '2.5',
      '31',
      '0',
      '0',
      'TEXT',
      '5',
      '1B',
      '8',
      '道路',
      '10',
      '0',
      '20',
      '0',
      '30',
      '0',
      '40',
      '1',
      '1',
      '测量标注',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ])
    expectPairParity(bytes, 'gbk')

    const text = new TextDecoder('gbk').decode(bytes)
    expect(text).toContain('测量标注')
    const pairs = collectPairs(
      acdbMakeWindowedAsciiDxfPairReader(bytes, 'gbk')
    )
    const textValue = pairs.find(p => p.code === 1 && p.value === '测量标注')
    expect(textValue).toBeDefined()
  })

  it('parses multi-window files (>128KiB) identically to the full-decode reader', () => {
    const lines: string[] = [
      '0',
      'SECTION',
      '2',
      'ENTITIES'
    ]
    const entityCount = 3000
    for (let i = 0; i < entityCount; i++) {
      lines.push(
        '0',
        'LINE',
        '5',
        i.toString(16).toUpperCase(),
        '8',
        i % 2 === 0 ? '图层' : '道路',
        '10',
        String(i),
        '20',
        '0',
        '30',
        '0',
        '11',
        String(i + 1),
        '21',
        '0',
        '31',
        '0'
      )
    }
    lines.push('0', 'ENDSEC', '0', 'EOF')
    const bytes = buildGbkDxf(lines)
    expect(bytes.length).toBeGreaterThan(128 * 1024)
    expectPairParity(bytes, 'gbk')
  })

  it('decodes a GBK pair straddling the raw 64KiB window cut correctly', () => {
    // The value line starts at byte offset 11 ('0\r\nTEXT\r\n' + '1\r\n').
    // Choose N so the lead byte of 中 lands exactly at byte 65536. The
    // window scan extends past the cut to the next line break, so the pair
    // must decode intact.
    const valueLineStart = 11
    const longText = 'A'.repeat(65536 - valueLineStart) + '中文'
    const lines = [
      '0',
      'TEXT',
      '1',
      longText,
      '8',
      '道路',
      '0',
      'LINE',
      '5',
      '2A',
      '8',
      '采区',
      '10',
      '0',
      '20',
      '0',
      '11',
      '1',
      '21',
      '0',
      '0',
      'EOF'
    ]
    const bytes = buildGbkDxf(lines)
    expectPairParity(bytes, 'gbk')

    const pairs = collectPairs(
      acdbMakeWindowedAsciiDxfPairReader(bytes, 'gbk')
    )
    const long = pairs.find(p => p.code === 1 && typeof p.value === 'string')
    expect(long?.value).toBe(longText)
  })

  it('keeps the UTF-8 wrapper behavior (BOM skip) intact', () => {
    const body = new TextEncoder().encode('0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nEOF\r\n')
    const bytes = new Uint8Array(3 + body.length)
    bytes.set([0xef, 0xbb, 0xbf])
    bytes.set(body, 3)
    expectPairParity(bytes, 'utf-8')
    expect(
      collectPairs(acdbMakeUtf8AsciiDxfPairReader(bytes))
    ).toEqual(
      collectPairs(acdbMakeWindowedAsciiDxfPairReader(bytes, 'utf-8'))
    )
  })

  it('matches the full-decode reader when the file ends mid-sequence', () => {
    // Trailing lone GBK lead byte: both readers emit U+FFFD and then end.
    const base = buildGbkDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'EOF'])
    const bytes = new Uint8Array(base.length + 1)
    bytes.set(base)
    bytes[base.length] = 0xd6
    expectPairParity(bytes, 'gbk')
  })

  it('acdbCreateDxfPairReader routes line-safe encodings to the windowed reader', () => {
    const bytes = buildGbkDxf([
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'LINE',
      '5',
      'AB',
      '8',
      '图层',
      '10',
      '1',
      '20',
      '2',
      '30',
      '0',
      '11',
      '3',
      '21',
      '4',
      '31',
      '0',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ])
    const viaFactory = collectPairs(
      acdbCreateDxfPairReader(bytes.buffer, { encoding: 'gbk' })
    )
    const windowed = collectPairs(
      acdbMakeWindowedAsciiDxfPairReader(bytes, 'gbk')
    )
    expect(viaFactory).toEqual(windowed)
  })
})
