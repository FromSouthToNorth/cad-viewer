import {
  AcGeArea2d,
  AcGePoint3dLike,
  AcGiSubEntityTraits
} from '@mlightcad/data-model'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { AcTrRenderContext } from '../renderer/AcTrRenderContext'
import { RTE_REBASE_THRESHOLD } from '../draw/AcTrBatchDrawPolicy'
import { AcTrBufferGeometryUtil } from '../util'
import { AcTrPolygon } from './AcTrPolygon'

/** Which batch container the built line geometry should append into. */
export type AcTrLineGeometryKind = 'basic' | 'fat'

/** Entity kind for generalized direct-batch metadata. */
export type AcTrDirectEntityKind = 'lineBasic' | 'lineFat' | 'point' | 'mesh'

/**
 * Local-space geometry ready for {@link AcTrBatchedGroup} append or
 * wrapping in an {@link AcTrLine} drawable.
 */
export interface AcTrBuiltLineGeometry {
  kind: AcTrLineGeometryKind
  geometry: THREE.BufferGeometry | LineSegmentsGeometry
  worldOffset: THREE.Vector3
  wcsBbox: THREE.Box3
  material: THREE.Material
}

/** Built geometry for any direct-batch entity kind. */
export interface AcTrBuiltDirectGeometry {
  kind: AcTrDirectEntityKind
  geometry: THREE.BufferGeometry | LineSegmentsGeometry
  worldOffset: THREE.Vector3
  wcsBbox: THREE.Box3
  material: THREE.Material
  /** Point entities only — world position for bbox intersection. */
  position?: AcGePoint3dLike
}

/** Generalized direct-batch entity metadata (line, point, mesh). */
export interface AcTrDirectEntityMeta extends AcTrBuiltDirectGeometry {
  objectId: string
  ownerId: string
  layerName: string
  visible: boolean
}

const _point = /*@__PURE__*/ new THREE.Vector3()
const _originDelta = /*@__PURE__*/ new THREE.Vector3()
const _dummyDisposeMaterial = /*@__PURE__*/ new THREE.MeshBasicMaterial()

/**
 * Interleaved vertex attribute data accepted by line-segment builders.
 * `Float64Array` inputs keep double precision until the local-space rebase,
 * so world-scale coordinates are not quantized before subtraction.
 */
export type AcTrLineSegmentsArray = Float32Array | Float64Array

/**
 * Returns true for pattern-linetype shader materials that cannot direct-batch.
 * {@link LineMaterial} (wide lines) is allowed.
 *
 * @param material - Material resolved for the entity draw.
 * @returns `true` when the material is a non-`LineMaterial` shader and must
 *   fall back to the legacy drawable path.
 */
export function isDirectBatchRejectedMaterial(material: THREE.Material): boolean {
  return (
    material instanceof THREE.ShaderMaterial && !(material instanceof LineMaterial)
  )
}

/**
 * Builds rebased line geometry from world-space points and a resolved material.
 *
 * Vertices are stored relative to the point-cloud bounding-box center
 * (`worldOffset`) so float32 batch buffers stay precise. Fat lines
 * (`LineMaterial`) produce `LineSegmentsGeometry`; all other materials produce
 * indexed `BufferGeometry` for `THREE.LineSegments`.
 *
 * @param points - World-space polyline vertices (at least two).
 * @param material - Resolved line material; `LineMaterial` selects fat geometry.
 * @returns Built local-space geometry, or `null` when fewer than two points
 *   are provided.
 */
export function buildLineGeometry(
  points: AcGePoint3dLike[],
  material: THREE.Material
): AcTrBuiltLineGeometry | null {
  if (points.length < 2) {
    return null
  }

  const worldOffset = computeLocalOrigin(points)
  const maxVertexCount = points.length

  const wcsBbox = computeWcsBboxFromPoints(points)

  if (material instanceof LineMaterial) {
    const segmentPositions = new Float32Array((maxVertexCount - 1) * 6)
    for (let i = 0, pos = 0; i < maxVertexCount - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      segmentPositions[pos++] = p1.x - worldOffset.x
      segmentPositions[pos++] = p1.y - worldOffset.y
      segmentPositions[pos++] = (p1.z ?? 0) - worldOffset.z
      segmentPositions[pos++] = p2.x - worldOffset.x
      segmentPositions[pos++] = p2.y - worldOffset.y
      segmentPositions[pos++] = (p2.z ?? 0) - worldOffset.z
    }

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(segmentPositions)
    AcTrBufferGeometryUtil.safeComputeBoundingBox(
      geometry as unknown as THREE.BufferGeometry
    )
    AcTrBufferGeometryUtil.safeComputeBoundingSphere(
      geometry as unknown as THREE.BufferGeometry
    )
    return {
      kind: 'fat',
      geometry,
      worldOffset,
      wcsBbox,
      material
    }
  }

  const vertices = new Float32Array(maxVertexCount * 3)
  const indices =
    maxVertexCount * 2 > 65535
      ? new Uint32Array(maxVertexCount * 2)
      : new Uint16Array(maxVertexCount * 2)

  for (let i = 0, pos = 0; i < maxVertexCount; i++) {
    const point = points[i]
    vertices[pos++] = point.x - worldOffset.x
    vertices[pos++] = point.y - worldOffset.y
    vertices[pos++] = (point.z ?? 0) - worldOffset.z
  }
  for (let i = 0, pos = 0; i < maxVertexCount - 1; i++) {
    indices[pos++] = i
    indices[pos++] = i + 1
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  return {
    kind: 'basic',
    geometry,
    worldOffset,
    wcsBbox,
    material
  }
}

/**
 * Builds rebased single-vertex point geometry for {@link AcTrBatchedPoint}.
 *
 * The position attribute is a single `(0,0,0)` vertex; the world location is
 * carried by `worldOffset` / `position` so batch float32 buffers stay precise.
 *
 * @param point - World-space point location.
 * @param material - Resolved point material.
 * @returns Built point geometry with a tiny WCS bbox around `point`.
 */
export function buildPointGeometry(
  point: AcGePoint3dLike,
  material: THREE.Material
): AcTrBuiltDirectGeometry {
  const worldOffset = new THREE.Vector3(point.x, point.y, point.z ?? 0)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0], 3)
  )
  const epsilon = 1e-6
  const z = point.z ?? 0
  const wcsBbox = new THREE.Box3(
    new THREE.Vector3(point.x - epsilon, point.y - epsilon, z - epsilon),
    new THREE.Vector3(point.x + epsilon, point.y + epsilon, z + epsilon)
  )
  return {
    kind: 'point',
    geometry,
    worldOffset,
    wcsBbox,
    material,
    position: point
  }
}

/**
 * Builds rebased mesh geometry from a solid or gradient hatch area.
 *
 * Patterned hatches (definition lines without gradient) return `null`.
 * A temporary {@link AcTrPolygon} is built and disposed; mesh materials from
 * the style manager are preserved by swapping dummy geometry/material first.
 *
 * @param area - Filled/hatched 2-D area in drawing coordinates.
 * @param traits - Sub-entity traits used for fill style and material lookup.
 * @param context - Render context providing the style manager.
 * @returns Built mesh geometry ready for direct batch append, or `null` when
 *   the hatch is patterned, empty, or merge/bbox computation fails.
 */
export function buildAreaGeometry(
  area: AcGeArea2d,
  traits: AcGiSubEntityTraits,
  context: AcTrRenderContext
): AcTrBuiltDirectGeometry | null {
  const style = traits.fillType
  if (!style.gradient && !!style.definitionLines?.length) {
    return null
  }

  const polygon = new AcTrPolygon(area, traits, context)
  const meshGeometries: THREE.BufferGeometry[] = []
  let meshPosition: THREE.Vector3 | undefined
  let resolvedMaterial: THREE.Material | undefined

  polygon.traverse(object => {
    if (object instanceof THREE.Mesh && object.geometry) {
      meshGeometries.push(object.geometry.clone())
      meshPosition = object.position.clone()
      if (!resolvedMaterial && object.material instanceof THREE.Material) {
        resolvedMaterial = object.material
      }
    }
  })

  polygon.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry = new THREE.BufferGeometry()
      object.material = _dummyDisposeMaterial
    }
  })
  polygon.dispose()

  if (meshGeometries.length === 0) {
    return null
  }

  let geometry: THREE.BufferGeometry
  if (meshGeometries.length === 1) {
    geometry = meshGeometries[0]
  } else {
    const merged = mergeGeometries(meshGeometries)
    if (!merged) {
      meshGeometries.forEach(item => item.dispose())
      return null
    }
    geometry = merged
    meshGeometries.forEach(item => item.dispose())
  }

  const boundingBox = AcTrBufferGeometryUtil.safeComputeBoundingBox(geometry)
  if (!boundingBox || boundingBox.isEmpty()) {
    geometry.dispose()
    return null
  }

  // AcTrPolygon geometry is anchor-local; the mesh position restores the WCS
  // placement. Rebase only by the residual (worldOffset - meshPosition) so
  // double rebasing cannot reintroduce world-scale float32 magnitudes.
  const wcsBbox = boundingBox.clone()
  if (meshPosition) {
    wcsBbox.translate(meshPosition)
  }
  const worldOffset = wcsBbox.getCenter(new THREE.Vector3())
  if (meshPosition) {
    rebaseGeometryPositions(
      geometry,
      _originDelta.copy(worldOffset).sub(meshPosition)
    )
  } else {
    rebaseGeometryPositions(geometry, worldOffset)
  }

  const gradientBounds = {
    minX: wcsBbox.min.x,
    minY: wcsBbox.min.y,
    maxX: wcsBbox.max.x,
    maxY: wcsBbox.max.y
  }
  const material =
    resolvedMaterial ??
    context.styleManager.getFillMaterial(traits, undefined, gradientBounds)

  return {
    kind: 'mesh',
    geometry,
    worldOffset,
    wcsBbox,
    material
  }
}

/**
 * Builds rebased line-segment geometry from packed vertex/index buffers.
 *
 * Filters out degenerate `(0,0)` index pairs, rebases positions to the
 * vertex-cloud bbox center, and selects fat (`lineFat`) or basic
 * (`lineBasic`) output based on whether `material` is a {@link LineMaterial}.
 *
 * @param array - Interleaved vertex attribute data (positions and optional
 *   extra components).
 * @param itemSize - Components per vertex in `array` (at least 3 for xyz).
 * @param indices - Index buffer pairing vertices into line segments.
 * @param material - Resolved line material; pattern shaders are rejected.
 * @param allowNonBatchableMaterial - Keep pattern shader materials instead of
 *   returning `null`. Used by the legacy drawable path, which renders these
 *   as unbatched clones with per-object uniforms.
 * @returns Built local-space geometry, or `null` for pattern shader materials
 *   or when no valid segments / bbox remain.
 */
export function buildLineSegmentsGeometry(
  array: AcTrLineSegmentsArray,
  itemSize: number,
  indices: Uint16Array,
  material: THREE.Material,
  allowNonBatchableMaterial: boolean = false
): AcTrBuiltDirectGeometry | null {
  if (!allowNonBatchableMaterial && isDirectBatchRejectedMaterial(material)) {
    return null
  }

  const filteredIndices: number[] = []
  for (let i = 0; i < indices.length; i += 2) {
    const i1 = indices[i]
    const i2 = indices[i + 1]
    if (i1 === 0 && i2 === 0) {
      continue
    }
    filteredIndices.push(i1, i2)
  }
  if (filteredIndices.length < 2) {
    return null
  }

  const box = new THREE.Box3()
  for (let i = 0; i < array.length; i += itemSize) {
    box.expandByPoint(_point.set(array[i], array[i + 1], array[i + 2] ?? 0))
  }
  if (box.isEmpty()) {
    return null
  }

  const worldOffset = box.getCenter(new THREE.Vector3())
  const wcsBbox = box.clone()

  if (material instanceof LineMaterial) {
    const segmentCount = filteredIndices.length / 2
    const segmentPositions = new Float32Array(segmentCount * 6)
    for (let i = 0, pos = 0; i < segmentCount; i++) {
      const i1 = filteredIndices[i * 2]
      const i2 = filteredIndices[i * 2 + 1]
      const base1 = i1 * itemSize
      const base2 = i2 * itemSize
      segmentPositions[pos++] = array[base1] - worldOffset.x
      segmentPositions[pos++] = array[base1 + 1] - worldOffset.y
      segmentPositions[pos++] = (array[base1 + 2] ?? 0) - worldOffset.z
      segmentPositions[pos++] = array[base2] - worldOffset.x
      segmentPositions[pos++] = array[base2 + 1] - worldOffset.y
      segmentPositions[pos++] = (array[base2 + 2] ?? 0) - worldOffset.z
    }

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(segmentPositions)
    AcTrBufferGeometryUtil.safeComputeBoundingBox(
      geometry as unknown as THREE.BufferGeometry
    )
    AcTrBufferGeometryUtil.safeComputeBoundingSphere(
      geometry as unknown as THREE.BufferGeometry
    )
    return {
      kind: 'lineFat',
      geometry,
      worldOffset,
      wcsBbox,
      material
    }
  }

  const rebased = new Float32Array(array.length)
  for (let i = 0; i < array.length; i += itemSize) {
    rebased[i] = array[i] - worldOffset.x
    rebased[i + 1] = array[i + 1] - worldOffset.y
    rebased[i + 2] = (array[i + 2] ?? 0) - worldOffset.z
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(rebased, itemSize)
  )
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint16Array(filteredIndices), 1)
  )

  return {
    kind: 'lineBasic',
    geometry,
    worldOffset,
    wcsBbox,
    material
  }
}

/**
 * Subtracts `worldOffset` from every position attribute vertex in place and
 * refreshes the geometry bounding box / sphere.
 *
 * Used after merging hatch mesh geometries so the returned buffer is local to
 * the WCS bbox center (matching other direct-batch builders).
 *
 * @param geometry - Buffer whose `position` attribute is rewritten.
 * @param worldOffset - World-space origin to subtract from each vertex.
 */
function rebaseGeometryPositions(
  geometry: THREE.BufferGeometry,
  worldOffset: THREE.Vector3
) {
  const position = geometry.getAttribute('position')
  if (!position) {
    return
  }
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) - worldOffset.x,
      position.getY(i) - worldOffset.y,
      position.getZ(i) - worldOffset.z
    )
  }
  position.needsUpdate = true
  AcTrBufferGeometryUtil.safeComputeBoundingBox(geometry)
  AcTrBufferGeometryUtil.safeComputeBoundingSphere(geometry)
}

/**
 * Maximum per-axis world extent of one rebased sub-run or segment cluster.
 *
 * Runs whose per-axis extent stays at or below this value keep every float32
 * vertex within a magnitude whose ulp is ≤ 0.0625 world units. Entities that
 * span the whole drawing (e.g. Gauss-Krüger survey lines crossing 39.5M
 * units) are split into several runs so their far vertices no longer land
 * ±1-2 units away from their true position after the center rebase.
 */
const LINE_REBASE_SPLIT_EXTENT = RTE_REBASE_THRESHOLD

/** Longest allowed per-axis step between consecutive polyline vertices. */
const MAX_VERTEX_STEP = LINE_REBASE_SPLIT_EXTENT / 2

/**
 * Inserts linearly interpolated midpoints so consecutive points never step
 * farther than {@link MAX_VERTEX_STEP} along any axis.
 *
 * The added points lie on the original segments, so the polyline is visually
 * unchanged while every vertex stays close enough to a run origin for precise
 * float32 storage.
 *
 * @param points - World-space polyline vertices (at least two).
 * @returns The subdivided vertex sequence, including all original points.
 */
export function subdivideLongSteps(
  points: AcGePoint3dLike[]
): AcGePoint3dLike[] {
  const out: AcGePoint3dLike[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i > 0) {
      const prev = out[out.length - 1]
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      const dz = (p.z ?? 0) - (prev.z ?? 0)
      const step = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
      const pieces = Math.ceil(step / MAX_VERTEX_STEP)
      for (let s = 1; s < pieces; s++) {
        const t = s / pieces
        out.push({
          x: prev.x + dx * t,
          y: prev.y + dy * t,
          z: (prev.z ?? 0) + dz * t
        })
      }
    }
    out.push(p)
  }
  return out
}

/**
 * Splits a point sequence into consecutive runs whose per-axis bounding-box
 * extent stays within {@link LINE_REBASE_SPLIT_EXTENT}.
 *
 * The last point of each run is repeated as the first point of the next run so
 * the polyline remains connected across run boundaries.
 *
 * @param points - Polyline vertices, ideally pre-subdivided by
 *   {@link subdivideLongSteps}.
 * @returns One or more consecutive runs, each with at least two points.
 */
export function splitPointRuns(points: AcGePoint3dLike[]): AcGePoint3dLike[][] {
  if (points.length < 2) {
    return []
  }
  const runs: AcGePoint3dLike[][] = []
  let run: AcGePoint3dLike[] = [points[0]]
  let minX = points[0].x
  let maxX = points[0].x
  let minY = points[0].y
  let maxY = points[0].y
  let minZ = points[0].z ?? 0
  let maxZ = points[0].z ?? 0

  const extent = (nMinX: number, nMaxX: number, nMinY: number, nMaxY: number, nMinZ: number, nMaxZ: number) =>
    Math.max(nMaxX - nMinX, nMaxY - nMinY, nMaxZ - nMinZ)

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const z = p.z ?? 0
    let nMinX = Math.min(minX, p.x)
    let nMaxX = Math.max(maxX, p.x)
    let nMinY = Math.min(minY, p.y)
    let nMaxY = Math.max(maxY, p.y)
    let nMinZ = Math.min(minZ, z)
    let nMaxZ = Math.max(maxZ, z)

    if (
      run.length >= 2 &&
      extent(nMinX, nMaxX, nMinY, nMaxY, nMinZ, nMaxZ) >
        LINE_REBASE_SPLIT_EXTENT
    ) {
      runs.push(run)
      const prev = points[i - 1]
      run = [prev]
      minX = maxX = prev.x
      minY = maxY = prev.y
      minZ = maxZ = prev.z ?? 0
      // Re-probe against the fresh run so its extent reflects only its own points.
      nMinX = Math.min(minX, p.x)
      nMaxX = Math.max(maxX, p.x)
      nMinY = Math.min(minY, p.y)
      nMaxY = Math.max(maxY, p.y)
      nMinZ = Math.min(minZ, z)
      nMaxZ = Math.max(maxZ, z)
    }

    run.push(p)
    minX = nMinX
    maxX = nMaxX
    minY = nMinY
    maxY = nMaxY
    minZ = nMinZ
    maxZ = nMaxZ
  }
  runs.push(run)
  return runs
}

/**
 * Builds rebased line geometry for a polyline that may span beyond the
 * precision-safe extent, splitting it into several independently rebased runs.
 *
 * Each returned item is local to its own `worldOffset` (the run's bbox
 * center), keeping float32 vertex magnitudes below
 * {@link LINE_REBASE_SPLIT_EXTENT} even for entities crossing the entire
 * drawing. Batch containers resolve per-item origins, so every run lands in a
 * container whose origin is close to it.
 *
 * @param points - World-space polyline vertices (at least two).
 * @param material - Resolved line material; `LineMaterial` selects fat geometry.
 * @returns Local-space geometries for every run, or an empty array when fewer
 *   than two points are provided.
 */
export function buildLineGeometryMulti(
  points: AcGePoint3dLike[] | Float64Array,
  material: THREE.Material
): AcTrBuiltLineGeometry[] {
  if (points instanceof Float64Array) {
    return buildFlatLineGeometryMulti(points, material)
  }
  if (points.length < 2) {
    return []
  }
  const runs = splitPointRuns(subdivideLongSteps(points))
  const results: AcTrBuiltLineGeometry[] = []
  for (const run of runs) {
    const built = buildLineGeometry(run, material)
    if (built) {
      results.push(built)
    }
  }
  return results
}

/**
 * True when the flat strip would require long-step subdivision or rebase run
 * splitting in the object pipeline (mirrors {@link subdivideLongSteps} and
 * {@link splitPointRuns} thresholds).
 */
function flatNeedsSubdivideOrSplit(flat: Float64Array): boolean {
  const vertexCount = flat.length / 3
  let minX = flat[0]!
  let maxX = flat[0]!
  let minY = flat[1]!
  let maxY = flat[1]!
  let minZ = flat[2]!
  let maxZ = flat[2]!
  for (let i = 1; i < vertexCount; i++) {
    const i3 = i * 3
    const x = flat[i3]!
    const y = flat[i3 + 1]!
    const z = flat[i3 + 2]!
    const step = Math.max(
      Math.abs(x - flat[i3 - 3]!),
      Math.abs(y - flat[i3 - 2]!),
      Math.abs(z - flat[i3 - 1]!)
    )
    if (step > MAX_VERTEX_STEP) {
      return true
    }
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return (
    Math.max(maxX - minX, maxY - minY, maxZ - minZ) > LINE_REBASE_SPLIT_EXTENT
  )
}

/**
 * Builds rebased line geometry from interleaved xyz `Float64Array` vertices
 * without materializing per-point objects (arc/ellipse densification path).
 *
 * Behavior mirrors {@link buildLineGeometryMulti} for the common case of a
 * single precision-safe run: same bbox-center rebase, same indexed (or fat
 * segment) layout. Strips needing long-step subdivision or rebase splitting
 * (huge-coordinate arcs) fall back to the object pipeline so the rare path
 * keeps identical output.
 */
export function buildFlatLineGeometryMulti(
  flat: Float64Array,
  material: THREE.Material
): AcTrBuiltLineGeometry[] {
  const vertexCount = flat.length / 3
  if (vertexCount < 2) {
    return []
  }
  if (flatNeedsSubdivideOrSplit(flat)) {
    // Rare: radii/coordinates beyond the precision-safe extents. Reuse the
    // object pipeline for identical subdivision + run-splitting behavior.
    const points: AcGePoint3dLike[] = new Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3
      points[i] = { x: flat[i3]!, y: flat[i3 + 1]!, z: flat[i3 + 2]! }
    }
    return buildLineGeometryMulti(points, material)
  }

  const box = new THREE.Box3()
  for (let i = 0; i < vertexCount; i++) {
    const i3 = i * 3
    box.expandByPoint(_point.set(flat[i3]!, flat[i3 + 1]!, flat[i3 + 2]!))
  }
  const worldOffset = box.getCenter(new THREE.Vector3())

  if (material instanceof LineMaterial) {
    const segmentPositions = new Float32Array((vertexCount - 1) * 6)
    for (let i = 0, pos = 0; i < vertexCount - 1; i++) {
      const i3 = i * 3
      segmentPositions[pos++] = flat[i3]! - worldOffset.x
      segmentPositions[pos++] = flat[i3 + 1]! - worldOffset.y
      segmentPositions[pos++] = flat[i3 + 2]! - worldOffset.z
      segmentPositions[pos++] = flat[i3 + 3]! - worldOffset.x
      segmentPositions[pos++] = flat[i3 + 4]! - worldOffset.y
      segmentPositions[pos++] = flat[i3 + 5]! - worldOffset.z
    }
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(segmentPositions)
    AcTrBufferGeometryUtil.safeComputeBoundingBox(
      geometry as unknown as THREE.BufferGeometry
    )
    AcTrBufferGeometryUtil.safeComputeBoundingSphere(
      geometry as unknown as THREE.BufferGeometry
    )
    return [{ kind: 'fat', geometry, worldOffset, wcsBbox: box, material }]
  }

  const vertices = new Float32Array(vertexCount * 3)
  const indices =
    vertexCount * 2 > 65535
      ? new Uint32Array(vertexCount * 2)
      : new Uint16Array(vertexCount * 2)
  for (let i = 0, pos = 0; i < vertexCount; i++) {
    const i3 = i * 3
    vertices[pos++] = flat[i3]! - worldOffset.x
    vertices[pos++] = flat[i3 + 1]! - worldOffset.y
    vertices[pos++] = flat[i3 + 2]! - worldOffset.z
  }
  for (let i = 0, pos = 0; i < vertexCount - 1; i++) {
    indices[pos++] = i
    indices[pos++] = i + 1
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return [{ kind: 'basic', geometry, worldOffset, wcsBbox: box, material }]
}

/** One cluster of subdivided, precision-safe line segments. */
export interface AcTrSegmentCluster {
  /** Interleaved vertex components (itemSize per vertex), double precision. */
  array: Float64Array
  /** Index pairs referencing {@link array} vertices, degenerate pairs removed. */
  indices: Uint16Array
}

/**
 * Subdivides long segments with interpolated midpoints and groups the result
 * into clusters whose per-axis extent stays within
 * {@link LINE_REBASE_SPLIT_EXTENT}.
 *
 * Each cluster carries its own interleaved vertex buffer with remapped
 * indices, ready for {@link buildLineSegmentsGeometry}. Vertices are
 * duplicated per segment rather than deduplicated — line segments are drawn
 * independently, so this only costs a little memory.
 *
 * @param array - Interleaved vertex data (positions and optional components).
 * @param itemSize - Components per vertex in `array` (at least 3 for xyz).
 * @param indices - Index buffer pairing vertices into line segments.
 * @returns Precision-safe segment clusters; empty when no valid segments exist.
 */
export function splitLineSegmentsClusters(
  array: AcTrLineSegmentsArray,
  itemSize: number,
  indices: Uint16Array
): AcTrSegmentCluster[] {
  // Pass 0: count subdivided vertices/segments so the typed buffers below can
  // be sized exactly up front (no number[] accumulation, no from() copies).
  let totalSegments = 0
  let validCount = 0
  for (let s = 0; s < indices.length; s += 2) {
    const v1 = indices[s]!
    const v2 = indices[s + 1]!
    if (v1 === 0 && v2 === 0) {
      continue
    }
    const b1 = v1 * itemSize
    const b2 = v2 * itemSize
    const step = Math.max(
      Math.abs(array[b1]! - array[b2]!),
      Math.abs(array[b1 + 1]! - array[b2 + 1]!),
      Math.abs((array[b1 + 2] ?? 0) - (array[b2 + 2] ?? 0))
    )
    totalSegments += Math.ceil(step / MAX_VERTEX_STEP)
    validCount++
  }
  if (totalSegments === 0) {
    return []
  }

  // Pass 1: subdivide long segments into flat vertices + per-segment pairs.
  const subVertCount = totalSegments + validCount
  const verts = new Float64Array(subVertCount * itemSize)
  const subIndices =
    subVertCount > 65535
      ? new Uint32Array(totalSegments * 2)
      : new Uint16Array(totalSegments * 2)
  let vertPos = 0
  let subPos = 0

  const appendVertex = (vi: number): number => {
    const base = vi * itemSize
    for (let c = 0; c < itemSize; c++) {
      verts[vertPos++] = array[base + c]!
    }
    return vertPos / itemSize - 1
  }

  for (let s = 0; s < indices.length; s += 2) {
    const v1 = indices[s]!
    const v2 = indices[s + 1]!
    if (v1 === 0 && v2 === 0) {
      continue
    }
    const b1 = v1 * itemSize
    const b2 = v2 * itemSize
    const step = Math.max(
      Math.abs(array[b1]! - array[b2]!),
      Math.abs(array[b1 + 1]! - array[b2 + 1]!),
      Math.abs((array[b1 + 2] ?? 0) - (array[b2 + 2] ?? 0))
    )
    const pieces = Math.ceil(step / MAX_VERTEX_STEP)
    if (pieces <= 1) {
      subIndices[subPos++] = appendVertex(v1)
      subIndices[subPos++] = appendVertex(v2)
      continue
    }
    let prev = appendVertex(v1)
    for (let p = 1; p < pieces; p++) {
      const t = p / pieces
      const mid = vertPos / itemSize
      for (let c = 0; c < itemSize; c++) {
        verts[vertPos++] =
          array[b1 + c]! + (array[b2 + c]! - array[b1 + c]!) * t
      }
      subIndices[subPos++] = prev
      subIndices[subPos++] = mid
      prev = mid
    }
    subIndices[subPos++] = prev
    subIndices[subPos++] = appendVertex(v2)
  }

  // Pass 2: cluster consecutive segments by per-axis bbox extent. All clusters
  // are subarray views over shared buffers — no per-cluster allocation.
  const clusters: AcTrSegmentCluster[] = []
  const outArray = new Float64Array(totalSegments * 2 * itemSize)
  const outIndices = new Uint16Array(totalSegments * 2)
  let clusterArrayStart = -1
  let clusterIdxStart = 0
  let outArrayPos = 0
  let outIdxPos = 0
  let minX = 0
  let minY = 0
  let minZ = 0
  let maxX = 0
  let maxY = 0
  let maxZ = 0

  const startCluster = () => {
    clusterArrayStart = outArrayPos
    clusterIdxStart = outIdxPos
    minX = minY = minZ = Infinity
    maxX = maxY = maxZ = -Infinity
  }
  const extendByVertex = (vi: number) => {
    const base = vi * itemSize
    const x = verts[base]!
    const y = verts[base + 1]!
    const z = verts[base + 2] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const exceedsExtent = (
    nMinX: number, nMaxX: number, nMinY: number, nMaxY: number, nMinZ: number, nMaxZ: number
  ) =>
    Math.max(nMaxX - nMinX, nMaxY - nMinY, nMaxZ - nMinZ) >
    LINE_REBASE_SPLIT_EXTENT

  const pushCluster = () => {
    clusters.push({
      array: outArray.subarray(clusterArrayStart, outArrayPos),
      indices: outIndices.subarray(clusterIdxStart, outIdxPos)
    })
  }

  for (let s = 0; s < subPos; s += 2) {
    const i1 = subIndices[s]!
    const i2 = subIndices[s + 1]!
    if (clusterArrayStart < 0) {
      startCluster()
    }
    const b1 = i1 * itemSize
    const b2 = i2 * itemSize
    const nMinX = Math.min(minX, verts[b1]!, verts[b2]!)
    const nMaxX = Math.max(maxX, verts[b1]!, verts[b2]!)
    const nMinY = Math.min(minY, verts[b1 + 1]!, verts[b2 + 1]!)
    const nMaxY = Math.max(maxY, verts[b1 + 1]!, verts[b2 + 1]!)
    const nMinZ = Math.min(minZ, verts[b1 + 2] ?? 0, verts[b2 + 2] ?? 0)
    const nMaxZ = Math.max(maxZ, verts[b1 + 2] ?? 0, verts[b2 + 2] ?? 0)

    if (
      outIdxPos > clusterIdxStart &&
      exceedsExtent(nMinX, nMaxX, nMinY, nMaxY, nMinZ, nMaxZ)
    ) {
      pushCluster()
      startCluster()
      // Re-probe with the fresh cluster.
      extendByVertex(i1)
      extendByVertex(i2)
    } else {
      minX = nMinX
      maxX = nMaxX
      minY = nMinY
      maxY = nMaxY
      minZ = nMinZ
      maxZ = nMaxZ
    }

    const base1 = i1 * itemSize
    const base2 = i2 * itemSize
    for (let c = 0; c < itemSize; c++) {
      outArray[outArrayPos++] = verts[base1 + c]!
    }
    const l1 = (outArrayPos - clusterArrayStart) / itemSize - 1
    for (let c = 0; c < itemSize; c++) {
      outArray[outArrayPos++] = verts[base2 + c]!
    }
    const l2 = (outArrayPos - clusterArrayStart) / itemSize - 1
    outIndices[outIdxPos++] = l1
    outIndices[outIdxPos++] = l2
  }
  if (clusterArrayStart >= 0 && outIdxPos > clusterIdxStart) {
    pushCluster()
  }
  return clusters
}

/**
 * Builds rebased line-segment geometry for an indexed segment buffer that may
 * span beyond the precision-safe extent, splitting it into independently
 * rebased clusters.
 *
 * @param array - Interleaved vertex attribute data (positions and optional
 *   extra components).
 * @param itemSize - Components per vertex in `array` (at least 3 for xyz).
 * @param indices - Index buffer pairing vertices into line segments.
 * @param material - Resolved line material; pattern shaders are rejected
 *   unless `options.allowNonBatchableMaterial` is set.
 * @param options - Optional flags forwarded to the per-cluster builder.
 * @returns Local-space geometries per cluster, or an empty array for pattern
 *   shader materials or when no valid segments remain.
 */
export function buildLineSegmentsGeometryMulti(
  array: AcTrLineSegmentsArray,
  itemSize: number,
  indices: Uint16Array,
  material: THREE.Material,
  options?: { allowNonBatchableMaterial?: boolean }
): AcTrBuiltDirectGeometry[] {
  if (
    !options?.allowNonBatchableMaterial &&
    isDirectBatchRejectedMaterial(material)
  ) {
    return []
  }
  const clusters = splitLineSegmentsClusters(array, itemSize, indices)
  const results: AcTrBuiltDirectGeometry[] = []
  for (const cluster of clusters) {
    const built = buildLineSegmentsGeometry(
      cluster.array,
      itemSize,
      cluster.indices,
      material,
      options?.allowNonBatchableMaterial ?? false
    )
    if (built) {
      results.push(built)
    }
  }
  return results
}

/**
 * Computes the bounding-box center of a world-space point cloud.
 *
 * The center is used as `worldOffset` when storing vertices in local
 * coordinates for float32 batch precision.
 *
 * @param points - World-space points to enclose.
 * @returns Center of the axis-aligned bounding box of `points`.
 */
function computeLocalOrigin(points: AcGePoint3dLike[]) {
  const box = new THREE.Box3()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    box.expandByPoint(_point.set(p.x, p.y, p.z ?? 0))
  }
  return box.getCenter(new THREE.Vector3())
}

/**
 * Computes the world-coordinate-system axis-aligned bounding box of a point
 * cloud.
 *
 * @param points - World-space points to enclose.
 * @returns A new {@link THREE.Box3} expanded by every point in `points`.
 */
function computeWcsBboxFromPoints(points: AcGePoint3dLike[]) {
  const box = new THREE.Box3()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    box.expandByPoint(_point.set(p.x, p.y, p.z ?? 0))
  }
  return box
}
