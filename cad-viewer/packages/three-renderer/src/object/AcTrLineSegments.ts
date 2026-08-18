import { AcGiSubEntityTraits } from '@mlightcad/data-model'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { resolveAnchorFromBox } from '../draw/AcTrBatchDrawPolicy'
import type { AcTrDrawMode } from '../draw/AcTrDrawMode'
import { AcTrRenderContext } from '../renderer/AcTrRenderContext'
import { AcTrBufferGeometryUtil, getSceneDrawableUserData } from '../util'
import { AcTrEntity } from './AcTrEntity'
import { buildLineSegmentsGeometryMulti } from './AcTrLineGeometryBuilder'

export class AcTrLineSegments extends AcTrEntity {
  constructor(
    array: Float32Array | Float64Array,
    itemSize: number,
    indices: Uint16Array,
    traits: AcGiSubEntityTraits,
    context: AcTrRenderContext
  ) {
    super(context)

    const material = this.styleManager.getLineMaterial(traits)
    // Segment buffers spanning beyond the precision-safe extent are split into
    // independently rebased clusters; each cluster becomes its own drawable
    // with its own world offset so float32 vertices never reach world-scale
    // magnitudes (pattern-linetype fallback path, mirrors the direct-batch path).
    const builtItems = buildLineSegmentsGeometryMulti(
      array,
      itemSize,
      indices,
      material,
      { allowNonBatchableMaterial: true }
    )
    if (builtItems.length === 0) {
      return
    }

    const wcsBbox = new THREE.Box3()
    for (const built of builtItems) {
      wcsBbox.union(built.wcsBbox)
      if (built.kind === 'lineFat') {
        const line = new LineSegments2(
          built.geometry as LineSegmentsGeometry,
          material as LineMaterial
        )
        line.position.copy(built.worldOffset)
        getSceneDrawableUserData(line).styleMaterialId = material.id
        this.add(line)
        continue
      }

      const line = new THREE.LineSegments(
        built.geometry as THREE.BufferGeometry,
        material
      )
      line.position.copy(built.worldOffset)
      AcTrBufferGeometryUtil.computeLineDistances(line)
      this.add(line)
    }
    this.wcsBbox = wcsBbox
    this.finalizeLeafDrawables()
  }

  override resolveDrawMode(): AcTrDrawMode {
    return this.batchDrawPolicy.resolveDrawMode({
      anchor: resolveAnchorFromBox(this.wcsBbox)
    })
  }
}
