import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {
  AcGeCircArc3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/data-model'

import { RTE_REBASE_THRESHOLD } from '../src/draw/AcTrBatchDrawPolicy'
import {
  buildFlatLineGeometryMulti,
  buildLineGeometry,
  buildLineGeometryMulti,
  type AcTrBuiltLineGeometry
} from '../src/object/AcTrLineGeometryBuilder'

const largeX = RTE_REBASE_THRESHOLD + 500_000

describe('buildLineGeometry', () => {
  it('returns null when fewer than two points are provided', () => {
    expect(buildLineGeometry([], new THREE.LineBasicMaterial())).toBeNull()
    expect(
      buildLineGeometry([{ x: 1, y: 2, z: 0 }], new THREE.LineBasicMaterial())
    ).toBeNull()
  })

  it('builds indexed basic geometry rebased to the bbox center', () => {
    const material = new THREE.LineBasicMaterial()
    const built = buildLineGeometry(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      material
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.kind).toBe('basic')
    expect(built.material).toBe(material)
    expect(built.worldOffset.x).toBeCloseTo(5)
    expect(built.worldOffset.y).toBeCloseTo(0)
    expect(built.geometry).toBeInstanceOf(THREE.BufferGeometry)

    const geometry = built.geometry as THREE.BufferGeometry
    expect(geometry.getIndex()).not.toBeNull()
    const position = geometry.getAttribute('position')
    expect(position.getX(0)).toBeCloseTo(-5)
    expect(position.getX(1)).toBeCloseTo(5)
    expect(built.wcsBbox.min.x).toBeCloseTo(0)
    expect(built.wcsBbox.max.x).toBeCloseTo(10)
  })

  it('builds fat LineSegmentsGeometry for LineMaterial', () => {
    const material = new LineMaterial({ color: 0xffffff, linewidth: 1 })
    const built = buildLineGeometry(
      [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 }
      ],
      material
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.kind).toBe('fat')
    expect(built.geometry).toBeInstanceOf(LineSegmentsGeometry)
    expect(built.worldOffset.x).toBeCloseTo(2)
    expect(built.wcsBbox.min.x).toBeCloseTo(0)
    expect(built.wcsBbox.max.x).toBeCloseTo(4)
    material.dispose()
  })

  it('keeps wcsBbox in world coordinates for large drawings', () => {
    const built = buildLineGeometry(
      [
        { x: largeX, y: 0, z: 0 },
        { x: largeX + 100, y: 0, z: 0 }
      ],
      new THREE.LineBasicMaterial()
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.wcsBbox.min.x).toBeCloseTo(largeX, 0)
    expect(built.wcsBbox.max.x).toBeCloseTo(largeX + 100, 0)
    expect(Math.abs(built.worldOffset.x - (largeX + 50))).toBeLessThan(1)
  })
})

/** Asserts two built-geometry arrays match bitwise on all observable data. */
function expectSameBuiltGeometry(
  actual: AcTrBuiltLineGeometry[],
  expected: AcTrBuiltLineGeometry[]
) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!
    const b = expected[i]!
    expect(a.kind).toBe(b.kind)
    expect(a.worldOffset.x).toBe(b.worldOffset.x)
    expect(a.worldOffset.y).toBe(b.worldOffset.y)
    expect(a.worldOffset.z).toBe(b.worldOffset.z)
    expect(a.wcsBbox.min.x).toBe(b.wcsBbox.min.x)
    expect(a.wcsBbox.min.y).toBe(b.wcsBbox.min.y)
    expect(a.wcsBbox.min.z).toBe(b.wcsBbox.min.z)
    expect(a.wcsBbox.max.x).toBe(b.wcsBbox.max.x)
    expect(a.wcsBbox.max.y).toBe(b.wcsBbox.max.y)
    expect(a.wcsBbox.max.z).toBe(b.wcsBbox.max.z)
    if (a.kind === 'fat') {
      continue
    }
    const ga = a.geometry as THREE.BufferGeometry
    const gb = b.geometry as THREE.BufferGeometry
    const pa = ga.getAttribute('position') as THREE.BufferAttribute
    const pb = gb.getAttribute('position') as THREE.BufferAttribute
    expect(pa.array).toEqual(pb.array)
    const ia = ga.getIndex() as THREE.BufferAttribute
    const ib = gb.getIndex() as THREE.BufferAttribute
    expect(ia.array).toEqual(ib.array)
  }
}

function makeCircle(radius: number): AcGeCircArc3d {
  return new AcGeCircArc3d(
    new AcGePoint3d(0, 0, 0),
    radius,
    0,
    Math.PI * 2,
    AcGeVector3d.Z_AXIS,
    AcGeVector3d.X_AXIS
  )
}

describe('buildFlatLineGeometryMulti', () => {
  it('matches the object pipeline for a precision-safe circle', () => {
    const arc = makeCircle(10)
    const material = new THREE.LineBasicMaterial()
    const fromFlat = buildFlatLineGeometryMulti(arc.getPointsFlat(100), material)
    const fromObjects = buildLineGeometryMulti(arc.getPoints(100), material)
    expectSameBuiltGeometry(fromFlat, fromObjects)
    expect(fromFlat.length).toBe(1)
    expect(fromFlat[0]!.kind).toBe('basic')
  })

  it('falls back and matches the object pipeline for a huge circle', () => {
    // Radius beyond RTE_REBASE_THRESHOLD forces rebase run splitting.
    const arc = makeCircle(largeX)
    const material = new THREE.LineBasicMaterial()
    const fromFlat = buildFlatLineGeometryMulti(arc.getPointsFlat(100), material)
    const fromObjects = buildLineGeometryMulti(arc.getPoints(100), material)
    expect(fromObjects.length).toBeGreaterThan(1)
    expectSameBuiltGeometry(fromFlat, fromObjects)
  })

  it('builds fat LineSegmentsGeometry from flat vertices', () => {
    const arc = makeCircle(10)
    const material = new LineMaterial({ color: 0xffffff, linewidth: 1 })
    const fromFlat = buildFlatLineGeometryMulti(arc.getPointsFlat(100), material)
    expect(fromFlat.length).toBe(1)
    expect(fromFlat[0]!.kind).toBe('fat')
    expect(fromFlat[0]!.geometry).toBeInstanceOf(LineSegmentsGeometry)
    material.dispose()
  })

  it('returns empty for fewer than two flat vertices', () => {
    const material = new THREE.LineBasicMaterial()
    expect(buildFlatLineGeometryMulti(new Float64Array(0), material)).toEqual([])
    expect(
      buildFlatLineGeometryMulti(new Float64Array([1, 2, 3]), material)
    ).toEqual([])
  })
})
