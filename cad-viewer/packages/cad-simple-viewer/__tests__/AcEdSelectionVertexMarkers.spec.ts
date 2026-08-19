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

function createHarness(openMode: AcEdOpenMode = AcEdOpenMode.Read) {
  const blockTable = {
    getEntityById: jest.fn((id: string) =>
      id === 'e1' ? { subGetGripPoints: () => gripPoints } : undefined
    )
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
  const view = {
    selectionSet: {
      get ids() {
        return selectionState.ids
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
    selectionAdded,
    selectionRemoved,
    hover,
    unhover,
    blockTable
  }
}

describe('AcEdSelectionVertexMarkers', () => {
  beforeEach(() => {
    jest
      .spyOn(AcDbSysVarManager.instance(), 'getVar')
      .mockReturnValue(0)
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

    expect(scene.setSelectionVertexMarkers).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ x: 1, y: 2 })])
    )
    const calls = scene.setSelectionVertexMarkers.mock.calls
    const lastCall = calls[calls.length - 1][0]
    expect(lastCall).toHaveLength(gripPoints.length)
  })

  it('clears markers when the selection and hover sets become empty', () => {
    const { view, scene, selectionState, selectionAdded, selectionRemoved, unhover } =
      createHarness()
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

  it('stops listening after dispose', () => {
    const { view, scene, selectionState, selectionAdded } = createHarness()
    const markers = new AcEdSelectionVertexMarkers(view)
    markers.dispose()

    selectionState.ids = ['e1']
    selectionAdded.fire({ ids: ['e1'] })

    expect(scene.setSelectionVertexMarkers).not.toHaveBeenCalled()
  })
})
