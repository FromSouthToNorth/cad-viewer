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
 *
 * Single-click picks restrict markers to the most recently picked entity, so
 * the rest of the selection keeps dashed-line feedback only. Box selections
 * clear that restriction and mark every selected entity again.
 */
export class AcEdSelectionVertexMarkers {
  /**
   * Maximum number of entities that receive per-entity vertex markers in one
   * refresh. Box selections above this cap skip markers entirely (matching
   * AutoCAD GRIPOBJLIMIT behaviour) instead of querying grip points for every
   * selected entity, which dominates box-selection time on large drawings.
   */
  static readonly MAX_MARKER_ENTITIES = 1000

  /** View owning selection, hover state, and the CAD scene. */
  private readonly _view: AcTrView2d
  /** Currently hovered entity id, or `null` when nothing is hovered. */
  private _hoveredId: AcDbObjectId | null = null
  /** Cached grip points per entity id, pruned to the current id set. */
  private readonly _pointsCache = new Map<AcDbObjectId, AcGePoint3dLike[]>()
  /** True while the marker cap is active; avoids logging on every hover refresh. */
  private _markersCapped = false

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
   * When the view has a last-picked entity still in the selection set, only
   * that entity (plus the hovered one) is marked; otherwise every selected
   * entity is marked.
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

    const lastPicked = this._view.lastPickedEntityId
    const selectionCount = this._view.selectionSet.count

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
        selectionCount,
        gripObjLimit
      )
    ) {
      scene.clearSelectionVertexMarkers()
      return
    }

    // Fast reject for huge box selections before building id sets or querying
    // the database per entity. A single-click pick on top of a large selection
    // still gets markers (it is restricted to the last picked entity below).
    if (
      !lastPicked &&
      selectionCount > AcEdSelectionVertexMarkers.MAX_MARKER_ENTITIES
    ) {
      this.skipMarkersForLargeSelection(scene, selectionCount)
      return
    }

    const selectedIds = new Set<AcDbObjectId>(this._view.selectionSet.ids)
    const ids =
      lastPicked && selectedIds.has(lastPicked)
        ? new Set<AcDbObjectId>([lastPicked])
        : selectedIds
    if (this._hoveredId) {
      ids.add(this._hoveredId)
    }

    if (ids.size > AcEdSelectionVertexMarkers.MAX_MARKER_ENTITIES) {
      // Last-picked entity left the set: the whole selection is marked again.
      this.skipMarkersForLargeSelection(scene, ids.size)
      return
    }

    if (ids.size === 0) {
      this._markersCapped = false
      this._pointsCache.clear()
      scene.clearSelectionVertexMarkers()
      return
    }
    this._markersCapped = false

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
   * Clears vertex markers for selections above {@link MAX_MARKER_ENTITIES}.
   *
   * Logs once per capped period (until the selection shrinks below the cap)
   * so repeated hover refreshes don't spam the console.
   */
  private skipMarkersForLargeSelection(
    scene: { clearSelectionVertexMarkers(): void },
    count: number
  ) {
    if (!this._markersCapped) {
      this._markersCapped = true
      console.log(
        `[cad-selection] vertex markers skipped: ${count} entities exceed` +
          ` cap ${AcEdSelectionVertexMarkers.MAX_MARKER_ENTITIES}`
      )
    }
    this._pointsCache.clear()
    scene.clearSelectionVertexMarkers()
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
