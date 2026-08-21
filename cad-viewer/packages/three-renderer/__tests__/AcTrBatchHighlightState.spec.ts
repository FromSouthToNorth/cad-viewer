import { AcTrBatchHighlightState } from '../src/batch/highlight/AcTrBatchHighlightState'

function readMaskPixel(
  state: AcTrBatchHighlightState,
  slotId: number
): { r: number; g: number } {
  const texture = state.maskTexture
  expect(texture).not.toBeNull()
  const data = texture!.image.data as Uint8Array
  const width = state.maskTextureWidth
  const x = slotId % width
  const y = Math.floor(slotId / width)
  const offset = (y * width + x) * 4
  return { r: data[offset], g: data[offset + 1] }
}

describe('AcTrBatchHighlightState dirty-range upload', () => {
  it('uploads the full mask on first use', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(3, 'select', true)
    state.setHighlight(5, 'hover', true)

    const texture = state.uploadMaskTexture()

    expect(readMaskPixel(state, 3)).toEqual({ r: 255, g: 0 })
    expect(readMaskPixel(state, 5)).toEqual({ r: 0, g: 255 })
    expect(readMaskPixel(state, 0)).toEqual({ r: 0, g: 0 })
    expect(state.dirty).toBe(false)
    expect(texture.image.data).toBeDefined()
  })

  it('rewrites only the dirty window on subsequent updates', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(0, 'select', true)
    state.setHighlight(9, 'select', true)
    state.uploadMaskTexture()

    // Mutate the persistent buffer outside the next dirty window to prove the
    // incremental pass does not touch it.
    const dataBefore = state.maskTexture!.image.data as Uint8Array
    const sentinel = dataBefore[4 * 5 + 1] // hover channel of slot 5
    expect(sentinel).toBe(0)

    state.setHighlight(1, 'select', true)
    state.setHighlight(2, 'hover', true)
    state.uploadMaskTexture()

    expect(readMaskPixel(state, 0)).toEqual({ r: 255, g: 0 })
    expect(readMaskPixel(state, 1)).toEqual({ r: 255, g: 0 })
    expect(readMaskPixel(state, 2)).toEqual({ r: 0, g: 255 })
    expect(readMaskPixel(state, 9)).toEqual({ r: 255, g: 0 })
    // Slots outside [1, 2] keep previous pixel values.
    expect(readMaskPixel(state, 5)).toEqual({ r: 0, g: 0 })
  })

  it('clears the removed highlight pixel on incremental update', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(4, 'select', true)
    state.uploadMaskTexture()
    expect(readMaskPixel(state, 4)).toEqual({ r: 255, g: 0 })

    state.setHighlight(4, 'select', false)
    state.uploadMaskTexture()
    expect(readMaskPixel(state, 4)).toEqual({ r: 0, g: 0 })
  })

  it('keeps the same pixel buffer between incremental uploads', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(0, 'select', true)
    state.uploadMaskTexture()
    const firstBuffer = state.maskTexture!.image.data

    state.setHighlight(1, 'select', true)
    state.uploadMaskTexture()
    expect(state.maskTexture!.image.data).toBe(firstBuffer)
  })

  it('reallocates and fully rewrites when the texture layout grows', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(0, 'select', true)
    state.uploadMaskTexture()
    const firstBuffer = state.maskTexture!.image.data

    // Grow addressable slot count beyond the 1-row layout.
    state.setAddressableSlotCount(5000)
    state.setHighlight(4500, 'select', true)
    state.uploadMaskTexture()

    expect(state.maskTextureHeight).toBeGreaterThan(1)
    expect(state.maskTexture!.image.data).not.toBe(firstBuffer)
    expect(readMaskPixel(state, 0)).toEqual({ r: 255, g: 0 })
    expect(readMaskPixel(state, 4500)).toEqual({ r: 255, g: 0 })
    expect(readMaskPixel(state, 3000)).toEqual({ r: 0, g: 0 })
  })

  it('rewrites every pixel when forced', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(0, 'select', true)
    state.uploadMaskTexture()
    const firstBuffer = state.maskTexture!.image.data
    const data = firstBuffer as Uint8Array
    // Corrupt the buffer behind the state's back.
    data[4 * 7] = 255

    const texture = state.uploadMaskTexture(true)
    expect(texture.image.data).toBe(firstBuffer)
    expect(readMaskPixel(state, 7)).toEqual({ r: 0, g: 0 })
  })

  it('clears every pixel after clearAll uploads', () => {
    const state = new AcTrBatchHighlightState()
    state.setHighlight(2, 'select', true)
    state.setHighlight(6, 'hover', true)
    state.uploadMaskTexture()

    state.clearAll()
    state.uploadMaskTexture()

    expect(readMaskPixel(state, 2)).toEqual({ r: 0, g: 0 })
    expect(readMaskPixel(state, 6)).toEqual({ r: 0, g: 0 })
  })
})
