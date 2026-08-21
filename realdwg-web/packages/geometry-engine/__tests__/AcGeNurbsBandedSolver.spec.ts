import {
  acgeBasisFunction,
  acgeComputeParameterValues,
  acgeEvaluateNurbsPoint,
  acgeGenerateAveragedKnots,
  acgeInterpolateNurbsCurve
} from '../src/util/AcGeNurbsUtil'

/**
 * Reference dense implementation of the interpolation solve (the previous
 * production code path). Used only to verify the banded solver agrees.
 */
function referenceDenseSolve(
  fitPoints: number[][],
  degree: number,
  parameterization: 'Uniform' | 'Chord' | 'SqrtChord',
  startTangent?: number[],
  endTangent?: number[]
): number[][] {
  const safePoints = fitPoints.map(point => [point[0], point[1], point[2] ?? 0])
  const hasStartTangent = !!startTangent
  const hasEndTangent = !!endTangent
  const tangentCount = (hasStartTangent ? 1 : 0) + (hasEndTangent ? 1 : 0)
  const m = safePoints.length - 1
  const n = m + tangentCount

  const params = acgeComputeParameterValues(safePoints, parameterization)
  const extendedParams = params.slice()
  if (hasStartTangent) {
    extendedParams.unshift(params[0])
  }
  if (hasEndTangent) {
    extendedParams.push(params[params.length - 1])
  }
  const knots = acgeGenerateAveragedKnots(degree, extendedParams)
  const size = n + 1

  const matrix: number[][] = []
  const rhsX: number[] = []
  const rhsY: number[] = []
  const rhsZ: number[] = []

  matrix.push(new Array(size).fill(0))
  matrix[0][0] = 1
  rhsX.push(safePoints[0][0])
  rhsY.push(safePoints[0][1])
  rhsZ.push(safePoints[0][2])

  for (let i = 1; i <= m - 1; i++) {
    const u = params[i]
    const row = new Array(size).fill(0)
    for (let j = 0; j <= n; j++) {
      row[j] = acgeBasisFunction(j, degree, u, knots)
    }
    matrix.push(row)
    rhsX.push(safePoints[i][0])
    rhsY.push(safePoints[i][1])
    rhsZ.push(safePoints[i][2])
  }

  matrix.push(new Array(size).fill(0))
  matrix[matrix.length - 1][n] = 1
  rhsX.push(safePoints[m][0])
  rhsY.push(safePoints[m][1])
  rhsZ.push(safePoints[m][2])

  if (hasStartTangent) {
    const denom = knots[degree + 1] - knots[0]
    const coeff = denom !== 0 ? degree / denom : 0
    const row = new Array(size).fill(0)
    row[0] = -coeff
    row[1] = coeff
    matrix.push(row)
    rhsX.push(startTangent?.[0] ?? 0)
    rhsY.push(startTangent?.[1] ?? 0)
    rhsZ.push(startTangent?.[2] ?? 0)
  }

  if (hasEndTangent) {
    const denom = knots[n + degree + 1] - knots[n]
    const coeff = denom !== 0 ? degree / denom : 0
    const row = new Array(size).fill(0)
    row[n - 1] = -coeff
    row[n] = coeff
    matrix.push(row)
    rhsX.push(endTangent?.[0] ?? 0)
    rhsY.push(endTangent?.[1] ?? 0)
    rhsZ.push(endTangent?.[2] ?? 0)
  }

  const solve = (rhs: number[]): number[] => {
    const a = matrix.map(row => row.slice())
    const b = rhs.slice()
    const n2 = a.length
    for (let k = 0; k < n2; k++) {
      let pivotRow = k
      let pivotValue = Math.abs(a[k][k])
      for (let i = k + 1; i < n2; i++) {
        const value = Math.abs(a[i][k])
        if (value > pivotValue) {
          pivotValue = value
          pivotRow = i
        }
      }
      if (pivotValue < 1e-12) {
        throw new Error('Interpolation matrix is singular.')
      }
      if (pivotRow !== k) {
        const tmpRow = a[k]
        a[k] = a[pivotRow]
        a[pivotRow] = tmpRow
        const tmpValue = b[k]
        b[k] = b[pivotRow]
        b[pivotRow] = tmpValue
      }
      for (let i = k + 1; i < n2; i++) {
        const factor = a[i][k] / a[k][k]
        if (Math.abs(factor) < 1e-14) {
          continue
        }
        for (let j = k; j < n2; j++) {
          a[i][j] -= factor * a[k][j]
        }
        b[i] -= factor * b[k]
      }
    }
    const x = new Array(n2).fill(0)
    for (let i = n2 - 1; i >= 0; i--) {
      let sum = b[i]
      for (let j = i + 1; j < n2; j++) {
        sum -= a[i][j] * x[j]
      }
      x[i] = sum / a[i][i]
    }
    return x
  }

  const solutionX = solve(rhsX)
  const solutionY = solve(rhsY)
  const solutionZ = solve(rhsZ)
  return solutionX.map((x, i) => [x, solutionY[i], solutionZ[i]])
}

function randomFitPoints(count: number, seed: number): number[][] {
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
  const points: number[][] = []
  for (let i = 0; i < count; i++) {
    points.push([next() * 100 - 50, next() * 100 - 50, (next() - 0.5) * 20])
  }
  return points
}

describe('acgeInterpolateNurbsCurve banded solver', () => {
  it('matches the dense reference solver on random inputs without tangents', () => {
    for (const count of [3, 4, 5, 8, 20]) {
      const points = randomFitPoints(count, count * 977)
      for (const degree of [1, 2, 3]) {
        if (count - 1 < degree) continue
        const actual = acgeInterpolateNurbsCurve(
          points,
          degree,
          'Uniform'
        ).controlPoints
        const expected = referenceDenseSolve(points, degree, 'Uniform')
        expect(actual).toHaveLength(expected.length)
        for (let i = 0; i < expected.length; i++) {
          expect(actual[i][0]).toBeCloseTo(expected[i][0], 8)
          expect(actual[i][1]).toBeCloseTo(expected[i][1], 8)
          expect(actual[i][2]).toBeCloseTo(expected[i][2], 8)
        }
      }
    }
  })

  it('matches the dense reference solver with end tangents', () => {
    const points = randomFitPoints(9, 424242)
    const degree = 3
    const startTangent = [1, 0, 0]
    const endTangent = [0, 1, 0]

    const actual = acgeInterpolateNurbsCurve(
      points,
      degree,
      'Uniform',
      startTangent,
      endTangent
    ).controlPoints
    const expected = referenceDenseSolve(
      points,
      degree,
      'Uniform',
      startTangent,
      endTangent
    )

    expect(actual).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i][0]).toBeCloseTo(expected[i][0], 8)
      expect(actual[i][1]).toBeCloseTo(expected[i][1], 8)
      expect(actual[i][2]).toBeCloseTo(expected[i][2], 8)
    }
  })

  it('matches the dense reference solver for chord parameterization', () => {
    const points = randomFitPoints(12, 1337)
    const actual = acgeInterpolateNurbsCurve(
      points,
      3,
      'Chord'
    ).controlPoints
    const expected = referenceDenseSolve(points, 3, 'Chord')

    expect(actual).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i][0]).toBeCloseTo(expected[i][0], 8)
      expect(actual[i][1]).toBeCloseTo(expected[i][1], 8)
      expect(actual[i][2]).toBeCloseTo(expected[i][2], 8)
    }
  })

  it('still interpolates the fit points after banded solving', () => {
    const points = randomFitPoints(16, 777)
    const degree = 3
    const result = acgeInterpolateNurbsCurve(points, degree, 'Uniform')
    const params = acgeComputeParameterValues(points, 'Uniform')

    params.forEach((u, index) => {
      const point = acgeEvaluateNurbsPoint(
        u,
        degree,
        result.knots,
        result.controlPoints,
        result.weights
      )
      expect(point[0]).toBeCloseTo(points[index][0], 6)
      expect(point[1]).toBeCloseTo(points[index][1], 6)
      expect(point[2]).toBeCloseTo(points[index][2], 6)
    })
  })

  it('solves large systems quickly with the banded solver', () => {
    const points = randomFitPoints(800, 99991)
    const start = Date.now()
    const result = acgeInterpolateNurbsCurve(points, 3, 'Uniform')
    const elapsed = Date.now() - start

    expect(result.controlPoints).toHaveLength(800)
    // The old dense elimination was O(n³); the banded solver must stay far
    // below the multi-second dense cost for n = 800.
    expect(elapsed).toBeLessThan(5000)
  })
})
