import {
  ColorSettings,
  MTextData,
  MTextObject,
  TextStyle
} from '@mlightcad/mtext-renderer'
import * as THREE from 'three'

/** Budget configuration for {@link AcTrMTextGlyphCache}. */
export interface AcTrMTextGlyphCacheOptions {
  /** Maximum number of cached glyph templates (LRU). Defaults to `512`. */
  maxEntries?: number
  /** Approximate byte budget before LRU eviction. Defaults to 16 MiB. */
  maxEstimatedBytes?: number
}

/** Cache hit statistics for diagnostics. */
export interface AcTrMTextGlyphCacheStats {
  count: number
  estimatedBytes: number
}

const DEFAULT_MAX_ENTRIES = 512
const DEFAULT_MAX_ESTIMATED_BYTES = 16 * 1024 * 1024

interface AcTrMTextGlyphCacheEntry {
  template: MTextObject
  estimatedBytes: number
}

/**
 * Content-level cache for mtext-renderer layout results.
 *
 * Worker-mode MTEXT rendering pays one async worker round trip per entity.
 * Drawings full of repeated labels (dimensions, tags, titles) render the same
 * content + style + colour combination over and over, so caching the produced
 * glyph tree lets later hits skip the worker entirely and only pay a deep
 * clone + placement cost.
 *
 * The key intentionally excludes `position` — placement lives on the root
 * transform of the returned tree — so one template serves every insertion
 * point. Rotation is part of the key for simplicity even though it is also
 * root-level.
 */
export class AcTrMTextGlyphCache {
  private _entries = new Map<string, AcTrMTextGlyphCacheEntry>()
  private _totalBytes = 0
  private readonly _maxEntries: number
  private readonly _maxEstimatedBytes: number

  constructor(options: AcTrMTextGlyphCacheOptions = {}) {
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this._maxEstimatedBytes =
      options.maxEstimatedBytes ?? DEFAULT_MAX_ESTIMATED_BYTES
  }

  /** Number of cached templates. */
  get size() {
    return this._entries.size
  }

  /** Approximate total footprint of cached templates in bytes. */
  get estimatedBytes() {
    return this._totalBytes
  }

  /**
   * Builds a stable cache key from content, style and colour — everything
   * that affects glyph layout except the insertion point.
   *
   * @param mtextContent - MTEXT payload whose `position` field is excluded.
   * @param textStyle - Resolved CAD text style.
   * @param colorSettings - Resolved ByLayer/ByBlock colour context.
   * @returns A string key safe to use as a `Map` key.
   */
  buildKey(
    mtextContent: MTextData,
    textStyle: TextStyle,
    colorSettings: ColorSettings
  ): string {
    return [
      mtextContent.text,
      JSON.stringify({ ...mtextContent, position: undefined }),
      JSON.stringify(textStyle),
      JSON.stringify(colorSettings)
    ].join('\u0001')
  }

  /**
   * Returns the cached template for `key`, refreshing its LRU recency.
   *
   * @param key - Key previously produced by {@link buildKey}.
   * @returns The template, or `undefined` on miss.
   */
  get(key: string): MTextObject | undefined {
    const entry = this._entries.get(key)
    if (!entry) {
      return undefined
    }
    // Map insertion order is the LRU order; re-insert to refresh recency.
    this._entries.delete(key)
    this._entries.set(key, entry)
    return entry.template
  }

  /**
   * Stores a freshly rendered glyph tree as the template for `key`.
   *
   * Replaces any previous entry for the key and evicts least-recently-used
   * entries until both the entry count and byte budgets are satisfied.
   *
   * @param key - Key previously produced by {@link buildKey}.
   * @param template - Pristine rendered tree. Must never be handed to a
   *   consumer directly — consumers mutate the tree during batching.
   */
  set(key: string, template: MTextObject): void {
    const previous = this._entries.get(key)
    if (previous) {
      this._totalBytes -= previous.estimatedBytes
    }
    const estimatedBytes = estimateTemplateBytes(key, template)
    this._entries.delete(key)
    this._entries.set(key, { template, estimatedBytes })
    this._totalBytes += estimatedBytes
    this._evict()
  }

  /** Drops every cached template. */
  clear(): void {
    this._entries.clear()
    this._totalBytes = 0
  }

  /** Returns cache cardinality and estimated footprint for diagnostics. */
  getStats(): AcTrMTextGlyphCacheStats {
    return {
      count: this._entries.size,
      estimatedBytes: this._totalBytes
    }
  }

  private _evict() {
    while (
      this._entries.size > 0 &&
      (this._entries.size > this._maxEntries ||
        this._totalBytes > this._maxEstimatedBytes)
    ) {
      const oldestKey = this._entries.keys().next().value as string
      const entry = this._entries.get(oldestKey)
      if (!entry) {
        break
      }
      this._entries.delete(oldestKey)
      this._totalBytes -= entry.estimatedBytes
    }
  }
}

/**
 * Estimates the memory footprint of one cached template.
 *
 * @param key - Cache key whose string cost is included.
 * @param template - Rendered glyph tree to measure.
 * @returns Approximate retained bytes (key + object overhead + GPU-side arrays).
 */
function estimateTemplateBytes(
  key: string,
  template: THREE.Object3D
): number {
  let bytes = key.length * 2
  template.traverse(object => {
    bytes += 64
    if (
      'geometry' in object &&
      (object as THREE.Mesh).geometry instanceof THREE.BufferGeometry
    ) {
      const geometry = (object as THREE.Mesh).geometry
      for (const attributeName in geometry.attributes) {
        const attribute = geometry.getAttribute(attributeName)
        bytes += attribute.array.byteLength + attribute.count * 16
      }
      const index = geometry.getIndex()
      if (index) {
        bytes += index.array.byteLength
      }
    }
  })
  return bytes
}

/**
 * Deep-clones a cached template for one consumer and repositions the root at
 * the requested insertion point.
 *
 * THREE's `Object3D.copy` JSON-clones `userData`, which strips the prototype
 * from `THREE.Box3` instances embedded in the renderer's layout metadata and
 * would corrupt character-level picking. Those fields are restored by
 * reference — the renderer only ever reads them (`buildCharBoxesFromObject`
 * copies before transforming). Leaf geometries are cloned so batch
 * rebase-in-place and shell disposal of one consumer cannot corrupt the
 * shared template's buffers.
 *
 * @param template - Pristine cached template (owner of shared layout metadata).
 * @param position - World-space insertion point for the returned tree.
 * @returns A standalone tree placed at `position`, safe for the caller to mutate.
 */
export function clonePlacedMTextTemplate(
  template: MTextObject,
  position: THREE.Vector3 | { x: number; y: number; z: number }
): MTextObject {
  const clone = template.clone(true) as MTextObject

  const restoreLayoutMetadata = (
    source: THREE.Object3D,
    target: THREE.Object3D
  ) => {
    const sourceUserData = source.userData as Record<string, unknown> | undefined
    if (sourceUserData) {
      const targetUserData = target.userData as Record<string, unknown>
      if (sourceUserData.layout) {
        targetUserData.layout = sourceUserData.layout
      }
      if (sourceUserData.lineLayouts) {
        targetUserData.lineLayouts = sourceUserData.lineLayouts
      }
      if (sourceUserData.logicalBounds) {
        targetUserData.logicalBounds = sourceUserData.logicalBounds
      }
      if (sourceUserData.layoutCache) {
        targetUserData.layoutCache = sourceUserData.layoutCache
      }
    }
    for (let i = 0; i < source.children.length; i++) {
      restoreLayoutMetadata(source.children[i], target.children[i])
    }
  }
  restoreLayoutMetadata(template, clone)

  const isolateGeometry = (source: THREE.Object3D, target: THREE.Object3D) => {
    if (
      'geometry' in source &&
      (source as THREE.Mesh).geometry instanceof THREE.BufferGeometry
    ) {
      ;(target as THREE.Mesh).geometry = (
        source as THREE.Mesh
      ).geometry.clone()
    }
    for (let i = 0; i < source.children.length; i++) {
      isolateGeometry(source.children[i], target.children[i])
    }
  }
  isolateGeometry(template, clone)

  if (template.box) {
    clone.box = template.box.clone()
  }

  clone.position.set(position.x, position.y, position.z)
  clone.updateMatrix()
  clone.updateMatrixWorld(true)
  return clone
}
