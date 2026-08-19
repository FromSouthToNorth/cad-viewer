import { AcGePoint3dLike } from '@mlightcad/data-model'
import * as THREE from 'three'

/**
 * Screen-space vertex markers rendered as a single {@link THREE.Points} overlay.
 *
 * Marker positions are world-space points (entity grip points). With no
 * texture map the point sprites rasterize as squares, matching the square grip
 * look of the HTML grip system. `sizeAttenuation` is off so marker size stays
 * constant in screen pixels regardless of zoom.
 */
export class AcTrVertexMarkerOverlay {
  /** Draw-order tier placed above every entity batch draw tier. */
  static readonly RENDER_ORDER = 100000

  private readonly _geometry: THREE.BufferGeometry
  private readonly _material: THREE.PointsMaterial
  private readonly _points: THREE.Points

  /**
   * Creates an empty marker overlay not yet attached to a scene.
   */
  constructor() {
    this._geometry = new THREE.BufferGeometry()
    this._material = new THREE.PointsMaterial({
      color: 0x0080ff,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true
    })
    this._points = new THREE.Points(this._geometry, this._material)
    this._points.name = 'SelectionVertexMarkerOverlay'
    this._points.frustumCulled = false
    this._points.renderOrder = AcTrVertexMarkerOverlay.RENDER_ORDER
  }

  /**
   * The renderable object to attach to a scene.
   */
  get internalObject() {
    return this._points
  }

  /**
   * Replaces the current marker set with the given world-space points.
   *
   * @param points - World-space grip points to display, or an empty array to clear.
   */
  setPoints(points: AcGePoint3dLike[]) {
    const position = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      position[i * 3] = points[i].x
      position[i * 3 + 1] = points[i].y
      position[i * 3 + 2] = points[i].z ?? 0
    }
    this._geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(position, 3)
    )
  }

  /**
   * Removes all marker points from the overlay.
   */
  clear() {
    this._geometry.deleteAttribute('position')
  }

  /**
   * Releases GPU resources owned by the overlay.
   */
  dispose() {
    this._geometry.dispose()
    this._material.dispose()
  }
}
