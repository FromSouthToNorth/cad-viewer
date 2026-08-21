import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { AcTrBatchedLine } from '../src/batch/AcTrBatchedLine'
import { AcTrBatchedLine2 } from '../src/batch/AcTrBatchedLine2'
import { AcTrBatchedMesh } from '../src/batch/AcTrBatchedMesh'
import { AcTrBatchedPoint } from '../src/batch/AcTrBatchedPoint'
import type { AcTrIndexedBatchGeometryInfo } from '../src/batch/AcTrBatchedGeometryInfo'
import {
  acTrIsBatchFrustumCullingEnabled,
  acTrSetBatchFrustumCullingEnabled,
  createAcTrBatchedMixin
} from '../src/batch/AcTrBatchedMixin'

function createLineGeometry(
  start: [number, number, number],
  end: [number, number, number]
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([...start, ...end], 3)
  )
  geometry.setIndex([0, 1])
  return geometry
}

function createTriangleGeometry(
  size: [number, number] = [4, 3]
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, size[0], 0, 0, 0, size[1], 0], 3)
  )
  geometry.setIndex([0, 1, 2])
  return geometry
}

function createPointGeometry(points: Array<[number, number, number]>) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points.flat(), 3)
  )
  return geometry
}

/**
 * Ortho frustum for a camera looking at `center` from above (z = 1000),
 * half-extent `size` in world units.
 */
function frustumAt(
  center: { x: number; y: number },
  size: number
): THREE.Frustum {
  const camera = new THREE.OrthographicCamera(-size, size, size, -size, 0.1, 2000)
  camera.position.set(center.x, center.y, 1000)
  camera.lookAt(center.x, center.y, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  const matrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  )
  return new THREE.Frustum().setFromProjectionMatrix(matrix)
}

describe('batched frustum culling', () => {
  afterEach(() => {
    acTrSetBatchFrustumCullingEnabled(true)
  })

  it('starts unculled, syncs a local-space sphere, then enables culling', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    expect(batch.frustumCulled).toBe(false)

    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    expect(batch.frustumCulled).toBe(false)

    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(true)
    expect(batch.geometry.boundingSphere).not.toBeNull()
    // First line rebases to [-5..5] around the batch origin: radius >= 5.
    expect(batch.geometry.boundingSphere!.radius).toBeGreaterThanOrEqual(5)
    // Batch origin lands at the geometry center.
    expect(batch.position.x).toBeCloseTo(5, 10)
  })

  it('marks dirty on append and covers the new slot after the next sync', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    batch.syncFrustumBounds()
    const firstRadius = batch.geometry.boundingSphere!.radius

    // A far offset grows the aggregate sphere (rebased against the origin).
    batch.addGeometry(
      createLineGeometry([100, 0, 0], [110, 0, 0]),
      -1,
      -1,
      new THREE.Vector3()
    )
    expect(batch.frustumCulled).toBe(false)

    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(true)
    expect(batch.geometry.boundingSphere!.radius).toBeGreaterThan(firstRadius)
  })

  it('invalidates cached slot bounds when a slot is rewritten', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    const id = batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    batch.syncFrustumBounds()
    const firstRadius = batch.geometry.boundingSphere!.radius

    batch.setGeometryAt(id, createLineGeometry([0, 0, 0], [50, 0, 0]))
    expect(batch.frustumCulled).toBe(false)

    batch.syncFrustumBounds()
    expect(batch.geometry.boundingSphere!.radius).toBeGreaterThan(firstRadius)
  })

  it('culls against an ortho frustum at large world coordinates', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(
      createLineGeometry(
        [39652926, 39458238, 0],
        [39652936, 39458238, 0]
      )
    )
    batch.syncFrustumBounds()
    batch.updateMatrixWorld(true)

    const near = frustumAt({ x: 39652931, y: 39458238 }, 50)
    expect(near.intersectsObject(batch)).toBe(true)

    const far = frustumAt({ x: 0, y: 0 }, 50)
    expect(far.intersectsObject(batch)).toBe(false)
  })

  it('assigns an explicit sphere to Line2 batches (dummy position attribute)', () => {
    const batch = new AcTrBatchedLine2(100, new LineMaterial())
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions([0, 0, 0, 10, 0, 0])
    batch.addGeometry(geometry)
    batch.syncFrustumBounds()

    expect(batch.frustumCulled).toBe(true)
    const sphere = batch.geometry.boundingSphere
    expect(sphere).not.toBeNull()
    expect(sphere!.radius).toBeGreaterThanOrEqual(5)
    expect(sphere!.radius).toBeLessThan(20)
  })

  it('chains the base class prototype onBeforeRender hook', () => {
    // Production Line2 batches chain LineSegments2.prototype.onBeforeRender
    // (LineMaterial resolution refresh); jest maps that class to a mock, so
    // validate the chaining mechanics against a synthetic base with a hook.
    class HookedMesh extends THREE.Mesh {
      hookCalls = 0
      onBeforeRender() {
        this.hookCalls++
      }
    }

    const HookedBatchBase = createAcTrBatchedMixin<AcTrIndexedBatchGeometryInfo>(
      HookedMesh,
      {
        typeName: 'HookedBatch',
        createObject: () => new THREE.Mesh(new THREE.BufferGeometry()),
        getDrawRange: (_instance, info) => ({
          start: info.indexStart,
          count: info.indexCount
        })
      }
    )
    class HookedBatch extends HookedBatchBase {}

    const batch = new HookedBatch(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    )
    batch.onBeforeRender(
      null as unknown as THREE.WebGLRenderer,
      null as unknown as THREE.Scene,
      null as unknown as THREE.Camera,
      batch.geometry,
      new THREE.MeshBasicMaterial(),
      new THREE.Group()
    )

    expect((batch as unknown as HookedMesh).hookCalls).toBe(1)
    expect(batch.frustumCulled).toBe(true)
  })

  it('syncs mesh and point batches too', () => {
    const mesh = new AcTrBatchedMesh(
      1000,
      2000,
      new THREE.MeshBasicMaterial()
    )
    mesh.addGeometry(createTriangleGeometry())
    mesh.syncFrustumBounds()
    expect(mesh.frustumCulled).toBe(true)
    expect(mesh.geometry.boundingSphere!.radius).toBeGreaterThanOrEqual(2.5)

    const points = new AcTrBatchedPoint(1000, new THREE.PointsMaterial())
    points.addGeometry(createPointGeometry([[0, 0, 0], [3, 4, 0]]))
    points.syncFrustumBounds()
    expect(points.frustumCulled).toBe(true)
    expect(points.geometry.boundingSphere!.radius).toBeGreaterThanOrEqual(2.5)
  })

  it('stays conservative when a slot is hidden', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    const id = batch.addGeometry(
      createLineGeometry([1000, 0, 0], [1010, 0, 0]),
      -1,
      -1,
      new THREE.Vector3()
    )
    batch.syncFrustumBounds()
    const radiusBefore = batch.geometry.boundingSphere!.radius

    // Collapse does not invalidate bounds: the stale slot box keeps the
    // sphere conservative (bigger, never smaller).
    batch.setVisibleAt(id, false)
    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(true)
    expect(batch.geometry.boundingSphere!.radius).toBeCloseTo(radiusBefore, 6)
  })

  it('optimize invalidates bounds after deletions shrink the active set', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    batch.addGeometry(
      createLineGeometry([100, 0, 0], [110, 0, 0]),
      -1,
      -1,
      new THREE.Vector3()
    )
    batch.syncFrustumBounds()
    const radiusBefore = batch.geometry.boundingSphere!.radius

    batch.deleteGeometry(1)
    batch.optimize()
    expect(batch.frustumCulled).toBe(false)

    batch.syncFrustumBounds()
    expect(batch.geometry.boundingSphere!.radius).toBeLessThan(radiusBefore)
  })

  it('respects the global kill switch', () => {
    acTrSetBatchFrustumCullingEnabled(false)
    expect(acTrIsBatchFrustumCullingEnabled()).toBe(false)

    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(false)

    acTrSetBatchFrustumCullingEnabled(true)
    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(true)
  })

  it('reset returns the batch to the initial unculled state', () => {
    const batch = new AcTrBatchedLine(
      1000,
      2000,
      new THREE.LineBasicMaterial()
    )
    batch.addGeometry(createLineGeometry([0, 0, 0], [10, 0, 0]))
    batch.syncFrustumBounds()
    expect(batch.frustumCulled).toBe(true)

    batch.reset()
    expect(batch.frustumCulled).toBe(false)
    expect(batch.geometry.boundingSphere).toBeNull()
  })
})
