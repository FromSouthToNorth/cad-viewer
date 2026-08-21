import type { AcDbDxfPair } from '../src/base/AcDbDxfPair'
import { acdbCreateDxfPairReader } from '../src/base/AcDbDxfPairReader'
import {
  acdbDrainDxfPairs,
  acdbDxfPairWireTransferables,
  acdbMakeDxfPairArrayReader
} from '../src/base/AcDbDxfPairWire'

/**
 * Reads all remaining pairs from a reader into an array for comparison.
 */
function readAll(reader: {
  next(): AcDbDxfPair | undefined
}): AcDbDxfPair[] {
  const pairs: AcDbDxfPair[] = []
  for (;;) {
    const pair = reader.next()
    if (!pair) break
    pairs.push(pair)
  }
  return pairs
}

function expectPairEqual(actual: AcDbDxfPair, expected: AcDbDxfPair) {
  expect(actual.code).toBe(expected.code)
  expect(actual.type).toBe(expected.type)
  if (expected.type === 'binary') {
    const actualBytes = (actual as { value: Uint8Array }).value
    expect(Array.from(actualBytes)).toEqual(Array.from(expected.value))
  } else {
    expect(actual.value).toEqual(expected.value)
  }
}

function expectSamePairStream(actual: AcDbDxfPair[], expected: AcDbDxfPair[]) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expectPairEqual(actual[i]!, expected[i]!)
  }
}

const SAMPLE_DXF = [
  '0',
  'SECTION',
  '2',
  'HEADER',
  '9',
  '$ACADVER',
  '1',
  'AC1021',
  '0',
  'ENDSEC',
  '0',
  'SECTION',
  '2',
  'TABLES',
  '0',
  'TABLE',
  '2',
  'LAYER',
  '0',
  'LAYER',
  '2',
  'Walls',
  '70',
  '0',
  '62',
  '7',
  '6',
  'CONTINUOUS',
  '0',
  'ENDTAB',
  '0',
  'ENDSEC',
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '5',
  '2F',
  '330',
  '1F',
  '100',
  'AcDbEntity',
  '8',
  'Walls',
  '62',
  '256',
  '100',
  'AcDbLine',
  '10',
  '1.5',
  '20',
  '-2.25',
  '30',
  '0.0',
  '11',
  '1000.75',
  '21',
  '2000.125',
  '31',
  '0.0',
  '0',
  'LWPOLYLINE',
  '5',
  '30',
  '100',
  'AcDbEntity',
  '8',
  'Walls',
  '100',
  'AcDbPolyline',
  '90',
  '3',
  '70',
  '1',
  '10',
  '0.0',
  '20',
  '0.0',
  '10',
  '10.5',
  '20',
  '0.0',
  '10',
  '10.5',
  '20',
  '10.5',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  ''
].join('\n')

describe('AcDbDxfPairWire', () => {
  it('round-trips an ASCII pair stream losslessly', () => {
    const direct = readAll(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    expect(direct.length).toBeGreaterThan(0)

    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    expect(wire.kind).toBe('ascii')
    expect(wire.count).toBe(direct.length)

    const replayed = readAll(acdbMakeDxfPairArrayReader(wire))
    expectSamePairStream(replayed, direct)
  })

  it('deduplicates repeated strings in the string table', () => {
    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    // 'Walls' and 'AcDbEntity' repeat many times in the sample but appear once.
    const walls = wire.strings.filter(s => s === 'Walls')
    expect(walls.length).toBe(1)
    expect(new Set(wire.strings).size).toBe(wire.strings.length)
  })

  it('preserves peek semantics on the array reader', () => {
    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    const reader = acdbMakeDxfPairArrayReader(wire)

    const first = reader.peek()
    expect(first).toBeDefined()
    // Peeking twice must not advance.
    expect(reader.peek()).toBe(first)
    // next() returns the lookahead pair, then advances.
    expect(reader.next()).toBe(first)
    const second = reader.next()
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    expect(second!.code).toBe(2)
    expect(second!.value).toBe('HEADER')
  })

  it('reports consumed pair index through position()', () => {
    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    const reader = acdbMakeDxfPairArrayReader(wire)
    expect(reader.position().byteOffset).toBe(0)
    reader.next()
    expect(reader.position().byteOffset).toBe(1)
    reader.peek()
    // Peek materializes the pair; the consumed index includes the lookahead.
    expect(reader.position().byteOffset).toBe(2)
  })

  it('reports monotonic drain progress ending at 1', () => {
    const ratios: number[] = []
    const bytes = new TextEncoder().encode(SAMPLE_DXF).buffer
    acdbDrainDxfPairs(acdbCreateDxfPairReader(bytes), {
      totalBytes: bytes.byteLength,
      onProgress: ratio => ratios.push(ratio)
    })
    expect(ratios.length).toBeGreaterThan(0)
    expect(ratios[ratios.length - 1]).toBe(1)
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]!).toBeGreaterThanOrEqual(ratios[i - 1]!)
    }
  })

  it('handles streams larger than the initial capacity estimate', () => {
    // ~4k vertices force the SoA arrays to grow several times.
    const parts = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4000']
    for (let i = 0; i < 4000; i++) {
      parts.push('10', String(i * 1.25), '20', String(-i * 0.5))
    }
    parts.push('0', 'ENDSEC', '0', 'EOF', '')
    const dxf = parts.join('\n')
    const bytes = new TextEncoder().encode(dxf).buffer

    const direct = readAll(acdbCreateDxfPairReader(bytes))
    const wire = acdbDrainDxfPairs(acdbCreateDxfPairReader(bytes), {
      // Deliberately tiny estimate to exercise the growth path.
      totalBytes: 1
    })
    const replayed = readAll(acdbMakeDxfPairArrayReader(wire))
    expectSamePairStream(replayed, direct)
  })

  it('round-trips bigint long values and binary chunks', () => {
    // Hand-built binary DXF: magic + a few pairs incl. int64 > 2^53 and 310.
    const magic = new TextEncoder().encode('AutoCAD Binary DXF\r\n')
    const chunks: number[] = []
    for (const b of magic) chunks.push(b)
    chunks.push(0x1a, 0x00)

    const pushString = (code: number, value: string) => {
      chunks.push(code & 0xff, (code >> 8) & 0xff)
      for (const b of new TextEncoder().encode(value)) chunks.push(b)
      chunks.push(0)
    }
    const pushI64 = (code: number, value: bigint) => {
      chunks.push(code & 0xff, (code >> 8) & 0xff)
      const buf = new Uint8Array(8)
      new DataView(buf.buffer).setBigInt64(0, value, true)
      for (const b of buf) chunks.push(b)
    }
    const pushBinary = (code: number, value: Uint8Array) => {
      chunks.push(code & 0xff, (code >> 8) & 0xff)
      chunks.push(value.length)
      for (const b of value) chunks.push(b)
    }

    pushString(0, 'SECTION')
    pushString(2, 'OBJECTS')
    pushI64(160, BigInt('9007199254740993')) // 2^53 + 1 → bigint
    pushI64(161, BigInt(42)) // safe integer → number
    pushBinary(310, Uint8Array.of(1, 2, 3, 250))
    pushString(0, 'ENDSEC')
    pushString(0, 'EOF')

    const bytes = new Uint8Array(chunks).buffer
    const direct = readAll(acdbCreateDxfPairReader(bytes))
    expect(direct.some(p => p.type === 'long' && typeof p.value === 'bigint')).toBe(
      true
    )

    const wire = acdbDrainDxfPairs(acdbCreateDxfPairReader(bytes))
    expect(wire.kind).toBe('binary')
    const replayed = readAll(acdbMakeDxfPairArrayReader(wire))
    expectSamePairStream(replayed, direct)
  })

  it('lists every backing buffer as transferable', () => {
    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new TextEncoder().encode(SAMPLE_DXF).buffer)
    )
    const transferables = acdbDxfPairWireTransferables(wire)
    expect(transferables).toContain(wire.codes.buffer)
    expect(transferables).toContain(wire.types.buffer)
    expect(transferables).toContain(wire.numbers.buffer)
    expect(transferables).toContain(wire.stringIndices.buffer)
  })

  it('handles an empty input stream', () => {
    const wire = acdbDrainDxfPairs(
      acdbCreateDxfPairReader(new ArrayBuffer(0))
    )
    expect(wire.count).toBe(0)
    const reader = acdbMakeDxfPairArrayReader(wire)
    expect(reader.peek()).toBeUndefined()
    expect(reader.next()).toBeUndefined()
  })
})
