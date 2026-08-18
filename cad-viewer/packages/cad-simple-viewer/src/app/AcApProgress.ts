import { acapCreateMlightcadIcon } from './AcApBrand'

/**
 * Configuration options for {@link AcApProgress}.
 */
export interface AcApProgressOptions {
  /**
   * Host element where overlay is mounted.
   * Use the CAD view container so mask is scoped to canvas area.
   * @defaultValue `document.body`
   */
  host?: HTMLElement

  /**
   * Size of the circular loader (width & height).
   * Accepts any valid CSS length value (e.g. "48px", "3rem", "25%").
   * @defaultValue `"72px"` when {@link showBrand} is true, otherwise `"48px"`
   */
  size?: string

  /**
   * Width of the spinner border stroke.
   * Should be a valid CSS length value.
   * @defaultValue `"4px"`
   */
  borderWidth?: string

  /**
   * Color of the animated spinner arc.
   * Accepts any valid CSS color format.
   * @defaultValue `"#0b84ff"`
   */
  color?: string

  /**
   * Whether a fullscreen overlay background is shown.
   * @defaultValue `true`
   */
  overlay?: boolean

  /**
   * Background color used when {@link overlay} is enabled.
   * @defaultValue `"rgba(0,0,0,0.18)"`
   */
  overlayColor?: string

  /**
   * Optional message text displayed under the spinner.
   * Hidden automatically if empty or undefined.
   * @defaultValue `""`
   */
  message?: string

  /**
   * Whether to show the mlightcad icon inside the spinner ring and the
   * brand wordmark beneath it.
   * @defaultValue `true`
   */
  showBrand?: boolean
}

/**
 * Displays a centered infinite circular loading indicator with optional text.
 *
 * Features:
 * - Framework-free — pure TypeScript & DOM
 * - Auto-injects required CSS once per document
 * - Shows/hides without removing DOM
 * - Dynamically update message text
 * - Optional mlightcad icon centered inside the spinner ring
 * - Safe for multiple instances
 *
 * @example
 * ```ts
 * const progress = new AcApProgress({ message: "Loading data…" });
 * progress.show();
 *
 * setTimeout(() => {
 *   progress.setMessage("Almost done…");
 * }, 1500);
 *
 * // progress.hide();
 * // progress.destroy();
 * ```
 */
export class AcApProgress {
  /**
   * ID assigned to the injected `<style>` element.
   * Used to ensure styles are only injected once.
   */
  public static readonly styleId: string = 'ml-ccl-loader-styles'

  /**
   * Tracks whether component CSS has already been injected.
   */
  public static stylesInjected = false

  /**
   * Root overlay container element appended to the configured host.
   */
  public root!: HTMLDivElement

  /**
   * Spinner circle element.
   */
  public spinner!: HTMLDivElement

  /**
   * Message text element displayed under the spinner.
   */
  public messageEl!: HTMLDivElement

  /**
   * Progress container (percentage label + bar), hidden until {@link setProgress}
   * receives a numeric value.
   */
  public progressEl!: HTMLDivElement

  /**
   * Percentage label inside {@link progressEl}.
   */
  public progressLabelEl!: HTMLDivElement

  /**
   * Animated fill bar inside {@link progressEl}.
   */
  public progressFillEl!: HTMLDivElement

  /**
   * Immutable resolved configuration for this instance.
   */
  public readonly options: Required<AcApProgressOptions>

  /**
   * Creates a new fullscreen infinite progress indicator.
   *
   * @param options - Optional {@link AcApProgressOptions} controlling appearance & behavior
   */
  constructor(options: AcApProgressOptions = {}) {
    const showBrand = options.showBrand ?? true
    this.options = {
      size: options.size ?? (showBrand ? '72px' : '48px'),
      borderWidth: options.borderWidth ?? (showBrand ? '4px' : '5px'),
      color: options.color ?? 'var(--ml-ui-accent, #0b84ff)',
      host: options.host ?? document.body,
      overlay: options.overlay ?? true,
      overlayColor:
        options.overlayColor ?? 'var(--ml-ui-overlay, rgba(0,0,0,0.5))',
      message: options.message ?? '',
      showBrand
    }

    if (!AcApProgress.stylesInjected) {
      this.injectStyles()
    }

    this.createDom()
  }

  /**
   * Makes the progress indicator visible.
   * The DOM remains mounted for efficiency.
   *
   * @returns The current {@link AcApProgress} instance (for chaining)
   */
  public show(): this {
    this.root.style.display = 'flex'
    return this
  }

  /**
   * Hides the progress indicator without removing it from the DOM.
   *
   * @returns The current {@link AcApProgress} instance (for chaining)
   */
  public hide(): this {
    this.root.style.display = 'none'
    return this
  }

  /**
   * Updates the displayed message text beneath the spinner.
   *
   * If the message is empty or undefined, the message element is hidden.
   *
   * @param text - New message text
   * @returns The current {@link AcApProgress} instance (for chaining)
   */
  public setMessage(text = ''): this {
    this.messageEl.textContent = text
    this.messageEl.style.display = text ? 'block' : 'none'
    return this
  }

  /**
   * Updates the numeric progress display (percentage label + fill bar).
   *
   * Passing `undefined`/`null` hides the progress display (e.g. when the
   * spinner remains visible but the numeric phase has finished).
   *
   * @param value - Progress percentage (0-100, clamped and rounded)
   * @returns The current {@link AcApProgress} instance (for chaining)
   */
  public setProgress(value?: number | null): this {
    if (value == null) {
      this.progressEl.style.display = 'none'
      return this
    }
    const percentage = Math.max(0, Math.min(100, Math.round(value)))
    this.progressEl.style.display = 'block'
    this.progressFillEl.style.width = `${percentage}%`
    this.progressLabelEl.textContent = `${percentage}%`
    return this
  }

  /**
   * Updates the fullscreen overlay background color when overlay mode is on.
   *
   * @param color - CSS color for the dimming layer
   */
  public setOverlayColor(color: string): this {
    if (this.options.overlay && this.root) {
      this.root.style.background = color
    }
    return this
  }

  /**
   * Completely removes the component from the DOM.
   * Safe to call multiple times.
   */
  public destroy(): void {
    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root)
    }
  }

  /**
   * Creates the hidden-by-default progress display (percentage label + bar).
   */
  private buildProgressEl(): HTMLDivElement {
    const container = document.createElement('div')
    container.className = 'ml-ccl-progress'
    container.style.display = 'none'

    const label = document.createElement('div')
    label.className = 'ml-ccl-progress-label'
    container.appendChild(label)

    const bar = document.createElement('div')
    bar.className = 'ml-ccl-progress-bar'

    const fill = document.createElement('div')
    fill.className = 'ml-ccl-progress-fill'
    bar.appendChild(fill)

    container.appendChild(bar)

    this.progressEl = container
    this.progressLabelEl = label
    this.progressFillEl = fill
    return container
  }

  /**
   * Creates required DOM elements and mounts them into configured host.
   * Called automatically by constructor.
   */
  private createDom(): void {
    const host = this.options.host
    const hostPosition = getComputedStyle(host).position
    if (hostPosition === 'static') {
      host.style.position = 'relative'
    }

    const root = document.createElement('div')
    root.className = 'ml-ccl-overlay'
    root.style.display = 'flex'
    root.style.background = this.options.overlay
      ? this.options.overlayColor
      : 'transparent'

    const stage = document.createElement('div')
    stage.className = 'ml-ccl-spinner-stage'
    stage.style.width = this.options.size
    stage.style.height = this.options.size

    const spinner = document.createElement('div')
    spinner.className = 'ml-ccl-spinner'
    spinner.style.borderWidth = this.options.borderWidth
    spinner.style.borderTopColor = this.options.color
    stage.appendChild(spinner)

    if (this.options.showBrand) {
      const icon = acapCreateMlightcadIcon({
        className: 'ml-ccl-spinner-icon',
        size: '60%'
      })
      stage.appendChild(icon)

      const message = document.createElement('div')
      message.className = 'ml-ccl-message'
      message.textContent = this.options.message
      message.style.display = this.options.message ? 'block' : 'none'

      const wrapper = document.createElement('div')
      wrapper.className = 'ml-ccl-wrapper'
      wrapper.appendChild(stage)
      wrapper.appendChild(message)
      wrapper.appendChild(this.buildProgressEl())

      root.appendChild(wrapper)
      host.appendChild(root)

      this.root = root
      this.spinner = spinner
      this.messageEl = message
      return
    }

    const message = document.createElement('div')
    message.className = 'ml-ccl-message'
    message.textContent = this.options.message
    message.style.display = this.options.message ? 'block' : 'none'

    const wrapper = document.createElement('div')
    wrapper.className = 'ml-ccl-wrapper'
    wrapper.appendChild(stage)
    wrapper.appendChild(message)
    wrapper.appendChild(this.buildProgressEl())

    root.appendChild(wrapper)
    host.appendChild(root)

    this.root = root
    this.spinner = spinner
    this.messageEl = message
  }

  /**
   * Injects required CSS into the document `<head>` if not already present.
   * Called automatically and only once globally.
   */
  private injectStyles(): void {
    if (document.getElementById(AcApProgress.styleId)) {
      AcApProgress.stylesInjected = true
      return
    }

    const css = `
  .ml-ccl-overlay {
    position: absolute;
    inset: 0;
    display: none;
    justify-content: center;
    align-items: center;
    z-index: 9999;
    pointer-events: auto;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial;
  }
  
  .ml-ccl-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .ml-ccl-spinner-stage {
    position: relative;
    flex-shrink: 0;
  }

  .ml-ccl-spinner {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border-style: solid;
    border-color: var(--ml-ui-border, rgba(0,0,0,0.25));
    border-top-color: var(--ml-ui-accent, #0b84ff);
    animation: ml-ccl-rotate 0.85s linear infinite;
    box-sizing: border-box;
  }

  .ml-ccl-spinner-icon {
    position: absolute;
    inset: 0;
    margin: auto;
    display: inline-flex;
    color: var(--ml-ui-accent, #0b84ff);
    pointer-events: none;
    user-select: none;
  }

  .ml-ccl-spinner-icon svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .ml-ccl-message {
    margin-top: 10px;
    font-size: 14px;
    color: var(--ml-ui-text, #FFF);
    text-align: center;
    user-select: none;
  }

  .ml-ccl-progress {
    margin-top: 14px;
    width: 180px;
  }

  .ml-ccl-progress-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ml-ui-text, #FFF);
    text-align: center;
    opacity: 0.9;
    user-select: none;
  }

  .ml-ccl-progress-bar {
    margin-top: 7px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }

  .ml-ccl-progress-fill {
    height: 100%;
    width: 0%;
    border-radius: 2px;
    background: var(--ml-ui-accent, #0b84ff);
    transition: width 0.15s ease;
  }
  
  @keyframes ml-ccl-rotate {
    to { transform: rotate(360deg); }
  }
      `.trim()

    const style = document.createElement('style')
    style.id = AcApProgress.styleId
    style.textContent = css
    document.head.appendChild(style)

    AcApProgress.stylesInjected = true
  }
}
