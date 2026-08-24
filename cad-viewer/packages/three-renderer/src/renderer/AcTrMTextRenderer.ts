import {
  ColorSettings,
  createDefaultColorSettings,
  DefaultFontsPreset,
  FontManager,
  type MemoryUsageReport,
  MTextData,
  MTextObject,
  RenderMode,
  ShapeData,
  StyleManager,
  TextStyle,
  UnifiedRenderer
} from '@mlightcad/mtext-renderer'
import * as THREE from 'three'

import { AcTrStyleManager } from '../style/AcTrStyleManager'
import { AcTrSubEntityTraitsUtil } from '../util'
import {
  AcTrMTextGlyphCache,
  AcTrMTextGlyphCacheStats,
  clonePlacedMTextTemplate
} from './AcTrMTextGlyphCache'

class AcTrMTextStyleManager implements StyleManager {
  public unsupportedTextStyles: Record<string, number> = {}
  private _styleManager: AcTrStyleManager

  constructor(styeManager: AcTrStyleManager) {
    this._styleManager = styeManager
  }

  getMeshBasicMaterial(traits: ColorSettings): THREE.Material {
    const entityTraits = AcTrSubEntityTraitsUtil.createTraitsForMText(
      traits,
      this._styleManager.currentBackgroundColor
    )
    // Route MText glyph fills through the dedicated helper so their
    // linework-tier `drawOrder` semantics stay explicit even though
    // they are rasterized as meshes.
    return this._styleManager.getMTextFillMaterial(entityTraits)
  }

  getLineBasicMaterial(traits: ColorSettings): THREE.Material {
    const entityTraits = AcTrSubEntityTraitsUtil.createTraitsForMText(
      traits,
      this._styleManager.currentBackgroundColor
    )
    return this._styleManager.getLineMaterial(entityTraits, true)
  }
}

/**
 * Singleton class for managing MText rendering using WebWorkerRenderer
 */
export class AcTrMTextRenderer {
  private static _instance: AcTrMTextRenderer | null = null
  private _workerUrl?: string | URL
  private _renderer?: UnifiedRenderer
  private _fontUrl?: string
  private _renderMode?: RenderMode
  private _styleManager?: AcTrStyleManager
  private _defaultFonts?: DefaultFontsPreset | string | readonly string[]
  private _lazyFontLoading?: boolean
  private _awaitFontsBeforeDraw?: boolean
  /**
   * Content-level glyph template cache. Lazy so render-free unit tests and
   * cache-disabled configurations never pay for it.
   */
  private _glyphCache?: AcTrMTextGlyphCache
  /**
   * Key occurrence counts for keys not yet promoted into {@link _glyphCache}.
   * Templates are only cached once a key repeats, so unique labels never pay
   * the deep-clone cost of a cached template.
   */
  private _pendingGlyphKeys = new Map<string, number>()
  /**
   * In-flight async glyph renders keyed by cache key. Concurrent requests for
   * the same content (the common burst pattern during document open) share
   * one worker round trip; late joiners await the shared render and receive
   * positioned clones instead of each posting a layout request.
   */
  private _inFlightGlyphRenders = new Map<
    string,
    { promise: Promise<MTextObject>; joined: boolean }
  >()
  /** Feature switch for the content-level glyph cache (default on). */
  private _contentGlyphCacheEnabled = true
  /** Font-loaded listener installed by {@link installFontLoadedInvalidation}. */
  private _fontLoadedListener?: () => void

  private constructor() {
    // Do nothing for now
  }

  /**
   * Get the singleton instance of AcTrMTextRenderer
   */
  public static getInstance(): AcTrMTextRenderer {
    if (!AcTrMTextRenderer._instance) {
      AcTrMTextRenderer._instance = new AcTrMTextRenderer()
    }
    return AcTrMTextRenderer._instance
  }

  /**
   * Override text renderer's default style manager with cad-viewer's style manager so
   * that cad-viewer's style manager can manage materials used by texts too.
   * @param value - New style manager
   */
  overrideStyleManager(value: AcTrStyleManager) {
    this._styleManager = value
    // Apply immediately when the unified renderer already exists (e.g. re-init
    // or late override). Otherwise reconstruct would keep DefaultStyleManager
    // materials without `isForeground` tracking.
    if (this._renderer) {
      const styleManager = new AcTrMTextStyleManager(value)
      this._renderer.setStyleManager(styleManager)
    }
  }

  /**
   * Set URL to load fonts
   * @param value - URL to load fonts
   */
  setFontUrl(value: string) {
    this._fontUrl = value
    this.invalidateGlyphCache()
    this.applyFontUrl()
  }

  /**
   * Set render mode to use by mtext renderer
   * @param mode - Render mode
   */
  setRenderMode(mode: RenderMode) {
    this._renderMode = mode
    if (this._renderer) {
      this._renderer.setDefaultMode(mode)
      this.applyFontUrl()
    }
  }

  /**
   * Sets the default text and symbol font fallback chains on the active renderer
   * and syncs them to Web Workers.
   *
   * @param fonts - A preset name, a single font name, or an ordered list of font names
   */
  async setDefaultFonts(
    fonts: DefaultFontsPreset | string | readonly string[]
  ): Promise<void> {
    this._defaultFonts = fonts
    this.invalidateGlyphCache()
    await this.applyDefaultFonts()
  }

  /**
   * Mirrors {@link FontManager.lazyFontLoading} onto the main thread and worker pool.
   */
  async setLazyFontLoading(enabled: boolean): Promise<void> {
    this._lazyFontLoading = enabled
    FontManager.instance.lazyFontLoading = enabled
    await this.applyLazyFontLoading()
  }

  /**
   * When true with lazy loading, {@link asyncRenderMText} / {@link asyncRenderShape}
   * wait for referenced fonts before building glyph geometry.
   */
  async setAwaitFontsBeforeDraw(enabled: boolean): Promise<void> {
    this._awaitFontsBeforeDraw = enabled
    FontManager.instance.awaitFontsBeforeDraw = enabled
    await this.applyAwaitFontsBeforeDraw()
  }

  /**
   * Render MText using the current mode asynchronously.
   */
  async asyncRenderMText(
    mtextContent: MTextData,
    textStyle: TextStyle,
    colorSettings: ColorSettings = createDefaultColorSettings()
  ): Promise<MTextObject> {
    if (!this._renderer) {
      throw new Error('AcTrMTextRenderer not initialized!')
    }
    if (!this._contentGlyphCacheEnabled) {
      return this._renderer.asyncRenderMText(
        mtextContent,
        textStyle,
        colorSettings
      )
    }

    const cache = this.getGlyphCache()
    const key = cache.buildKey(mtextContent, textStyle, colorSettings)
    const template = cache.get(key)
    if (template) {
      return clonePlacedMTextTemplate(template, mtextContent.position)
    }

    const inFlight = this._inFlightGlyphRenders.get(key)
    if (inFlight) {
      // A layout for this content is already underway: share its round trip.
      inFlight.joined = true
      const rendered = await inFlight.promise
      return clonePlacedMTextTemplate(rendered, mtextContent.position)
    }

    const promise = this._renderer.asyncRenderMText(
      mtextContent,
      textStyle,
      colorSettings
    )
    const entry = { promise, joined: false }
    this._inFlightGlyphRenders.set(key, entry)
    try {
      const rendered = await promise
      const occurrences = (this._pendingGlyphKeys.get(key) ?? 0) + 1
      if (entry.joined || occurrences > 1) {
        this._pendingGlyphKeys.delete(key)
        cache.set(key, rendered)
        return clonePlacedMTextTemplate(rendered, mtextContent.position)
      }
      this._pendingGlyphKeys.set(key, 1)
      return rendered
    } finally {
      if (this._inFlightGlyphRenders.get(key) === entry) {
        this._inFlightGlyphRenders.delete(key)
      }
    }
  }

  /**
   * Render MText using the current mode synchronously
   */
  syncRenderMText(
    mtextContent: MTextData,
    textStyle: TextStyle,
    colorSettings: ColorSettings = createDefaultColorSettings()
  ): MTextObject {
    this.ensureRendererCreated()
    if (!this._renderer) {
      throw new Error('AcTrMTextRenderer not initialized!')
    }
    if (!this._contentGlyphCacheEnabled) {
      return this._renderer.syncRenderMText(
        mtextContent,
        textStyle,
        colorSettings
      )
    }

    const cache = this.getGlyphCache()
    const key = cache.buildKey(mtextContent, textStyle, colorSettings)
    const template = cache.get(key)
    if (template) {
      return clonePlacedMTextTemplate(template, mtextContent.position)
    }

    const mtext = this._renderer.syncRenderMText(
      mtextContent,
      textStyle,
      colorSettings
    )
    return this.recordGlyphRender(key, mtext, mtextContent.position)
  }

  async asyncRenderShape(
    shapeContent: ShapeData,
    textStyle: TextStyle,
    colorSettings: ColorSettings = createDefaultColorSettings()
  ): Promise<MTextObject> {
    if (!this._renderer) {
      throw new Error('AcTrMTextRenderer not initialized!')
    }
    return this._renderer.asyncRenderShape(
      shapeContent,
      textStyle,
      colorSettings
    )
  }

  syncRenderShape(
    shapeContent: ShapeData,
    textStyle: TextStyle,
    colorSettings: ColorSettings = createDefaultColorSettings()
  ): MTextObject {
    this.ensureRendererCreated()
    if (!this._renderer) {
      throw new Error('AcTrMTextRenderer not initialized!')
    }
    return this._renderer.syncRenderShape(
      shapeContent,
      textStyle,
      colorSettings
    )
  }

  /**
   * Enables or disables the content-level glyph template cache.
   *
   * Disabling drops all cached templates and pending key counts. The cache is
   * enabled by default.
   *
   * @param enabled - Desired cache state.
   */
  setContentGlyphCacheEnabled(enabled: boolean): void {
    this._contentGlyphCacheEnabled = enabled
    if (!enabled) {
      this.invalidateGlyphCache()
    }
  }

  /**
   * Returns cache cardinality and estimated footprint for diagnostics.
   */
  getContentGlyphCacheStats(): AcTrMTextGlyphCacheStats {
    if (!this._glyphCache) {
      return { count: 0, estimatedBytes: 0 }
    }
    return this._glyphCache.getStats()
  }

  /**
   * Initialize the renderer.
   *
   * When render mode is `main`, the unified renderer is created without
   * eagerly spawning web workers. The worker URL is still stored so worker
   * mode can be enabled later if needed.
   *
   * @param workerUrl - URL to the worker script used when render mode is `worker`
   */
  initialize(workerUrl?: string | URL): void {
    if (workerUrl !== undefined) {
      this._workerUrl = workerUrl
    }

    if (this._renderer) {
      this._renderer.destroy()
      this._renderer = undefined
    }

    const mode = this._renderMode ?? 'worker'
    const workerConfig = this._workerUrl ? { workerUrl: this._workerUrl } : {}

    if (mode === 'worker') {
      if (!this._workerUrl) {
        throw new Error(
          'AcTrMTextRenderer worker URL is required for worker render mode'
        )
      }
      this._renderer = new UnifiedRenderer('worker', workerConfig)
    } else {
      this._renderer = new UnifiedRenderer('main', workerConfig)
    }

    if (this._renderMode) {
      this._renderer.setDefaultMode(this._renderMode)
    }

    this.applyFontUrl()
    void this.applyDefaultFonts()
    void this.applyLazyFontLoading()
    void this.applyAwaitFontsBeforeDraw()
    if (this._styleManager) {
      const styleManager = new AcTrMTextStyleManager(this._styleManager)
      this._renderer.setStyleManager(styleManager)
    }

    this.installFontLoadedInvalidation()
  }

  /**
   * Estimates memory used by mtext-renderer (loaded fonts, caches, workers).
   *
   * Prefers {@link UnifiedRenderer.estimateMemoryUsage} when the renderer is
   * initialized; otherwise falls back to the main-thread {@link FontManager}.
   */
  async estimateMemoryUsage(): Promise<MemoryUsageReport> {
    if (this._renderer) {
      return this._renderer.estimateMemoryUsage()
    }

    const mainThread = FontManager.instance.estimateMemoryUsage({ id: 'main' })
    return {
      collectedAt: Date.now(),
      totalEstimatedBytes: mainThread.totalEstimatedBytes,
      mainThread,
      workers: [],
      indexedDbFontCache: {
        fontCount: 0,
        totalBytes: 0,
        fonts: []
      }
    }
  }

  /**
   * Dispose of the renderer and reset cached configuration.
   */
  dispose(): void {
    if (this._renderer) {
      this._renderer.destroy()
      this._renderer = undefined
    }
    this._workerUrl = undefined
    this._renderMode = undefined
    this._defaultFonts = undefined
    this._lazyFontLoading = undefined
    this._awaitFontsBeforeDraw = undefined
    this.invalidateGlyphCache()
  }

  /**
   * Dispose and discard the singleton instance.
   */
  public static resetInstance(): void {
    AcTrMTextRenderer.getInstance().dispose()
    AcTrMTextRenderer._instance = null
  }

  private ensureRendererCreated() {
    if (!this._renderer && this._workerUrl) {
      this.initialize(this._workerUrl)
    }
  }

  private getGlyphCache(): AcTrMTextGlyphCache {
    if (!this._glyphCache) {
      this._glyphCache = new AcTrMTextGlyphCache()
    }
    return this._glyphCache
  }

  /**
   * Feeds one fresh render result into the content-level cache.
   *
   * Templates are only cached once a key repeats, so unique labels return the
   * raw render and never pay the deep-clone cost of a cached template. From
   * the second occurrence on, every consumer receives a repositioned clone so
   * consumer mutation (flattening, rebasing, disposal) cannot corrupt the
   * pristine template.
   *
   * @param key - Cache key produced by {@link AcTrMTextGlyphCache.buildKey}.
   * @param rendered - Freshly rendered glyph tree.
   * @param position - Insertion point requested by the current consumer.
   * @returns The raw render for first-time keys, otherwise its clone.
   */
  private recordGlyphRender(
    key: string,
    rendered: MTextObject,
    position: MTextData['position']
  ): MTextObject {
    const occurrences = (this._pendingGlyphKeys.get(key) ?? 0) + 1
    if (occurrences === 1) {
      this._pendingGlyphKeys.set(key, 1)
      return rendered
    }
    this._pendingGlyphKeys.delete(key)
    this.getGlyphCache().set(key, rendered)
    return clonePlacedMTextTemplate(rendered, position)
  }

  /**
   * Drops every cached glyph template and pending key count.
   */
  private invalidateGlyphCache() {
    this._glyphCache?.clear()
    this._pendingGlyphKeys.clear()
    // In-flight renders were started against fallback fonts; let new callers
    // start fresh layouts once the real font arrives.
    this._inFlightGlyphRenders.clear()
  }

  /**
   * Subscribes to font-loaded events so cached templates built against
   * fallback fonts are dropped when the real font arrives.
   *
   * The subscription is guarded because unit tests mock the whole
   * mtext-renderer module and only provide `UnifiedRenderer`.
   */
  private installFontLoadedInvalidation() {
    if (this._fontLoadedListener) {
      return
    }
    const onFontLoaded = () => this.invalidateGlyphCache()
    this._fontLoadedListener = onFontLoaded
    const fontManager = FontManager as unknown as
      | {
          instance: {
            events: {
              fontLoaded: { addEventListener: (listener: () => void) => void }
            }
          }
        }
      | undefined
    fontManager?.instance.events.fontLoaded.addEventListener(onFontLoaded)
  }

  private applyFontUrl() {
    if (this._renderer && this._fontUrl) {
      this._renderer.setFontUrl(this._fontUrl)
    }
  }

  private async applyDefaultFonts() {
    if (this._renderer && this._defaultFonts !== undefined) {
      await this._renderer.setDefaultFonts(this._defaultFonts)
    }
  }

  private async applyLazyFontLoading() {
    if (this._renderer && this._lazyFontLoading !== undefined) {
      await this._renderer.setLazyFontLoading(this._lazyFontLoading)
    }
  }

  private async applyAwaitFontsBeforeDraw() {
    if (this._renderer && this._awaitFontsBeforeDraw !== undefined) {
      await this._renderer.setAwaitFontsBeforeDraw(this._awaitFontsBeforeDraw)
    }
  }
}
