import { AcDbSysVarManager } from '@mlightcad/data-model'

import { AcEdSelectionVertexMarkers } from '../src/editor/marker/AcEdSelectionVertexMarkers'
import { AcEdOpenMode } from '../src/editor/view/AcEdOpenMode'
import type { AcTrView2d } from '../src/view/AcTrView2d'

const mockDocState: { doc: unknown } = { doc: undefined }

jest.mock('../src/app', () => ({
  AcApDocManager: {
    get instance() {
      return {
        get curDocument() {
          return mockDocState.doc
        }
      }
    }
  }
}))

jest.mock('../src/editor/input/ui/AcEdMTextEditor', () => ({
  AcEdMTextEditor: {
    getActiveInputBox: () => null
  }
}))

class FakeEvent<T> {
  private listeners: Array<(args: T) => void> = []

  addEventListener(listener: (args: T) => void) {
    this.listeners.push(listener)
  }

  removeEventListener(listener: (args: T) => void) {
    this.listeners = this.listeners.filter(entry => entry !== listener)
  }

  fire(args: T) {
    this.listeners.forEach(listener => listener(args))
  }

  get count() {
    return this.listeners.length
  }
}

const gripPoints = [
  { x: 1, y: 2, z: 0 },
  { x: 3, y: 4, z: 0 }
]

const gripPoints2 = [{ x: 10, y: 20, z: 0 }]

function createHarness(openMode: AcEdOpenMode = AcEdOpenMode.Read) {
  const blockTable = {
    getEntityById: jest.fn((id: string) => {
      if (id === 'e1') return { subGetGripPoints: () => gripPoints }
      if (id === 'e2') return { subGetGripPoints: () => gripPoints2 }
      return undefined
    })
  }
  const doc = {
    openMode,
    database: { tables: { blockTable } }
  }
  mockDocState.doc = doc

  const selectionAdded = new FakeEvent<{ ids: string[] }>()
  const selectionRemoved = new FakeEvent<{ ids: string[] }>()
  const hover = new FakeEvent<{ id: string }>()
  const unhover = new FakeEvent<{ id: string }>()
  const scene = {
    setSelectionVertexMarkers: jest.fn(),
    clearSelectionVertexMarkers: jest.fn()
  }
  const selectionState = { ids: [] as string[] }
  const lastPickedState = { id: null as string | null }
  const view = {
    get lastPickedEntityId() {
      return lastPickedState.id
    },
    set lastPickedEntityId(id: string | null) {
      lastPickedState.id = id
    },
    selectionSet: {
      get ids() {
        return selectionState.ids
      },
      get count() {
        return selectionState.ids.length
      },
      events: { selectionAdded, selectionRemoved }
    },
    events: { hover, unhover },
    editor: { isActive: false },
    cadScene: scene
  } as unknown as AcTrView2d

  return {
    view,
    scene,
    selectionState,
    lastPickedState,
    selectionAdded,
    selectionRemoved,
    hover,
    unhover,
    blockTable
  }
}

describe('AcEdSelectionVertexMarkers', () => {
  beforeEach(() => {
    jest.spyOn(AcDbSysVarManager.instance(), 'getVar').mockReturnValue(0)
  })

  afterEach(() => {
    mockDocState.doc = undefined
    jest.restoreAllMocks()
  })

  it('uploads grip points of selected entities as world-space markers', () => {
    const { view, scene, selectionState, selectionAdded } = createHarness()
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })

    expect(scene.setSelectionVertexMarkers).toHaveBeenCalledTimes(1)
    expect(scene.setSelectionVertexMarkers).toHaveBeenCalledWith(gripPoints)
    expect(scene.clearSelectionVertexMarkers).not.toHaveBeenCalled()
  })

  it('adds the hovered entity to the marker set', () => {
    const { view, scene, selectionState, selectionAdded, hover } =
      createHarness()
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })
    hover.fire({ id: 'e2' })

    const calls = scene.setSelectionVertexMarkers.mock.calls
    const lastCall = calls[calls.length - 1][0]
    expect(lastCall).toEqual([...gripPoints, ...gripPoints2])
  })

  it('restricts click-pick markers to the last picked entity only', () => {
    const { view, scene, selectionState, selectionAdded, lastPickedState } =
      createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1', 'e2']
    selectionAdded.fire({ ids: ['e1', 'e2'] })
    lastPickedState.id = 'e1'
    markers.refresh()

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(gripPoints)

    lastPickedState.id = 'e2'
    markers.refresh()

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(
      gripPoints2
    )
  })

  it('shows markers for every selected entity after a box selection', () => {
    const { view, scene, selectionState, selectionAdded, lastPickedState } =
      createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1', 'e2']
    selectionAdded.fire({ ids: ['e1', 'e2'] })
    lastPickedState.id = 'e1'
    markers.refresh()
    lastPickedState.id = null
    markers.refresh()

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith([
      ...gripPoints,
      ...gripPoints2
    ])
  })

  it('falls back to the remaining selection when the last picked entity is removed', () => {
    const {
      view,
      scene,
      selectionState,
      selectionAdded,
      selectionRemoved,
      lastPickedState
    } = createHarness()
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1', 'e2']
    selectionAdded.fire({ ids: ['e1', 'e2'] })
    lastPickedState.id = 'e1'
    selectionState.ids = ['e2']
    selectionRemoved.fire({ ids: ['e1'] })

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(
      gripPoints2
    )
  })

  it('re-focuses markers when clicking an already selected entity', () => {
    const { view, scene, selectionState, selectionAdded, lastPickedState } =
      createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1', 'e2']
    selectionAdded.fire({ ids: ['e1', 'e2'] })
    lastPickedState.id = 'e2'
    markers.refresh()
    lastPickedState.id = 'e1'
    markers.refresh()

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(gripPoints)
  })

  it('clears markers when the selection and hover sets become empty', () => {
    const {
      view,
      scene,
      selectionState,
      selectionAdded,
      selectionRemoved,
      unhover
    } = createHarness()
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })
    selectionState.ids = []
    selectionRemoved.fire({ ids: ['e1'] })
    unhover.fire({ id: '' })

    expect(scene.clearSelectionVertexMarkers).toHaveBeenCalled()
  })

  it('yields to interactive HTML grips in write mode', () => {
    const { view, scene, selectionState, selectionAdded } = createHarness(
      AcEdOpenMode.Write
    )
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })

    expect(scene.setSelectionVertexMarkers).not.toHaveBeenCalled()
    expect(scene.clearSelectionVertexMarkers).toHaveBeenCalled()
  })

  it('skips per-entity markers for box selections beyond the cap', () => {
    const { view, scene, selectionState, selectionAdded } = createHarness()
    new AcEdSelectionVertexMarkers(view)

    selectionState.ids = Array.from(
      { length: AcEdSelectionVertexMarkers.MAX_MARKER_ENTITIES + 1 },
      (_, index) => `e${index}`
    )
    selectionAdded.fire({ ids: selectionState.ids })

    expect(scene.setSelectionVertexMarkers).not.toHaveBeenCalled()
    expect(scene.clearSelectionVertexMarkers).toHaveBeenCalled()
  })

  it('still marks the last picked entity inside a huge selection', () => {
    const { view, scene, selectionState, selectionAdded, lastPickedState } =
      createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)

    selectionState.ids = Array.from(
      { length: AcEdSelectionVertexMarkers.MAX_MARKER_ENTITIES + 1 },
      (_, index) => `e${index}`
    )
    lastPickedState.id = 'e1'
    selectionAdded.fire({ ids: selectionState.ids })
    markers.refresh()

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(gripPoints)
  })

  it('stops listening after dispose', () => {
    const { view, scene, selectionState, selectionAdded } = createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)
    markers.dispose()

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })

    expect(scene.setSelectionVertexMarkers).not.toHaveBeenCalled()
  })
})
