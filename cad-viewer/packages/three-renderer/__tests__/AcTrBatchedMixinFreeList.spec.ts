import { AcTrVertexBatchGeometryInfo } from '../src/batch/AcTrBatchedGeometryInfo'
import {
  createGeometryState,
  deleteGeometryById,
  popAvailableGeometryId,
  pushAvailableGeometryId,
  reserveGeometryId
} from '../src/batch/AcTrBatchedMixin'

function createInfo(
  overrides: Partial<AcTrVertexBatchGeometryInfo> = {}
): AcTrVertexBatchGeometryInfo {
  return {
    vertexStart: 0,
    vertexCount: -1,
    reservedVertexCount: 0,
    ...createGeometryState(),
    ...overrides
  }
}

describe('available geometry id free-list (binary min-heap)', () => {
  it('pops ids in ascending order regardless of push order', () => {
    const heap: number[] = []
    for (const id of [7, 2, 9, 1, 5, 2]) {
      pushAvailableGeometryId(heap, id)
    }

    const popped: number[] = []
    while (heap.length > 0) {
      popped.push(popAvailableGeometryId(heap))
    }

    expect(popped).toEqual([1, 2, 2, 5, 7, 9])
  })

  it('interleaves push and pop without losing order', () => {
    const heap: number[] = []
    pushAvailableGeometryId(heap, 5)
    pushAvailableGeometryId(heap, 2)
    expect(popAvailableGeometryId(heap)).toBe(2)

    pushAvailableGeometryId(heap, 0)
    pushAvailableGeometryId(heap, 4)
    expect(popAvailableGeometryId(heap)).toBe(0)
    expect(popAvailableGeometryId(heap)).toBe(4)
    expect(popAvailableGeometryId(heap)).toBe(5)
    expect(heap.length).toBe(0)
  })

  it('handles a single freed id', () => {
    const heap: number[] = []
    pushAvailableGeometryId(heap, 42)
    expect(popAvailableGeometryId(heap)).toBe(42)
    expect(heap.length).toBe(0)
  })

  it('matches sorted order on a large randomized workload', () => {
    const heap: number[] = []
    // Deterministic pseudo-random stream so the test is reproducible.
    let seed = 123456789
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    const pushed: number[] = []
    for (let i = 0; i < 1000; i++) {
      const id = next() % 1000
      pushed.push(id)
      pushAvailableGeometryId(heap, id)
    }

    const expected = [...pushed].sort((a, b) => a - b)
    const popped: number[] = []
    while (heap.length > 0) {
      popped.push(popAvailableGeometryId(heap))
    }
    expect(popped).toEqual(expected)
  })

  it('reserveGeometryId reuses deleted ids with the smallest id first', () => {
    const available: number[] = []
    const infos: AcTrVertexBatchGeometryInfo[] = [
      createInfo(),
      createInfo(),
      createInfo()
    ]

    expect(deleteGeometryById(1, infos, available)).toBe(true)
    expect(deleteGeometryById(0, infos, available)).toBe(true)

    const first = reserveGeometryId(available, infos, 3, createInfo())
    expect(first.geometryId).toBe(0)
    expect(first.geometryCount).toBe(3)

    const second = reserveGeometryId(available, infos, 3, createInfo())
    expect(second.geometryId).toBe(1)
    expect(second.geometryCount).toBe(3)
    expect(available.length).toBe(0)
  })

  it('appends a fresh id when the free-list is empty', () => {
    const available: number[] = []
    const infos: AcTrVertexBatchGeometryInfo[] = [createInfo()]

    const result = reserveGeometryId(available, infos, 1, createInfo())
    expect(result.geometryId).toBe(1)
    expect(result.geometryCount).toBe(2)
    expect(infos.length).toBe(2)
  })
})
