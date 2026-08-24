import { MTextData, TextStyle } from '@mlightcad/mtext-renderer'
import * as THREE from 'three'

const mockAsyncRenderMText = jest.fn()
const mockSyncRenderMText = jest.fn()

const mockFontLoadedListeners: Array<() => void> = []
const mockFontLoaded = {
  addEventListener: jest.fn((listener: () => void) => {
    mockFontLoadedListeners.push(listener)
  })
}

const mockUnifiedRenderer = jest.fn().mockImplementation(() => ({
  setFontUrl: jest.fn(),
  setDefaultMode: jest.fn(),
  setDefaultFonts: jest.fn(() => Promise.resolve()),
  setLazyFontLoading: jest.fn(() => Promise.resolve()),
  setAwaitFontsBeforeDraw: jest.fn(() => Promise.resolve()),
  setStyleManager: jest.fn(),
  destroy: jest.fn(),
  estimateMemoryUsage: jest.fn(),
  asyncRenderMText: mockAsyncRenderMText,
  syncRenderMText: mockSyncRenderMText
}))

jest.mock('@mlightcad/mtext-renderer', () => ({
  UnifiedRenderer: mockUnifiedRenderer,
  createDefaultColorSettings: jest.fn(() => ({
    byLayerColor: 0xffffff,
    byBlockColor: 0xffffff,
    color: { aci: 256 }
  })),
  FontManager: {
    instance: {
      lazyFontLoading: false,
      awaitFontsBeforeDraw: false,
      events: {
        fontLoaded: mockFontLoaded,
        fontNotFound: { addEventListener: jest.fn() }
      },
      estimateMemoryUsage: jest.fn()
    }
  }
}))

import { AcTrMTextRenderer } from '../src/renderer/AcTrMTextRenderer'

const style: TextStyle = {
  name: 'Standard',
  standardFlag: 0,
  fixedTextHeight: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  textGenerationFlag: 0,
  lastHeight: 2.5,
  font: 'arial.ttf',
  bigFont: 'gbcbig.shx'
}

function createContent(
  text: string,
  position = { x: 0, y: 0, z: 0 }
): MTextData {
  return { text, height: 2.5, width: 0, position }
}

function installRenderMock(mock: jest.Mock) {
  mock.mockImplementation((content: MTextData) => {
    const root = new THREE.Group()
    root.position.set(content.position.x, content.position.y, content.position.z)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    )
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
    root.userData.logicalBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    ;(root as unknown as { box: THREE.Box3 }).box = new THREE.Box3()
    return root
  })
}

describe('AcTrMTextRenderer content-level glyph cache', () => {
  beforeEach(() => {
    ;(AcTrMTextRenderer as unknown as { _instance: unknown })._instance = null
    mockAsyncRenderMText.mockReset()
    mockSyncRenderMText.mockReset()
    mockFontLoaded.addEventListener.mockClear()
    mockFontLoadedListeners.length = 0
    installRenderMock(mockAsyncRenderMText)
    installRenderMock(mockSyncRenderMText)
  })

  it('promotes a repeating key on second use and serves clones afterward', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')

    const first = await renderer.asyncRenderMText(
      createContent('abc', { x: 0, y: 0, z: 0 }),
      style
    )
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(1)
    expect(first.position.x).toBe(0)

    const second = await renderer.asyncRenderMText(
      createContent('abc', { x: 10, y: 20, z: 0 }),
      style
    )
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(2)
    expect(second.position.x).toBe(10)

    const third = await renderer.asyncRenderMText(
      createContent('abc', { x: 99, y: 0, z: 0 }),
      style
    )
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(2)
    expect(third.position.x).toBe(99)
    expect(renderer.getContentGlyphCacheStats().count).toBe(1)
  })

  it('serves sync renders through the same cache', () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')

    renderer.syncRenderMText(createContent('sync', { x: 1, y: 1, z: 0 }), style)
    renderer.syncRenderMText(createContent('sync', { x: 2, y: 2, z: 0 }), style)
    const third = renderer.syncRenderMText(
      createContent('sync', { x: 3, y: 3, z: 0 }),
      style
    )

    expect(mockSyncRenderMText).toHaveBeenCalledTimes(2)
    expect(third.position.x).toBe(3)
  })

  it('never renders through the cache twice for unique content', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')

    const first = await renderer.asyncRenderMText(
      createContent('unique-a'),
      style
    )
    const second = await renderer.asyncRenderMText(
      createContent('unique-b'),
      style
    )

    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(2)
    expect(first.position.x).toBe(0)
    expect(second.position.x).toBe(0)
    expect(renderer.getContentGlyphCacheStats().count).toBe(0)
  })

  it('bypasses the cache entirely when disabled', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')
    renderer.setContentGlyphCacheEnabled(false)

    await renderer.asyncRenderMText(createContent('off'), style)
    await renderer.asyncRenderMText(createContent('off'), style)

    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(2)
    expect(renderer.getContentGlyphCacheStats().count).toBe(0)
  })

  it('drops cached templates when a font finishes loading', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')
    expect(mockFontLoadedListeners).toHaveLength(1)

    const content = createContent('fallback-font-label')
    await renderer.asyncRenderMText(content, style)
    await renderer.asyncRenderMText(content, style)
    await renderer.asyncRenderMText(content, style)
    expect(renderer.getContentGlyphCacheStats().count).toBe(1)

    mockFontLoadedListeners[0]()

    expect(renderer.getContentGlyphCacheStats().count).toBe(0)
    await renderer.asyncRenderMText(content, style)
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(3)
  })

  it('coalesces concurrent same-key requests into one worker round trip', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')

    // Issued without awaiting: the second call must join the first one's
    // in-flight render instead of posting its own layout request.
    const first = renderer.asyncRenderMText(
      createContent('burst-label', { x: 0, y: 0, z: 0 }),
      style
    )
    const second = renderer.asyncRenderMText(
      createContent('burst-label', { x: 10, y: 20, z: 0 }),
      style
    )
    const [a, b] = await Promise.all([first, second])

    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(1)
    expect(a.position.x).toBe(0)
    expect(b.position.x).toBe(10)
    expect(renderer.getContentGlyphCacheStats().count).toBe(1)

    // A later sequential call is served from the cache without a new render.
    const third = await renderer.asyncRenderMText(
      createContent('burst-label', { x: 99, y: 0, z: 0 }),
      style
    )
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(1)
    expect(third.position.x).toBe(99)
  })

  it('cleans up in-flight state when a shared render rejects', async () => {
    const renderer = AcTrMTextRenderer.getInstance()
    renderer.initialize('worker.js')
    mockAsyncRenderMText.mockRejectedValueOnce(new Error('layout failed'))

    const first = renderer.asyncRenderMText(createContent('fail-label'), style)
    const second = renderer.asyncRenderMText(createContent('fail-label'), style)
    await expect(first).rejects.toThrow('layout failed')
    await expect(second).rejects.toThrow('layout failed')

    // The next request starts a fresh render (no stale in-flight entry).
    const recovered = await renderer.asyncRenderMText(
      createContent('fail-label'),
      style
    )
    expect(recovered).toBeDefined()
    expect(mockAsyncRenderMText).toHaveBeenCalledTimes(2)
    expect(renderer.getContentGlyphCacheStats().count).toBe(0)
  })
})
