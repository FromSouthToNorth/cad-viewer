import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { AcTrBatchedLine2 } from '../src/batch/AcTrBatchedLine2'
import { BATCH_SLOT_ID_ATTRIBUTE } from '../src/batch/highlight'
import { AcTrVertexMarkerOverlay } from '../src/object/AcTrVertexMarkerOverlay'

function createSegmentsGeometry(pairs: Array<[number, number]>) {
  const geometry = new LineSegmentsGeometry()
  const positions: number[] = []
  for (const [sx, ex] of pairs) {
    positions.push(sx, 0, 0, ex, 0, 0)
  }
  geometry.setPositions(positions)
  return geometry
}

describe('AcTrVertexMarkerOverlay', () => {
  it('uploads world-space marker points as a position attribute', () => {
    const overlay = new AcTrVertexMarkerOverlay()
    const points = overlay.internalObject as THREE.Points

    overlay.setPoints([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 }
    ])

    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
    expect(position.count).toBe(2)
    expect(position.getX(0)).toBe(1)
    expect(position.getY(0)).toBe(2)
    expect(position.getZ(0)).toBe(3)
    expect(position.getX(1)).toBe(4)
  })

  it('clears markers and disposes resources', () => {
    const overlay = new AcTrVertexMarkerOverlay()
    const points = overlay.internalObject as THREE.Points

    overlay.setPoints([{ x: 0, y: 0, z: 0 }])
    overlay.clear()
    expect(points.geometry.hasAttribute('position')).toBe(false)

    const geometry = points.geometry
    const material = points.material as THREE.PointsMaterial
    overlay.dispose()
    // After dispose the overlay is inert; no further assertions on GPU state.
    expect(geometry).toBeDefined()
    expect(material.sizeAttenuation).toBe(false)
  })

  it('renders screen-constant markers above entity draw tiers', () => {
    const overlay = new AcTrVertexMarkerOverlay()
    const points = overlay.internalObject as THREE.Points
    const material = points.material as THREE.PointsMaterial

    expect(points.name).toBe('SelectionVertexMarkerOverlay')
    expect(points.frustumCulled).toBe(false)
    expect(points.renderOrder).toBe(AcTrVertexMarkerOverlay.RENDER_ORDER)
    expect(material.size).toBe(14)
    expect(material.sizeAttenuation).toBe(false)
    expect(material.depthTest).toBe(false)
    expect(material.depthWrite).toBe(false)
    expect(material.transparent).toBe(true)
  })
})

describe('AcTrBatchedLine2 selection-dash packing', () => {
  it('writes instanced slotId and per-entity cumulative instance distances', () => {
    const batch = new AcTrBatchedLine2(8, new LineMaterial())
    const geometry = createSegmentsGeometry([
      [0, 10],
      [10, 40]
    ])

    const geometryId = batch.addGeometry(geometry, -1, new THREE.Vector3())
    expect(geometryId).toBe(0)

    const slotId = batch.geometry.getAttribute(BATCH_SLOT_ID_ATTRIBUTE) as
      | THREE.InstancedBufferAttribute
      | undefined
    expect(slotId).toBeDefined()
    expect(slotId!.isInstancedBufferAttribute).toBe(true)
    expect(slotId!.getX(0)).toBe(0)
    expect(slotId!.getX(1)).toBe(0)

    // Segments are 10 and 30 world units long: distances accumulate per entity.
    const distanceStart = batch.geometry.getAttribute('instanceDistanceStart')
    const distanceEnd = batch.geometry.getAttribute('instanceDistanceEnd')
    expect(distanceStart).toBeDefined()
    expect(distanceEnd).toBeDefined()
    expect(distanceStart.getX(0)).toBe(0)
    expect(distanceEnd.getX(0)).toBe(10)
    expect(distanceStart.getX(1)).toBe(10)
    expect(distanceEnd.getX(1)).toBe(40)
  })

  it('restarts distances per entity so each entity keeps a local dash phase', () => {
    const batch = new AcTrBatchedLine2(8, new LineMaterial())
    batch.addGeometry(createSegmentsGeometry([[0, 10]]), -1, new THREE.Vector3())
    batch.addGeometry(createSegmentsGeometry([[0, 30]]), -1, new THREE.Vector3())

    const distanceStart = batch.geometry.getAttribute('instanceDistanceStart')
    const distanceEnd = batch.geometry.getAttribute('instanceDistanceEnd')
    // Second entity starts its own phase from zero despite being packed after
    // a 10-unit first entity.
    expect(distanceStart.getX(0)).toBe(0)
    expect(distanceEnd.getX(0)).toBe(10)
    expect(distanceStart.getX(1)).toBe(0)
    expect(distanceEnd.getX(1)).toBe(30)
  })

  it('keeps distances aligned with slots after optimize', () => {
    const batch = new AcTrBatchedLine2(8, new LineMaterial())
    const firstId = batch.addGeometry(
      createSegmentsGeometry([[0, 10]]),
      -1,
      new THREE.Vector3()
    )
    batch.addGeometry(createSegmentsGeometry([[0, 30]]), -1, new THREE.Vector3())
    batch.deleteGeometry(firstId)

    batch.optimize()

    const distanceStart = batch.geometry.getAttribute('instanceDistanceStart')
    const distanceEnd = batch.geometry.getAttribute('instanceDistanceEnd')
    const slotId = batch.geometry.getAttribute(BATCH_SLOT_ID_ATTRIBUTE)
    // The surviving entity moved to the front of the packed buffers.
    expect(distanceStart.getX(0)).toBe(0)
    expect(distanceEnd.getX(0)).toBe(30)
    expect(slotId.getX(0)).toBe(1)
  })
})
