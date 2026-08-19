import * as THREE from 'three'

/** Buffer attribute name storing the packed geometry slot id per vertex/instance. */
export const BATCH_SLOT_ID_ATTRIBUTE = 'slotId'

/**
 * Ensures the batch geometry owns a `slotId` float attribute with at least
 * `capacity` entries.
 *
 * @param geometry - Combined batch geometry receiving slot id attributes.
 * @param capacity - Minimum number of vertex or instance entries required.
 * @returns The existing or newly allocated `slotId` buffer attribute.
 */
export function ensureSlotIdAttribute(
  geometry: THREE.BufferGeometry,
  capacity: number
) {
  const existing = geometry.getAttribute(BATCH_SLOT_ID_ATTRIBUTE) as
    | THREE.BufferAttribute
    | undefined
  if (existing) {
    if (existing.count >= capacity) {
      return existing
    }
    const next = new THREE.Float32BufferAttribute(capacity, 1)
    next.array.set(existing.array.subarray(0, existing.count))
    geometry.setAttribute(BATCH_SLOT_ID_ATTRIBUTE, next)
    return next
  }

  const attribute = new THREE.Float32BufferAttribute(capacity, 1)
  geometry.setAttribute(BATCH_SLOT_ID_ATTRIBUTE, attribute)
  return attribute
}

/**
 * Writes one slot id across a contiguous vertex/instance range.
 *
 * @param geometry - Combined batch geometry whose `slotId` attribute is updated.
 * @param start - First vertex or instance index in the range.
 * @param count - Number of consecutive entries to write.
 * @param slotId - Packed geometry slot id stored in each entry.
 */
export function writeSlotIdRange(
  geometry: THREE.BufferGeometry,
  start: number,
  count: number,
  slotId: number
) {
  if (count <= 0) {
    return
  }

  const attribute = ensureSlotIdAttribute(geometry, start + count)
  const array = attribute.array as Float32Array
  array.fill(slotId, start, start + count)
  attribute.addUpdateRange(start, count)
  attribute.needsUpdate = true
}

/**
 * Ensures the batch geometry owns an instanced `slotId` float attribute with
 * at least `capacity` entries.
 *
 * Instanced batch drawables (`LineSegmentsGeometry`-based wide lines) must read
 * the slot id with vertex divisor 1 — a regular attribute would be indexed by
 * the base-quad vertex index and misattribute every segment to the first few
 * slots.
 *
 * @param geometry - Combined instanced batch geometry receiving slot ids.
 * @param capacity - Minimum number of instance entries required.
 * @returns The existing or newly allocated instanced `slotId` attribute.
 */
export function ensureInstancedSlotIdAttribute(
  geometry: THREE.BufferGeometry,
  capacity: number
) {
  const existing = geometry.getAttribute(BATCH_SLOT_ID_ATTRIBUTE) as
    | THREE.InstancedBufferAttribute
    | undefined
  if (existing && existing.isInstancedBufferAttribute) {
    if (existing.count >= capacity) {
      return existing
    }
    const next = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity),
      1
    )
    next.array.set(existing.array.subarray(0, existing.count))
    geometry.setAttribute(BATCH_SLOT_ID_ATTRIBUTE, next)
    return next
  }

  const attribute = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity),
    1
  )
  geometry.setAttribute(BATCH_SLOT_ID_ATTRIBUTE, attribute)
  return attribute
}

/**
 * Writes one slot id across a contiguous instance range of an instanced batch.
 *
 * @param geometry - Combined instanced batch geometry whose `slotId` is updated.
 * @param start - First instance index in the range.
 * @param count - Number of consecutive instances to write.
 * @param slotId - Packed geometry slot id stored in each entry.
 */
export function writeInstancedSlotIdRange(
  geometry: THREE.BufferGeometry,
  start: number,
  count: number,
  slotId: number
) {
  if (count <= 0) {
    return
  }

  const attribute = ensureInstancedSlotIdAttribute(geometry, start + count)
  const array = attribute.array as Float32Array
  array.fill(slotId, start, start + count)
  attribute.addUpdateRange(start, count)
  attribute.needsUpdate = true
}
