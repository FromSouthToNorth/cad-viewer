import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

import {
  buildLineGeometry,
  buildLineGeometryMulti,
  buildLineSegmentsGeometryMulti,
  splitLineSegmentsClusters,
  subdivideLongSteps
} from '../src/object/AcTrLineGeometryBuilder'

/**
 * Magnitude of the Gauss-Krüger projected coordinates in the target drawing.
 * Entities that individually span most of the map must not keep ±1-2-unit
 * float32 quantization at their far vertices after the center rebase.
 */
const BASE = 39_652_926.8

/** Max local vertex magnitude expected after run splitting (≤ 1e6). */
const MAX_LOCAL_EXTENT = 1_000_000

function reconstructedPositions(geometry: THREE.BufferGeometry, worldOffset: THREE.Vector3) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const out: Array<{ x: number; y: number; z: number }> = []
  for (let i = 0; i < position.count; i++) {
    out.push({
      x: position.getX(i) + worldOffset.x,
      y: position.getY(i) + worldOffset.y,
      z: position.getZ(i) + worldOffset.z
    })
  }
  return out
}

describe('spanning entity run splitting (origin-shift gap fix)', () => {
  const material = new THREE.LineBasicMaterial()

  it('splits a polyline spanning the full map into small rebased runs', () => {
    const points = [
      { x: BASE - 19_700_000.3, y: BASE, z: 0 },
      { x: BASE - 9_850_000.7, y: BASE + 0.7, z: 0 },
      { x: BASE + 9_850_000.3, y: BASE - 0.3, z: 0 },
      { x: BASE + 19_700_000.7, y: BASE + 0.7, z: 0 }
    ]
    const built = buildLineGeometryMulti(points, material)
    expect(built.length).toBeGreaterThan(1)

    let vertexCount = 0
    for (const item of built) {
      const positions = item.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < positions.count; i++) {
        expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(MAX_LOCAL_EXTENT)
        expect(Math.abs(positions.getY(i))).toBeLessThanOrEqual(MAX_LOCAL_EXTENT)
      }
      vertexCount += positions.count
    }
    // Every original vertex (plus shared run boundary points) is present.
    expect(vertexCount).toBeGreaterThanOrEqual(points.length)
  })

  it('keeps far-end vertices accurate for a spanning polyline', () => {
    const points = [
      { x: BASE - 19_700_000.3, y: BASE + 0.7, z: 0 },
      { x: BASE - 10_000_000.9, y: BASE, z: 0 },
      { x: BASE, y: BASE + 0.3, z: 0 },
      { x: BASE + 10_000_000.1, y: BASE, z: 0 },
      { x: BASE + 19_700_000.7, y: BASE - 0.7, z: 0 }
    ]
    const built = buildLineGeometryMulti(points, material)
    expect(built.length).toBeGreaterThan(1)

    // Reconstruct every stored vertex and require it to sit on the polyline
    // within a small tolerance — no ±1-2 unit quantization at the far ends.
    const tolerance = 0.1
    for (const item of built) {
      const rec = reconstructedPositions(
        item.geometry as THREE.BufferGeometry,
        item.worldOffset
      )
      for (const vertex of rec) {
        let minDistance = Infinity
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]
          const b = points[i]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const t =
            dx !== 0 || dy !== 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((vertex.x - a.x) * dx + (vertex.y - a.y) * dy) /
                      (dx * dx + dy * dy)
                  )
                )
              : 0
          const px = a.x + dx * t
          const py = a.y + dy * t
          minDistance = Math.min(
            minDistance,
            Math.hypot(vertex.x - px, vertex.y - py)
          )
        }
        expect(minDistance).toBeLessThanOrEqual(tolerance)
      }
    }
  })

  it('subdivides one huge single segment into precision-safe steps', () => {
    const points = [
      { x: BASE - 19_700_000.5, y: BASE, z: 0 },
      { x: BASE + 19_700_000.5, y: BASE, z: 0 }
    ]
    const built = buildLineGeometryMulti(points, material)
    expect(built.length).toBeGreaterThan(1)
    for (const item of built) {
      const positions = item.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 1; i < positions.count; i++) {
        const step = Math.max(
          Math.abs(positions.getX(i) - positions.getX(i - 1)),
          Math.abs(positions.getY(i) - positions.getY(i - 1))
        )
        expect(step).toBeLessThanOrEqual(500_000)
      }
    }
  })

  it('keeps consecutive runs connected through the shared boundary vertex', () => {
    const points = [
      { x: BASE - 19_700_000.3, y: BASE, z: 0 },
      { x: BASE, y: BASE, z: 0 },
      { x: BASE + 19_700_000.7, y: BASE, z: 0 }
    ]
    const built = buildLineGeometryMulti(points, material)
    expect(built.length).toBeGreaterThan(1)
    for (let r = 1; r < built.length; r++) {
      const prev = reconstructedPositions(
        built[r - 1].geometry as THREE.BufferGeometry,
        built[r - 1].worldOffset
      )
      const next = reconstructedPositions(
        built[r].geometry as THREE.BufferGeometry,
        built[r].worldOffset
      )
      const prevTail = prev[prev.length - 1]
      const nextHead = next[0]
      expect(
        Math.hypot(prevTail.x - nextHead.x, prevTail.y - nextHead.y)
      ).toBeLessThan(0.1)
    }
  })

  it('leaves small entities untouched (single run, sub-ulp precision)', () => {
    const points = [
      { x: BASE + 0.3, y: BASE + 0.7, z: 0 },
      { x: BASE + 10.3, y: BASE + 4.7, z: 0 }
    ]
    const multi = buildLineGeometryMulti(points, material)
    expect(multi.length).toBe(1)
    const single = buildLineGeometry(points, material)
    expect(single).not.toBeNull()
    const rec = reconstructedPositions(
      single!.geometry as THREE.BufferGeometry,
      single!.worldOffset
    )
    expect(Math.abs(rec[1].x - points[1].x)).toBeLessThan(0.001)
    expect(Math.abs(rec[1].y - points[1].y)).toBeLessThan(0.001)
  })

  it('splits far-apart face line segments into separate precision-safe clusters', () => {
    // Two segment pairs at opposite ends of the map (mimics two distant faces).
    const array = new Float64Array([
      BASE - 19_700_000.3, BASE, 0,
      BASE - 19_700_000.3 + 2.7, BASE + 1.3, 0,
      BASE + 19_700_000.7, BASE, 0,
      BASE + 19_700_000.7 - 1.3, BASE + 2.7, 0
    ])
    const indices = new Uint16Array([0, 1, 2, 3])
    const built = buildLineSegmentsGeometryMulti(
      array,
      3,
      indices,
      material
    )
    expect(built.length).toBe(2)
    for (const item of built) {
      const positions = item.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < positions.count; i++) {
        expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(MAX_LOCAL_EXTENT)
      }
    }
  })

  it('subdivides a long segment inside the cluster splitter', () => {
    const array = new Float64Array([
      BASE - 19_700_000.5, BASE, 0,
      BASE + 19_700_000.5, BASE, 0
    ])
    const indices = new Uint16Array([0, 1])
    const clusters = splitLineSegmentsClusters(array, 3, indices)
    expect(clusters.length).toBeGreaterThan(1)
    for (const cluster of clusters) {
      for (let s = 0; s < cluster.indices.length; s += 2) {
        const b1 = cluster.indices[s] * 3
        const b2 = cluster.indices[s + 1] * 3
        const step = Math.max(
          Math.abs(cluster.array[b1] - cluster.array[b2]),
          Math.abs(cluster.array[b1 + 1] - cluster.array[b2 + 1])
        )
        expect(step).toBeLessThanOrEqual(500_000)
      }
    }
  })

  it('subdivideLongSteps keeps the original sequence endpoints', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 3_000_000.5, y: 0, z: 0 }
    ]
    const subdivided = subdivideLongSteps(points)
    expect(subdivided.length).toBeGreaterThan(2)
    expect(subdivided[0]).toEqual(points[0])
    expect(subdivided[subdivided.length - 1]).toEqual(points[1])
    for (let i = 1; i < subdivided.length; i++) {
      expect(Math.abs(subdivided[i].x - subdivided[i - 1].x)).toBeLessThanOrEqual(500_000)
    }
  })

  it('still supports fat LineMaterial output for every run', () => {
    const lineMaterial = new LineMaterial()
    const points = [
      { x: BASE - 19_700_000.3, y: BASE, z: 0 },
      { x: BASE, y: BASE, z: 0 },
      { x: BASE + 19_700_000.7, y: BASE, z: 0 }
    ]
    const built = buildLineGeometryMulti(points, lineMaterial)
    expect(built.length).toBeGreaterThan(1)
    for (const item of built) {
      expect(item.kind).toBe('fat')
      expect(item.worldOffset.x).toBeGreaterThan(0)
    }
  })
})
