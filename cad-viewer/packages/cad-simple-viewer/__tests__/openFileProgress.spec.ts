// @ts-nocheck
import { isOpenFileProgressComplete } from '../src/app/openFileProgress'

describe('isOpenFileProgressComplete', () => {
  it('returns true when conversion finishes', () => {
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 100,
        stage: 'CONVERSION',
        subStage: 'END',
        subStageStatus: 'END'
      })
    ).toBe(true)
  })

  it('returns true for the trailing FETCH_FILE END event after openUri', () => {
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 100,
        stage: 'FETCH_FILE',
        subStageStatus: 'END'
      })
    ).toBe(true)
  })

  it('returns false for in-progress fetch events', () => {
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 50,
        stage: 'FETCH_FILE',
        subStageStatus: 'IN-PROGRESS'
      })
    ).toBe(false)
  })

  it('returns false for FETCH_FILE START', () => {
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 0,
        stage: 'FETCH_FILE',
        subStageStatus: 'START'
      })
    ).toBe(false)
  })

  it('returns true for FETCH_FILE fetch errors', () => {
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 100,
        stage: 'FETCH_FILE',
        subStageStatus: 'ERROR'
      })
    ).toBe(true)
  })

  it('detects terminal statuses regardless of the weighted percentage', () => {
    // After re-weighting, a terminal FETCH_FILE END event reports ~10, and a
    // mid-CONVERSION event may still reach a high raw value — neither may
    // decide completion.
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 10,
        stage: 'FETCH_FILE',
        subStageStatus: 'END'
      })
    ).toBe(true)
    expect(
      isOpenFileProgressComplete({
        database: {},
        percentage: 100,
        stage: 'CONVERSION',
        subStage: 'ENTITY',
        subStageStatus: 'IN-PROGRESS'
      })
    ).toBe(false)
  })
})
