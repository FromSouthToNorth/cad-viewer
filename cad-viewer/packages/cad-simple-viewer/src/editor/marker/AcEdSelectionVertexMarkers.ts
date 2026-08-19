import {
  AcDbObjectId,
  AcDbSystemVariables,
  AcDbSysVarManager,
  AcGePoint3dLike
} from '@mlightcad/data-model'

import { AcApDocManager } from '../../app'
import type { AcTrView2d } from '../../view/AcTrView2d'
import { acedShouldShowGrips } from '../grip/AcEdGripPolicy'
import { AcEdMTextEditor } from '../input/ui/AcEdMTextEditor'

/**
 * Drives the screen-space vertex marker overlay from the selection/hover set.
 *
 * Selected and hovered entities get small square markers on their grip points
 * (line endpoints, circle center/quadrants, polyline vertices, …), rendered as
 * one THREE.Points overlay owned by the CAD scene. Unlike the HTML grip system
 * this works in read mode, has no `GRIPOBJLIMIT`, and cannot be dragged.
 *
 * When the HTML grip system is showing (writable document, editor idle, within
 * `GRIPOBJLIMIT`) the markers yield to the interactive grip squares to avoid
 * double square feedback.
 */
export class AcEdSelectionVertexMarkers {
  /** View owning selection, hover state, and the CAD scene. */
  private readonly _view: AcTrView2d
  /** Currently hovered entity id, or `null` when nothing is hovered. */
  private _hoveredId: AcDbObjectId | null = null
  /** Cached grip points per entity id, pruned to the current id set. */
  private readonly _pointsCache = new Map<AcDbObjectId, AcGePoint3dLike[]>()

  /** Stable listener references for event unsubscribe. */
  private readonly _boundRefresh = () => this.refresh()
  private readonly _boundHover = (args: { id: AcDbObjectId }) => {
    this._hoveredId = args.id
    this.refresh()
  }
  private readonly _boundUnhover = () => {
    this._hoveredId = null
    this.refresh()
  }

  /**
   * Creates the marker driver bound to the given view.
   *
   * @param view - The CAD view whose selection and hover state drive the markers.
   */
  constructor(view: AcTrView2d) {
    this._view = view
    this.bindEvents()
  }

  /**
   * Rebuilds the marker overlay from the current selection plus hovered entity.
   *
   * Grip points are collected from the database per entity and cached while the
   * entity stays in the current id set, so hover changes only re-query the
   * single hovered entity and selection changes reuse cached points.
   */
  refresh() {
    const scene = this._view.cadScene
    if (!scene) {
      return
    }

    const ids = new Set<AcDbObjectId>(this._view.selectionSet.ids)
    if (this._hoveredId) {
      ids.add(this._hoveredId)
    }

    const doc = AcApDocManager.instance.curDocument
    if (!doc) {
      this._pointsCache.clear()
      scene.clearSelectionVertexMarkers()
      return
    }

    // Yield to the interactive HTML grips when they are visible.
    const gripObjLimit = AcDbSysVarManager.instance().getVar(
      AcDbSystemVariables.GRIPOBJLIMIT,
      doc.database
    ) as number
    if (
      acedShouldShowGrips(
        doc.openMode,
        this._view.editor.isActive,
        !!AcEdMTextEditor.getActiveInputBox(),
        this._view.selectionSet.count,
        gripObjLimit
      )
    ) {
      scene.clearSelectionVertexMarkers()
      return
    }

    if (ids.size === 0) {
      this._pointsCache.clear()
      scene.clearSelectionVertexMarkers()
      return
    }

    const blockTable = doc.database.tables.blockTable
    const points: AcGePoint3dLike[] = []
    for (const id of ids) {
      let cached = this._pointsCache.get(id)
      if (!cached) {
        const entity = blockTable.getEntityById(id)
        cached = entity ? entity.subGetGripPoints() : []
        this._pointsCache.set(id, cached)
      }
      points.push(...cached)
    }

    // Keep the cache bounded: drop entities no longer selected or hovered.
    for (const key of this._pointsCache.keys()) {
      if (!ids.has(key)) {
        this._pointsCache.delete(key)
      }
    }

    scene.setSelectionVertexMarkers(points)
  }

  /**
   * Unsubscribes view events and releases the marker overlay.
   */
  dispose() {
    this.unbindEvents()
    this._pointsCache.clear()
    this._hoveredId = null
  }

  /**
   * Subscribes to selection and hover changes that require a marker rebuild.
   */
  private bindEvents() {
    const { selectionSet, events } = this._view
    selectionSet.events.selectionAdded.addEventListener(this._boundRefresh)
    selectionSet.events.selectionRemoved.addEventListener(this._boundRefresh)
    events.hover.addEventListener(this._boundHover)
    events.unhover.addEventListener(this._boundUnhover)
  }

  /**
   * Unsubscribes all view event listeners registered in {@link bindEvents}.
   */
  private unbindEvents() {
    const { selectionSet, events } = this._view
    selectionSet.events.selectionAdded.removeEventListener(this._boundRefresh)
    selectionSet.events.selectionRemoved.removeEventListener(this._boundRefresh)
    events.hover.removeEventListener(this._boundHover)
    events.unhover.removeEventListener(this._boundUnhover)
  }
}
