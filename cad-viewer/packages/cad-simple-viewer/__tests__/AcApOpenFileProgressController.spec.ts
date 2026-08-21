// @ts-nocheck
const mockProgressInstances: Array<{
  hide: jest.Mock
  show: jest.Mock
  setMessage: jest.Mock
  setProgress: jest.Mock
  setOverlayColor: jest.Mock
}> = []

const mockEventBusEmit = jest.fn()
const mockYieldForPaint = jest.fn(() => Promise.resolve())

jest.mock('@mlightcad/data-model', () => ({
  ...jest.requireActual('@mlightcad/data-model'),
  accmYieldForPaint: mockYieldForPaint
}))

jest.mock('../src/app/AcApProgress', () => ({
  AcApProgress: jest.fn().mockImplementation(() => {
    const instance = {
      hide: jest.fn(),
      show: jest.fn(),
      setMessage: jest.fn(),
      setProgress: jest.fn(),
      setOverlayColor: jest.fn()
    }
    mockProgressInstances.push(instance)
    return instance
  })
}))

jest.mock('../src/editor', () => ({
  eventBus: {
    emit: mockEventBusEmit
  }
}))

jest.mock('../src/i18n', () => ({
  AcApI18n: {
    t: jest.fn((key: string) => key)
  }
}))

import { AcApOpenFileProgressController } from '../src/app/AcApOpenFileProgressController'

describe('AcApOpenFileProgressController', () => {
  let controller: AcApOpenFileProgressController
  let progress: {
    hide: jest.Mock
    show: jest.Mock
    setMessage: jest.Mock
    setProgress: jest.Mock
    setOverlayColor: jest.Mock
  }

  beforeEach(() => {
    mockProgressInstances.length = 0
    mockEventBusEmit.mockClear()
    mockYieldForPaint.mockClear()
    controller = new AcApOpenFileProgressController({} as HTMLElement)
    progress = mockProgressInstances[0]
    progress.hide.mockClear()
    progress.show.mockClear()
    progress.setMessage.mockClear()
    progress.setProgress.mockClear()
    progress.setOverlayColor.mockClear()
  })

  it('emits normalized monotonic open-file progress', () => {
    const database = {}

    const first = controller.handle({
      database,
      percentage: 40,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })
    const second = controller.handle({
      database,
      percentage: 30,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })

    // FETCH_FILE occupies the 0-10% slice of the global bar.
    expect(first.percentage).toBe(4)
    expect(second.percentage).toBe(4)
    expect(mockEventBusEmit).toHaveBeenLastCalledWith(
      'open-file-progress',
      second
    )
    expect(progress.show).toHaveBeenCalled()
  })

  it('continues monotonic progress across FETCH_FILE → CONVERSION without reset', () => {
    const database = {}

    controller.handle({
      database,
      percentage: 100,
      stage: 'FETCH_FILE',
      subStageStatus: 'END'
    })
    const next = controller.handle({
      database,
      percentage: 5,
      stage: 'CONVERSION',
      subStage: 'PARSE',
      subStageStatus: 'START'
    })

    // CONVERSION occupies 10-100%: 10 + 5 × 0.9, and the bar never dips.
    expect(next.percentage).toBe(14.5)
  })

  it('hides the overlay when open-file progress completes', () => {
    controller.handle({
      database: {},
      percentage: 100,
      stage: 'CONVERSION',
      subStage: 'END',
      subStageStatus: 'END'
    })

    expect(progress.hide).toHaveBeenCalledTimes(1)
  })

  it('reset clears tracked progress state', () => {
    const database = {}

    controller.handle({
      database,
      percentage: 50,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })
    controller.reset()

    const next = controller.handle({
      database,
      percentage: 20,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })

    expect(next.percentage).toBe(2)
  })

  it('beginOpen shows the overlay and yields for paint', async () => {
    await controller.beginOpen({})

    expect(progress.show).toHaveBeenCalled()
    expect(mockYieldForPaint).toHaveBeenCalled()
    expect(mockEventBusEmit).toHaveBeenCalledWith(
      'open-file-progress',
      expect.objectContaining({
        percentage: 0,
        stage: 'CONVERSION',
        subStage: 'START',
        subStageStatus: 'START'
      })
    )
  })

  it('dedupes overlay show/setMessage while still emitting every progress event', () => {
    const database = {}

    controller.handle({
      database,
      percentage: 20,
      stage: 'CONVERSION',
      subStage: 'ENTITY',
      subStageStatus: 'START'
    })
    controller.handle({
      database,
      percentage: 40,
      stage: 'CONVERSION',
      subStage: 'ENTITY',
      subStageStatus: 'IN-PROGRESS'
    })
    controller.handle({
      database,
      percentage: 60,
      stage: 'CONVERSION',
      subStage: 'ENTITY',
      subStageStatus: 'IN-PROGRESS'
    })

    expect(progress.show).toHaveBeenCalledTimes(1)
    expect(progress.setMessage).toHaveBeenCalledTimes(1)
    expect(progress.setMessage).toHaveBeenCalledWith('main.progress.entity')
    expect(progress.setProgress).toHaveBeenCalledTimes(3)
    expect(progress.setProgress).toHaveBeenNthCalledWith(1, 28)
    expect(progress.setProgress).toHaveBeenNthCalledWith(2, 46)
    expect(progress.setProgress).toHaveBeenNthCalledWith(3, 64)
    expect(mockEventBusEmit).toHaveBeenCalledTimes(3)
  })

  it('shows numeric progress on beginOpen and hides it while the scene drains', async () => {
    // Scene busy gate stays true for the completion check, then goes idle on
    // the first poll so the hold path completes.
    let busyChecks = 0
    controller.setSceneBusyGate(() => {
      busyChecks++
      return busyChecks === 1
    })
    const database = {}

    await controller.beginOpen(database)
    expect(progress.setProgress).toHaveBeenCalledWith(0)

    controller.handle({
      database,
      percentage: 70,
      stage: 'CONVERSION',
      subStage: 'ENTITY',
      subStageStatus: 'IN-PROGRESS'
    })
    expect(progress.setProgress).toHaveBeenLastCalledWith(73)

    controller.handle({
      database,
      percentage: 100,
      stage: 'CONVERSION',
      subStage: 'END',
      subStageStatus: 'END'
    })
    expect(progress.setProgress).toHaveBeenLastCalledWith(undefined)
    expect(progress.setMessage).toHaveBeenLastCalledWith(
      'main.progress.rendering'
    )

    // Wait for the drain poll to release the overlay.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(progress.hide).toHaveBeenCalled()
  })

  it('keeps the numeric progress hidden while the scene drains after completion', async () => {
    // Gate stays busy for the completion check and one poll, then goes idle.
    let busyChecks = 0
    controller.setSceneBusyGate(() => {
      busyChecks++
      return busyChecks < 3
    })
    const database = {}

    controller.handle({
      database,
      percentage: 100,
      stage: 'CONVERSION',
      subStage: 'END',
      subStageStatus: 'END'
    })
    expect(progress.setProgress).toHaveBeenLastCalledWith(undefined)

    await new Promise((resolve) => setTimeout(resolve, 80))
    // The drain must not repaint a low percentage after 100% was reached.
    expect(progress.setProgress).toHaveBeenLastCalledWith(undefined)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(progress.hide).toHaveBeenCalled()
  })

  it('updates overlay message when the conversion sub-stage changes', () => {
    const database = {}

    controller.handle({
      database,
      percentage: 5,
      stage: 'CONVERSION',
      subStage: 'PARSE',
      subStageStatus: 'IN-PROGRESS'
    })
    controller.handle({
      database,
      percentage: 15,
      stage: 'CONVERSION',
      subStage: 'STYLE',
      subStageStatus: 'START'
    })

    expect(progress.setMessage).toHaveBeenNthCalledWith(1, 'main.progress.parse')
    expect(progress.setMessage).toHaveBeenNthCalledWith(2, 'main.progress.style')
    expect(progress.show).toHaveBeenCalledTimes(1)
  })

  it('emits nothing and keeps the overlay hidden while UI is suppressed', () => {
    const database = {}

    controller.setUiSuppressed(true)
    const handled = controller.handle({
      database,
      percentage: 40,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })

    expect(handled.percentage).toBe(4)
    expect(mockEventBusEmit).not.toHaveBeenCalled()
    expect(progress.show).not.toHaveBeenCalled()
    expect(progress.setProgress).not.toHaveBeenCalled()
  })

  it('keeps the overlay hidden for a suppressed beginOpen', async () => {
    controller.setUiSuppressed(true)

    await controller.beginOpen({})

    expect(progress.show).not.toHaveBeenCalled()
    expect(mockEventBusEmit).not.toHaveBeenCalled()
    expect(mockYieldForPaint).toHaveBeenCalled()
  })

  it('resets controller state when suppression is lifted', () => {
    const database = {}
    controller.handle({
      database,
      percentage: 40,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })
    expect(progress.show).toHaveBeenCalledTimes(1)

    controller.setUiSuppressed(true)
    controller.handle({
      database,
      percentage: 60,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })

    progress.show.mockClear()
    progress.hide.mockClear()
    mockEventBusEmit.mockClear()

    controller.setUiSuppressed(false)
    expect(progress.hide).toHaveBeenCalled()

    // The next visible open starts fresh and emits again.
    controller.handle({
      database,
      percentage: 10,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })
    expect(progress.show).toHaveBeenCalledTimes(1)
    expect(mockEventBusEmit).toHaveBeenCalledTimes(1)
  })

  it('clears state when a suppressed open completes', () => {
    const database = {}
    controller.setUiSuppressed(true)

    controller.handle({
      database,
      percentage: 40,
      stage: 'FETCH_FILE',
      subStageStatus: 'IN-PROGRESS'
    })
    controller.handle({
      database,
      percentage: 100,
      stage: 'FETCH_FILE',
      subStageStatus: 'END'
    })

    expect(mockEventBusEmit).not.toHaveBeenCalled()
    expect(progress.show).not.toHaveBeenCalled()
    expect(progress.hide).toHaveBeenCalled()
  })
})
