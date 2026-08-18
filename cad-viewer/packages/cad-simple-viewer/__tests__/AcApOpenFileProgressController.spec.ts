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

    expect(first.percentage).toBe(40)
    expect(second.percentage).toBe(40)
    expect(mockEventBusEmit).toHaveBeenLastCalledWith(
      'open-file-progress',
      second
    )
    expect(progress.show).toHaveBeenCalled()
  })

  it('resets peak percentage when moving from FETCH_FILE to CONVERSION', () => {
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

    expect(next.percentage).toBe(5)
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

    expect(next.percentage).toBe(20)
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
    expect(progress.setProgress).toHaveBeenNthCalledWith(1, 20)
    expect(progress.setProgress).toHaveBeenNthCalledWith(2, 40)
    expect(progress.setProgress).toHaveBeenNthCalledWith(3, 60)
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
    expect(progress.setProgress).toHaveBeenLastCalledWith(70)

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

  it('reports scene drain progress from the busy gate source while holding', async () => {
    // Gate stays busy for the completion check and one poll, then goes idle.
    let busyChecks = 0
    controller.setSceneBusyGate(
      () => {
        busyChecks++
        return busyChecks < 3
      },
      () => 0.5
    )
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
    expect(progress.setProgress).toHaveBeenLastCalledWith(50)
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
})
