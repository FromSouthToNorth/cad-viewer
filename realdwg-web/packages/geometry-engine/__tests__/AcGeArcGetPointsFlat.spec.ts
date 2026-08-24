import {
  AcGeCircArc3d,
  AcGeEllipseArc3d,
  AcGePoint3d,
  AcGeVector3d,
  ORIGIN_POINT_3D
} from '../src'

describe('AcGeCircArc3d.getPointsFlat', () => {
  const arcs = [
    // Full circle in the XY plane.
    new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      5,
      0,
      Math.PI * 2,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS
    ),
    // Partial arc.
    new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      3,
      0.3,
      Math.PI / 2,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS
    ),
    // Off-origin, non-axis-aligned reference vector.
    new AcGeCircArc3d(
      new AcGePoint3d(100, -50, 12),
      7.5,
      1.1,
      4.2,
      AcGeVector3d.Z_AXIS,
      new AcGeVector3d(Math.cos(0.7), Math.sin(0.7), 0)
    )
  ]

  it('matches getPoints pointwise for circles and arcs', () => {
    for (const arc of arcs) {
      const expected = arc.getPoints(100)
      const flat = arc.getPointsFlat(100)
      expect(flat).toBeInstanceOf(Float64Array)
      expect(flat.length).toBe(101 * 3)
      for (let i = 0; i < 101; i++) {
        expect(flat[i * 3]!).toBe(expected[i]!.x)
        expect(flat[i * 3 + 1]!).toBe(expected[i]!.y)
        expect(flat[i * 3 + 2]!).toBe(expected[i]!.z)
      }
    }
  })

  it('fills a caller-provided buffer and returns it', () => {
    const out = new Float64Array(101 * 3)
    const result = arcs[0]!.getPointsFlat(100, out)
    expect(result).toBe(out)
    expect(out[0]!).toBe(arcs[0]!.getPoints(100)[0]!.x)
    expect(out[101 * 3 - 1]!).toBe(arcs[0]!.getPoints(100)[100]!.z)
  })
})

describe('AcGeEllipseArc3d.getPointsFlat', () => {
  const ellipses = [
    // Closed ellipse in the XY plane.
    new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      1.5,
      0,
      Math.PI * 2
    ),
    // Partial ellipse arc with oblique major axis.
    new AcGeEllipseArc3d(
      new AcGePoint3d(10, 20, -5),
      AcGeVector3d.Z_AXIS,
      new AcGeVector3d(Math.cos(0.6), Math.sin(0.6), 0),
      4,
      1,
      0.2,
      2.7
    )
  ]

  it('matches getPoints pointwise for ellipses', () => {
    for (const ellipse of ellipses) {
      const expected = ellipse.getPoints(100)
      const flat = ellipse.getPointsFlat(100)
      expect(flat).toBeInstanceOf(Float64Array)
      expect(flat.length).toBe(101 * 3)
      for (let i = 0; i < 101; i++) {
        expect(flat[i * 3]!).toBe(expected[i]!.x)
        expect(flat[i * 3 + 1]!).toBe(expected[i]!.y)
        expect(flat[i * 3 + 2]!).toBe(expected[i]!.z)
      }
    }
  })

  it('fills a caller-provided buffer and returns it', () => {
    const out = new Float64Array(101 * 3)
    const result = ellipses[0]!.getPointsFlat(100, out)
    expect(result).toBe(out)
    expect(out[0]!).toBe(ellipses[0]!.getPoints(100)[0]!.x)
  })
})
