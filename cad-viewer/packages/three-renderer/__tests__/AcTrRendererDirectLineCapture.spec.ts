import {
  AcGeCircArc3d,
  AcGeEllipseArc3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/data-model'
import * as THREE from 'three'

import { AcTrRenderer } from '../src/renderer/AcTrRenderer'

function createRenderer() {
  const webgl = {
    getSize: (target: THREE.Vector2) => target.set(800, 600)
  } as unknown as THREE.WebGLRenderer
  return new AcTrRenderer(webgl)
}

describe('AcTrRenderer direct capture', () => {
  it('captures lineStrip points from lines() without creating AcTrLine children', () => {
    const renderer = createRenderer()
    renderer.beginDirectCapture()
    const placeholder = renderer.lines([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 }
    ])
    expect(placeholder.children).toHaveLength(0)

    const payload = renderer.takeDirectCapture()
    expect(payload).toEqual({
      kind: 'lineStrip',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 }
      ]
    })
  })

  it('captures point() payload without creating AcTrPoint children', () => {
    const renderer = createRenderer()
    renderer.beginDirectCapture()
    const point = new AcGePoint3d(10, 20, 0)
    const placeholder = renderer.point(point, { displayMode: 0, displaySize: 0 })
    expect(placeholder.children).toHaveLength(0)

    const payload = renderer.takeDirectCapture()
    expect(payload?.kind).toBe('point')
    if (payload?.kind === 'point') {
      expect(payload.point.x).toBe(10)
      expect(payload.point.y).toBe(20)
      expect(payload.style).toEqual({ displayMode: 0, displaySize: 0 })
    }
  })

  it('captures area() payload without building AcTrPolygon geometry', () => {
    const renderer = createRenderer()
    const area = {
      getPoints: () => [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]],
      buildHierarchy: () => ({ children: [] })
    }

    renderer.beginDirectCapture()
    const placeholder = renderer.area(area as never)
    expect(placeholder.children).toHaveLength(0)

    const payload = renderer.takeDirectCapture()
    expect(payload).toEqual({ kind: 'area', area })
  })

  it('captures lineSegments() payload', () => {
    const renderer = createRenderer()
    const array = new Float32Array([0, 0, 0, 5, 0, 0])
    const indices = new Uint16Array([0, 1])

    renderer.beginDirectCapture()
    renderer.lineSegments(array, 3, indices)

    const payload = renderer.takeDirectCapture()
    expect(payload?.kind).toBe('lineSegments')
    if (payload?.kind === 'lineSegments') {
      expect(payload.array).toBe(array)
      expect(payload.itemSize).toBe(3)
      expect(payload.indices).toBe(indices)
    }
  })

  it('misses capture when a second draw call follows the first', () => {
    const renderer = createRenderer()
    renderer.beginDirectCapture()
    renderer.lines([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    ])
    renderer.lines([
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 }
    ])
    expect(renderer.takeDirectCapture()).toBeNull()
  })

  it('misses capture when mtext() is drawn during capture', () => {
    const renderer = createRenderer()
    renderer.beginDirectCapture()
    renderer.mtext({} as never, {} as never)
    expect(renderer.takeDirectCapture()).toBeNull()
  })

  it('captures circularArc as a flat Float64Array lineStrip payload', () => {
    const renderer = createRenderer()
    const arc = new AcGeCircArc3d(
      new AcGePoint3d(0, 0, 0),
      10,
      0,
      Math.PI * 2,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS
    )

    renderer.beginDirectCapture()
    const placeholder = renderer.circularArc(arc)
    expect(placeholder.children).toHaveLength(0)

    const payload = renderer.takeDirectCapture()
    expect(payload?.kind).toBe('lineStrip')
    if (payload?.kind === 'lineStrip') {
      expect(payload.points).toBeInstanceOf(Float64Array)
      expect(payload.points.length).toBe(101 * 3)
      expect(payload.points[0]!).toBe(arc.getPoints(100)[0]!.x)
      expect(payload.points[2]!).toBe(arc.getPoints(100)[0]!.z)
    }
  })

  it('captures ellipticalArc as a flat Float64Array lineStrip payload', () => {
    const renderer = createRenderer()
    const ellipse = new AcGeEllipseArc3d(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      8,
      4,
      0,
      Math.PI * 2
    )

    renderer.beginDirectCapture()
    const placeholder = renderer.ellipticalArc(ellipse)
    expect(placeholder.children).toHaveLength(0)

    const payload = renderer.takeDirectCapture()
    expect(payload?.kind).toBe('lineStrip')
    if (payload?.kind === 'lineStrip') {
      expect(payload.points).toBeInstanceOf(Float64Array)
      expect(payload.points.length).toBe(101 * 3)
    }
  })
})
