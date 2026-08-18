import { AcGePoint2dLike, AcGiImageStyle } from '@mlightcad/data-model'
import * as THREE from 'three'

import type { AcTrDrawMode } from '../draw/AcTrDrawMode'
import { AcTrRenderContext } from '../renderer/AcTrRenderContext'
import { AcTrBufferGeometryUtil } from '../util/AcTrBufferGeometryUtil'
import { AcTrEntity } from './AcTrEntity'

const _anchorBox = /*@__PURE__*/ new THREE.Box2()
const _anchorPoint = /*@__PURE__*/ new THREE.Vector2()
const _anchorVector3 = /*@__PURE__*/ new THREE.Vector3()

/**
 * Computes the WCS bounding-box center of image boundary points in double
 * precision, so triangulated float32 vertices stay small.
 */
function resolveBoundaryAnchor(
  boundary: ArrayLike<AcGePoint2dLike>
): THREE.Vector2 {
  _anchorBox.makeEmpty()
  for (let i = 0; i < boundary.length; i++) {
    const point = boundary[i]
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      _anchorBox.expandByPoint(_anchorPoint.set(point.x, point.y))
    }
  }
  if (_anchorBox.isEmpty()) {
    return new THREE.Vector2(0, 0)
  }
  return _anchorBox.getCenter(new THREE.Vector2())
}

export class AcTrImage extends AcTrEntity {
  constructor(blob: Blob, style: AcGiImageStyle, context: AcTrRenderContext) {
    super(context)
    const blobUrl = URL.createObjectURL(blob)
    const textureLoader = new THREE.TextureLoader()
    const texture = textureLoader.load(
      blobUrl,
      () => URL.revokeObjectURL(blobUrl),
      undefined,
      () => URL.revokeObjectURL(blobUrl)
    )
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      map: texture
    })

    // Rebase the boundary to its WCS center (double precision) so the
    // ShapeGeometry float32 position attribute never holds world-scale
    // coordinates. The center is restored via mesh.position.
    const anchor = resolveBoundaryAnchor(style.boundary)
    const boundaryPoints = (style.boundary as unknown as AcGePoint2dLike[])
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(point => new THREE.Vector2(point.x - anchor.x, point.y - anchor.y))

    const shape = new THREE.Shape(boundaryPoints)
    const geometry = new THREE.ShapeGeometry(shape)
    this.generateUVs(geometry)

    // Spatial pick / box selection index entities via wcsBbox. Without this,
    // filled RasterImage / Ole2Frame meshes never enter the pick candidates
    // even though their interior is raycastable.
    const boundingBox = AcTrBufferGeometryUtil.safeComputeBoundingBox(geometry)
    if (boundingBox) {
      this.wcsBbox = boundingBox.clone()
      this.wcsBbox.translate(_anchorVector3.set(anchor.x, anchor.y, 0))
    }

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(anchor.x, anchor.y, 0)
    this.add(mesh)
    this.finalizeLeafDrawables()
  }

  override resolveDrawMode(): AcTrDrawMode {
    return 'unbatch'
  }

  /**
   * Generate UVs for the specified THREE.ShapeGeometry instance. THREE.ShapeGeometry does not automatically
   * generate UVs. To apply textures, we need to manually generate the UV coordinates for your shape.
   * @param geometry Input geometry to generate UVs
   */
  protected generateUVs(geometry: THREE.ShapeGeometry) {
    const position = geometry.attributes.position.array
    const uv = new Float32Array((position.length / 3) * 2)

    const minX = Math.min(...position.filter((_, i) => i % 3 === 0))
    const maxX = Math.max(...position.filter((_, i) => i % 3 === 0))
    const minY = Math.min(...position.filter((_, i) => i % 3 === 1))
    const maxY = Math.max(...position.filter((_, i) => i % 3 === 1))

    const width = maxX - minX
    const height = maxY - minY

    for (let i = 0; i < position.length; i += 3) {
      const x = position[i]
      const y = position[i + 1]
      uv[(i / 3) * 2] = (x - minX) / width
      uv[(i / 3) * 2 + 1] = (y - minY) / height
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }
}
