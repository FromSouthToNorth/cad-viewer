import { shouldRefreshCameraDepthRange } from '../src/view/AcTrDepthRangeUtil'

describe('shouldRefreshCameraDepthRange', () => {
  it('refreshes when the camera was never fitted to scene geometry', () => {
    expect(
      shouldRefreshCameraDepthRange(null, { min: 0, max: 100 })
    ).toBe(true)
  })

  it('refreshes when the scene grows beyond the applied range on the top', () => {
    expect(
      shouldRefreshCameraDepthRange({ min: 0, max: 100 }, { min: 0, max: 52114.85 })
    ).toBe(true)
  })

  it('refreshes when the scene grows beyond the applied range on the bottom', () => {
    expect(
      shouldRefreshCameraDepthRange({ min: -50, max: 50 }, { min: -86396.93, max: 50 })
    ).toBe(true)
  })

  it('does nothing while the scene fits inside the applied range', () => {
    expect(
      shouldRefreshCameraDepthRange({ min: -100, max: 200 }, { min: -50, max: 150 })
    ).toBe(false)
  })

  it('does nothing when the extents match exactly', () => {
    expect(
      shouldRefreshCameraDepthRange({ min: -100, max: 200 }, { min: -100, max: 200 })
    ).toBe(false)
  })
})
