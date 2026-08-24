import type { AcDbDxfPair } from './AcDbDxfPair'
import type { AcDbDxfPairReader } from './AcDbDxfPairReader'

/**
 * Numeric tags for {@link AcDbDxfPair} `type` in the wire format.
 * Comment pairs never reach the wire — pair readers filter them.
 */
const enum AcDbDxfPairWireType {
  String = 0,
  Int = 1,
  Double = 2,
  Long = 3,
  Bool = 4,
  Handle = 5,
  Binary = 6
}

const WIRE_TYPE_BY_PAIR_TYPE: Record<
  AcDbDxfPair['type'],
  AcDbDxfPairWireType
> = {
  string: AcDbDxfPairWireType.String,
  int: AcDbDxfPairWireType.Int,
  double: AcDbDxfPairWireType.Double,
  long: AcDbDxfPairWireType.Long,
  bool: AcDbDxfPairWireType.Bool,
  handle: AcDbDxfPairWireType.Handle,
  binary: AcDbDxfPairWireType.Binary
}

/**
 * Struct-of-arrays form of a drained DXF pair stream.
 *
 * Designed for cheap `postMessage` between the parser worker and the main
 * thread: typed arrays transfer zero-copy, strings pass through one
 * deduplicated table (DXF repeats subclass markers / layer names heavily),
 * and rare `long`/`binary` values ride in side arrays so the common numeric
 * path stays flat.
 */
export interface AcDbDxfPairWireData {
  /** Source format of the drained stream. */
  kind: 'ascii' | 'binary'
  /** Number of pairs (length of {@link codes} / {@link types}). */
  count: number
  /** Group code per pair. */
  codes: Int32Array
  /** {@link AcDbDxfPairWireType} tag per pair. */
  types: Uint8Array
  /** `int` / `double` / `bool` (0|1) values, in pair order. */
  numbers: Float64Array
  /**
   * `long` values as decimal strings, in pair order. Strings keep bigint
   * values exact across the wire; decode restores number vs bigint by the
   * same safe-integer rule the source readers use.
   */
  longs: string[]
  /** Deduplicated table for `string` / `handle` values. */
  strings: string[]
  /** Index into {@link strings} per string/handle-typed pair, in pair order. */
  stringIndices: Int32Array
  /** `binary` values, in pair order. */
  binaries: Uint8Array[]
}

export interface AcDbDxfPairDrainOptions {
  /**
   * Total source byte length; enables {@link onProgress} ratios derived from
   * the reader's byte offset.
   */
  totalBytes?: number
  /** Called with completion in `[0, 1]`; fires at most ~50 times per drain. */
  onProgress?: (ratio: number) => void
}

function growI32(arr: Int32Array, needed: number): Int32Array {
  if (needed <= arr.length) return arr
  const next = new Int32Array(Math.max(needed, arr.length * 2))
  next.set(arr)
  return next
}

function growU8(arr: Uint8Array, needed: number): Uint8Array {
  if (needed <= arr.length) return arr
  const next = new Uint8Array(Math.max(needed, arr.length * 2))
  next.set(arr)
  return next
}

function growF64(arr: Float64Array, needed: number): Float64Array {
  if (needed <= arr.length) return arr
  const next = new Float64Array(Math.max(needed, arr.length * 2))
  next.set(arr)
  return next
}

/**
 * Shrinks a drained array to its used length without copying when the
 * unused slack is small. The arrays cross `postMessage` as their full
 * backing buffer anyway (see {@link acdbDxfPairWireTransferables}), so an
 * exact-size copy is pure peak-memory overhead unless the overshoot is
 * substantial.
 */
const MAX_TRIM_SLACK_RATIO = 1.25

function trimToCount<T extends Int32Array | Uint8Array | Float64Array>(
  arr: T,
  count: number
): T {
  if (arr.length <= count * MAX_TRIM_SLACK_RATIO) {
    return arr.subarray(0, count) as T
  }
  return arr.slice(0, count) as T
}

/**
 * Drains a streaming {@link AcDbDxfPairReader} into transferable
 * {@link AcDbDxfPairWireData}. Runs inside the parser worker; the result is
 * meant to be posted back with {@link acdbDxfPairWireTransferables}.
 */
export function acdbDrainDxfPairs(
  reader: AcDbDxfPairReader,
  options: AcDbDxfPairDrainOptions = {}
): AcDbDxfPairWireData {
  const totalBytes = options.totalBytes ?? 0
  const onProgress = options.onProgress
  // Average ASCII DXF pair ≈ 12 source bytes ("  10\n1.234\n"); the estimate
  // only seeds capacity — arrays still grow on demand.
  const estimated =
    totalBytes > 0
      ? Math.min(8 * 1024 * 1024, Math.max(1024, Math.ceil(totalBytes / 12)))
      : 4096

  let codes = new Int32Array(estimated)
  let types = new Uint8Array(estimated)
  let numbers = new Float64Array(Math.ceil(estimated / 2))
  let stringIndices = new Int32Array(Math.ceil(estimated / 4))
  let count = 0
  let numberCount = 0
  let stringValueCount = 0
  const strings: string[] = []
  const stringIds = new Map<string, number>()
  const longs: string[] = []
  const binaries: Uint8Array[] = []

  // Progress posts hop threads; cap them at ~2% steps so messaging never
  // shows up in the tokenize hot path.
  let lastReported = -0.02

  for (;;) {
    const pair = reader.next()
    if (!pair) break

    codes = growI32(codes, count + 1)
    types = growU8(types, count + 1)
    codes[count] = pair.code
    types[count] = WIRE_TYPE_BY_PAIR_TYPE[pair.type]
    count++

    switch (pair.type) {
      case 'int':
      case 'double':
        numbers = growF64(numbers, numberCount + 1)
        numbers[numberCount++] = pair.value
        break
      case 'bool':
        numbers = growF64(numbers, numberCount + 1)
        numbers[numberCount++] = pair.value ? 1 : 0
        break
      case 'long':
        longs.push(String(pair.value))
        break
      case 'string':
      case 'handle': {
        let id = stringIds.get(pair.value)
        if (id === undefined) {
          id = strings.length
          strings.push(pair.value)
          stringIds.set(pair.value, id)
        }
        stringIndices = growI32(stringIndices, stringValueCount + 1)
        stringIndices[stringValueCount++] = id
        break
      }
      case 'binary':
        binaries.push(pair.value)
        break
    }

    if (onProgress && totalBytes > 0) {
      const ratio = Math.min(1, reader.position().byteOffset / totalBytes)
      if (ratio - lastReported >= 0.02) {
        lastReported = ratio
        onProgress(ratio)
      }
    }
  }

  if (onProgress && totalBytes > 0 && lastReported < 1) {
    onProgress(1)
  }

  return {
    kind: reader.kind,
    count,
    codes: trimToCount(codes, count),
    types: trimToCount(types, count),
    numbers: trimToCount(numbers, numberCount),
    longs,
    strings,
    stringIndices: trimToCount(stringIndices, stringValueCount),
    binaries
  }
}

/**
 * Buffers to list as `postMessage` transferables so the wire arrays move to
 * the main thread zero-copy.
 */
export function acdbDxfPairWireTransferables(
  data: AcDbDxfPairWireData
): Transferable[] {
  const transferables: Transferable[] = [
    data.codes.buffer as ArrayBuffer,
    data.types.buffer as ArrayBuffer,
    data.numbers.buffer as ArrayBuffer,
    data.stringIndices.buffer as ArrayBuffer
  ]
  for (const binary of data.binaries) {
    transferables.push(binary.buffer as ArrayBuffer)
  }
  return transferables
}

/**
 * Rebuilds an {@link AcDbDxfPairReader} over drained wire data.
 *
 * Sequential access only (like every pair reader): value cursors advance as
 * pairs materialize, and `peek` caches its lookahead. `position().byteOffset`
 * reports the consumed **pair index**, not a source byte offset — callers
 * wanting parse progress should divide by {@link AcDbDxfPairWireData.count}.
 */
export function acdbMakeDxfPairArrayReader(
  data: AcDbDxfPairWireData
): AcDbDxfPairReader {
  let index = 0
  let numberCursor = 0
  let longCursor = 0
  let stringCursor = 0
  let binaryCursor = 0
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  const { count, codes, types, numbers, longs, strings, stringIndices } = data
  const binaries = data.binaries

  function readRaw(): AcDbDxfPair | undefined {
    if (index >= count) return undefined
    const code = codes[index]!
    const type = types[index]!
    index++

    switch (type) {
      case AcDbDxfPairWireType.String:
        return {
          code,
          type: 'string',
          value: strings[stringIndices[stringCursor++]!]!
        }
      case AcDbDxfPairWireType.Handle:
        return {
          code,
          type: 'handle',
          value: strings[stringIndices[stringCursor++]!]!
        }
      case AcDbDxfPairWireType.Int:
        return { code, type: 'int', value: numbers[numberCursor++]! }
      case AcDbDxfPairWireType.Double:
        return { code, type: 'double', value: numbers[numberCursor++]! }
      case AcDbDxfPairWireType.Bool:
        return { code, type: 'bool', value: numbers[numberCursor++] !== 0 }
      case AcDbDxfPairWireType.Long: {
        const raw = longs[longCursor++]!
        const n = Number(raw)
        return Number.isSafeInteger(n)
          ? { code, type: 'long', value: n }
          : { code, type: 'long', value: BigInt(raw) }
      }
      case AcDbDxfPairWireType.Binary:
        return { code, type: 'binary', value: binaries[binaryCursor++]! }
      default:
        return readRaw()
    }
  }

  return {
    kind: data.kind,
    next() {
      if (lookaheadValid) {
        const pair = lookahead
        lookahead = undefined
        lookaheadValid = false
        return pair
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
      return { byteOffset: index }
    }
  }
}
