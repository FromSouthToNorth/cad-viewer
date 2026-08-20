import * as THREE from 'three'

import { AcTrBatchedGroup } from '../src/batch/AcTrBatchedGroup'
import { AcTrBatchedLine } from '../src/batch/AcTrBatchedLine'
import { buildLineGeometry } from '../src/object/AcTrLineGeometryBuilder'

function appendLine(
  group: AcTrBatchedGroup,
  objectId: string,
  fromX: number,
  material: THREE.Material
) {
  const built = buildLineGeometry(
    [
      { x: fromX, y: 0, z: 0 },
      { x: fromX + 10, y: 0, z: 0 }
    ],
    material
  )
  if (!built) {
    throw new Error('failed to build line geometry')
  }
  expect(
    group.appendLineGeometry(
      built.geometry as THREE.BufferGeometry,
      material,
      built.worldOffset,
      { objectId, visible: true }
    )
  ).toBe(true)
  built.geometry.dispose()
}

function lineBatch(group: AcTrBatchedGroup) {
  const batch = group.children.find(child => child instanceof AcTrBatchedLine)
  if (!batch) {
    throw new Error('no line batch child found')
  }
  return batch as AcTrBatchedLine
}

/** Flushes queued microtasks (the deferred compaction pass) plus one macrotask. */
function flushDeferredWork() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('AcTrBatchedGroup bulk remove', () => {
  it('coalesces compaction across many removals into one optimize pass', async () => {
    const material = new THREE.LineBasicMaterial()
    const group = new AcTrBatchedGroup()
    appendLine(group, 'a', 0, material)
    appendLine(group, 'b', 20, material)
    appendLine(group, 'c', 40, material)

    const optimizeSpy = jest.spyOn(AcTrBatchedLine.prototype, 'optimize')

    expect(group.removeEntity('a')).toBe(true)
    expect(group.removeEntity('b')).toBe(true)
    expect(group.removeEntity('c')).toBe(true)

    // Compaction is deferred: no synchronous per-entity optimize pass.
    expect(optimizeSpy).not.toHaveBeenCalled()

    await flushDeferredWork()

    expect(optimizeSpy).toHaveBeenCalledTimes(1)
    expect(group.hasEntity('a')).toBe(false)
    expect(group.hasEntity('b')).toBe(false)
    expect(group.hasEntity('c')).toBe(false)

    optimizeSpy.mockRestore()
    material.dispose()
  })

  it('uploads the highlight mask once after removing selected entities', async () => {
    const material = new THREE.LineBasicMaterial()
    const group = new AcTrBatchedGroup()
    appendLine(group, 'a', 0, material)
    appendLine(group, 'b', 20, material)
    appendLine(group, 'c', 40, material)

    group.selectMany(['a', 'b', 'c'])

    const batch = lineBatch(group)
    const uploadSpy = jest.spyOn(batch._highlightState, 'uploadMaskTexture')

    expect(group.removeEntity('a')).toBe(true)
    expect(group.removeEntity('b')).toBe(true)
    expect(group.removeEntity('c')).toBe(true)
    expect(uploadSpy).not.toHaveBeenCalled()

    await flushDeferredWork()

    // One deferred upload re-syncs the texture after the mask bits cleared.
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(batch._highlightState.selectedMask[0]).toBe(0)
    expect(batch._highlightState.hoveredMask[0]).toBe(0)

    uploadSpy.mockRestore()
    material.dispose()
  })

  it('does not leak stale highlight into a slot reused before the flush', async () => {
    const material = new THREE.LineBasicMaterial()
    const group = new AcTrBatchedGroup()
    appendLine(group, 'a', 0, material)

    group.selectMany(['a'])
    const batch = lineBatch(group)
    expect(batch._highlightState.selectedMask[0]).toBe(1)

    // Remove and immediately reuse the freed slot in the same task, before
    // the deferred compaction/upload microtask runs.
    expect(group.removeEntity('a')).toBe(true)
    appendLine(group, 'b', 50, material)

    await flushDeferredWork()

    expect(batch._highlightState.selectedMask[0]).toBe(0)
    expect(batch._highlightState.hasAnyHighlight()).toBe(false)
    expect(group.hasEntity('b')).toBe(true)

    material.dispose()
  })

  it('skips the deferred pass for batches disposed before the flush', async () => {
    const material = new THREE.LineBasicMaterial()
    const group = new AcTrBatchedGroup()
    appendLine(group, 'a', 0, material)

    const optimizeSpy = jest.spyOn(AcTrBatchedLine.prototype, 'optimize')

    expect(group.removeEntity('a')).toBe(true)
    group.clear()

    await flushDeferredWork()

    expect(optimizeSpy).not.toHaveBeenCalled()

    optimizeSpy.mockRestore()
    material.dispose()
  })
})
