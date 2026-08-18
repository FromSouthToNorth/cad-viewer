import { AcGeArea2d, AcGePoint2d } from '@mlightcad/data-model'
import * as THREE from 'three'

import { expectWcsBboxCloseTo } from './helpers/expectWcsBbox'
import {
  buildAreaGeometry,
  buildLineSegmentsGeometry
} from '../src/object/AcTrLineGeometryBuilder'
import { AcTrImage } from '../src/object/AcTrImage'
import { AcTrPolygon } from '../src/object/AcTrPolygon'
import { AcTrRenderer } from '../src/renderer'
import { AcTrRenderContext } from '../src/renderer/AcTrRenderContext'
import { AcTrSubEntityTraitsUtil } from '../src/util'
import { AcTrBaseView } from '../src/viewport/AcTrBaseView'

/**
 * Magnitude of the Gauss-Krüger projected coordinates in the target drawing.
 * float32 ulp at this magnitude is 4 units, so builders that bake world
 * coordinates before rebasing lose sub-4-unit detail.
 */
const ORIGIN = 39_652_926.8

const defaultTraits = AcTrSubEntityTraitsUtil.createDefaultTraits()

function createRectangularArea(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): AcGeArea2d {
  const loop = [
    new AcGePoint2d(minX, minY),
    new AcGePoint2d(maxX, minY),
    new AcGePoint2d(maxX, maxY),
    new AcGePoint2d(minX, maxY)
  ]

  return {
    getPoints: () => [loop],
    buildHierarchy: () => ({
      children: [{ index: 0, children: [] }]
    })
  } as unknown as AcGeArea2d
}

function getMeshPosition(entity: THREE.Object3D) {
  for (const child of entity.children) {
    if (child instanceof THREE.Mesh) {
      return child.position
    }
  }
  throw new Error('no mesh child found')
}

function maxVertexMagnitude(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  let max = 0
  for (let i = 0; i < position.count; i++) {
    max = Math.max(
      max,
      Math.abs(position.getX(i)),
      Math.abs(position.getY(i)),
      Math.abs(position.getZ(i))
    )
  }
  return max
}

class TestView extends AcTrBaseView {}

function createMockRenderer(): AcTrRenderer {
  return {
    domElement: {} as HTMLCanvasElement,
    render: jest.fn()
  } as unknown as AcTrRenderer
}

describe('AcTrPolygon build-time origin shift', () => {
  it('keeps triangulated vertices small and restores WCS via mesh position', () => {
    const polygon = new AcTrPolygon(
      createRectangularArea(ORIGIN, ORIGIN, ORIGIN + 8, ORIGIN + 6),
      defaultTraits,
      new AcTrRenderContext()
    )

    const meshPosition = getMeshPosition(polygon)
    expect(meshPosition.x).toBeCloseTo(ORIGIN + 4, 6)
    expect(meshPosition.y).toBeCloseTo(ORIGIN + 3, 6)

    const mesh = polygon.children[0] as THREE.Mesh
    expect(maxVertexMagnitude(mesh.geometry as THREE.BufferGeometry)).toBeLessThan(10)

    expectWcsBboxCloseTo(
      polygon.wcsBbox,
      [ORIGIN, ORIGIN, 0],
      [ORIGIN + 8, ORIGIN + 6, 0]
    )
  })
})

describe('AcTrImage build-time origin shift', () => {
  beforeEach(() => {
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-image')
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    jest
      .spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation(() => new THREE.Texture())
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rebases the boundary around its WCS center', () => {
    const image = new AcTrImage(
      new Blob(['image-bytes'], { type: 'image/png' }),
      {
        boundary: [
          { x: ORIGIN, y: ORIGIN },
          { x: ORIGIN + 10, y: ORIGIN },
          { x: ORIGIN + 10, y: ORIGIN + 5 },
          { x: ORIGIN, y: ORIGIN + 5 }
        ]
      } as never,
      new AcTrRenderContext()
    )

    const meshPosition = getMeshPosition(image)
    expect(meshPosition.x).toBeCloseTo(ORIGIN + 5, 6)
    expect(meshPosition.y).toBeCloseTo(ORIGIN + 2.5, 6)

    const mesh = image.children[0] as THREE.Mesh
    expect(maxVertexMagnitude(mesh.geometry as THREE.BufferGeometry)).toBeLessThan(10)

    expectWcsBboxCloseTo(
      image.wcsBbox,
      [ORIGIN, ORIGIN, 0],
      [ORIGIN + 10, ORIGIN + 5, 0]
    )
  })
})

describe('buildAreaGeometry origin handling', () => {
  it('reports the WCS center as worldOffset after anchor rebase', () => {
    const built = buildAreaGeometry(
      createRectangularArea(ORIGIN, ORIGIN, ORIGIN + 8, ORIGIN + 6),
      defaultTraits,
      new AcTrRenderContext()
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.kind).toBe('mesh')
    expect(built.worldOffset.x).toBeCloseTo(ORIGIN + 4, 6)
    expect(built.worldOffset.y).toBeCloseTo(ORIGIN + 3, 6)
    expectWcsBboxCloseTo(
      built.wcsBbox,
      [ORIGIN, ORIGIN, 0],
      [ORIGIN + 8, ORIGIN + 6, 0]
    )

    // Output vertices are local to worldOffset; reconstructing WCS must land
    // back inside the original area without float32 world-scale quantization.
    const position = built.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + built.worldOffset.x
      const y = position.getY(i) + built.worldOffset.y
      expect(x).toBeGreaterThanOrEqual(ORIGIN - 0.01)
      expect(x).toBeLessThanOrEqual(ORIGIN + 8 + 0.01)
      expect(y).toBeGreaterThanOrEqual(ORIGIN - 0.01)
      expect(y).toBeLessThanOrEqual(ORIGIN + 6 + 0.01)
    }
  })
})

describe('buildLineSegmentsGeometry double-precision input', () => {
  it('preserves sub-float32-ulp detail from a Float64Array input', () => {
    // 0.8 units apart at ORIGIN: float32 storage (ulp = 4) would collapse the
    // segment, Float64 keeps both endpoints distinguishable.
    const array = new Float64Array([
      ORIGIN + 0.1, ORIGIN, 0,
      ORIGIN + 0.9, ORIGIN, 0
    ])
    const indices = new Uint16Array([0, 1])
    const built = buildLineSegmentsGeometry(
      array,
      3,
      indices,
      new THREE.LineBasicMaterial()
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.worldOffset.x).toBeCloseTo(ORIGIN + 0.5, 6)

    const position = built.geometry.getAttribute('position')
    expect(position.array).toBeInstanceOf(Float32Array)
    const span = Math.abs(position.getX(0) - position.getX(1))
    expect(span).toBeCloseTo(0.8, 5)
  })

  it('still accepts Float32Array inputs', () => {
    const array = new Float32Array([0, 0, 0, 10, 0, 0])
    const built = buildLineSegmentsGeometry(
      array,
      3,
      new Uint16Array([0, 1]),
      new THREE.LineBasicMaterial()
    )

    expect(built).not.toBeNull()
    if (!built) return
    expect(built.worldOffset.x).toBeCloseTo(5, 6)
  })
})

describe('AcTrBaseView.updateCameraDepthRange', () => {
  it('elevates the camera and widens far to cover a 1.97e7 Z span', () => {
    const view = new TestView(createMockRenderer(), 800, 600)
    const zMax = 19_730_366.2
    view.updateCameraDepthRange(0, zMax)

    const camera = view.internalCamera
    expect(camera.position.z).toBeCloseTo(zMax + 1000, 6)
    expect(camera.near).toBeCloseTo(0.01, 6)
    expect(camera.far).toBeCloseTo(zMax + 2000, 6)

    // A point at the top of the span must land inside the clip range.
    camera.updateMatrixWorld(true)
    const topPoint = new THREE.Vector3(0, 0, zMax)
    topPoint.applyMatrix4(camera.matrixWorldInverse)
    expect(topPoint.z).toBeCloseTo(-1000, 6)
    expect(-topPoint.z).toBeLessThanOrEqual(camera.far)
    expect(-topPoint.z).toBeGreaterThanOrEqual(camera.near)
  })

  it('keeps a sane default band for near-zero Z content', () => {
    const view = new TestView(createMockRenderer(), 800, 600)
    view.updateCameraDepthRange(0, 0)

    const camera = view.internalCamera
    expect(camera.near).toBeCloseTo(0.01, 6)
    expect(camera.far).toBeCloseTo(2000, 6)

    camera.updateMatrixWorld(true)
    const contentPoint = new THREE.Vector3(0, 0, 0)
    contentPoint.applyMatrix4(camera.matrixWorldInverse)
    expect(-contentPoint.z).toBeLessThanOrEqual(camera.far)
    expect(-contentPoint.z).toBeGreaterThanOrEqual(camera.near)
  })

  it('ignores invalid ranges', () => {
    const view = new TestView(createMockRenderer(), 800, 600)
    const camera = view.internalCamera
    const initialZ = camera.position.z
    view.updateCameraDepthRange(NaN, 100)
    view.updateCameraDepthRange(200, 100)
    expect(camera.position.z).toBe(initialZ)
    expect(camera.far).toBe(1000)
  })
})
