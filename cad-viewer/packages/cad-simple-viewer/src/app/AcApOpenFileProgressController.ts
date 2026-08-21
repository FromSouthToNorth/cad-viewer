import {
  accmYieldForPaint,
  AcDbProgressdEventArgs
} from '@mlightcad/data-model'

import { eventBus } from '../editor'
import { AcApI18n } from '../i18n'
import { AcApProgress } from './AcApProgress'
import { isOpenFileProgressComplete } from './openFileProgress'

/**
 * Manages the open-file progress overlay and normalized progress events.
 *
 * Listens to database open progress callbacks (wired by {@link AcApDocManager}),
 * normalizes monotonic percentages, updates the canvas overlay, and emits
 * `open-file-progress` on the global event bus.
 *
 * Overlay DOM updates are deduplicated: `show()` runs once per open, and
 * `setMessage` only when the localized stage text changes. Progress events
 * still emit on every callback so listeners see fine-grained percentages.
 *
 * When progressive scene convert is still draining after CONVERSION `END`,
 * the overlay stays up (see-through) until {@link setSceneBusyGate} reports
 * idle so geometry can appear under the spinner. The numeric display stays
 * hidden during the drain (only the spinner and stage text show) so the bar
 * never restarts from a low value after having reached 100%.
 */
export class AcApOpenFileProgressController {
  private readonly _progress: AcApProgress
  private _peak = 0
  private _overlayVisible = false
  private _lastMessage = ''
  private _lastProgress = -1
  private _seeThrough = false
  private _uiSuppressed = false
  private _sceneBusyGate?: () => boolean
  private _holdPollId?: ReturnType<typeof setTimeout>

  private static readonly OVERLAY_DEFAULT = 'rgba(0,0,0,0.45)'
  private static readonly OVERLAY_SEE_THROUGH = 'rgba(0,0,0,0.16)'

  /**
   * @param host - Canvas container that receives the progress overlay
   */
  constructor(host: HTMLElement) {
    this._progress = new AcApProgress({
      host,
      overlayColor: AcApOpenFileProgressController.OVERLAY_DEFAULT
    })
    this._progress.hide()
  }

  /**
   * When true, uses a lighter overlay so progressive geometry is visible
   * under the spinner during open.
   */
  setSeeThroughOverlay(enabled: boolean): void {
    this._seeThrough = enabled
    this._progress.setOverlayColor(
      enabled
        ? AcApOpenFileProgressController.OVERLAY_SEE_THROUGH
        : AcApOpenFileProgressController.OVERLAY_DEFAULT
    )
  }

  /**
   * Gate that returns true while the view still has entities to convert.
   * Used to keep the overlay until progressive scene convert finishes.
   *
   * @param gate - Busy predicate controlling overlay lifetime
   */
  setSceneBusyGate(gate: (() => boolean) | undefined): void {
    this._sceneBusyGate = gate
  }

  /**
   * Resets tracked progress for a new open operation.
   */
  reset(): void {
    this.clearHoldPoll()
    this._peak = 0
    this._overlayVisible = false
    this._lastMessage = ''
    this._lastProgress = -1
  }

  /**
   * Shows the open-file overlay immediately and yields so it can paint before
   * main-thread DXF parse work blocks the UI (native converter path).
   */
  async beginOpen(database: AcDbProgressdEventArgs['database']): Promise<void> {
    this.handle({
      database,
      percentage: 0,
      stage: 'CONVERSION',
      subStage: 'START',
      subStageStatus: 'START'
    })
    await accmYieldForPaint()
  }

  /**
   * While true, progress events are consumed without touching the UI: no
   * `open-file-progress` event is emitted and the overlay stays hidden.
   * Used by lightweight internal opens such as {@link AcApDocManager.newDocument},
   * which must not show a loading bar. Lifting suppression resets the
   * controller state so the next visible open starts clean.
   */
  setUiSuppressed(suppressed: boolean): void {
    this._uiSuppressed = suppressed
    if (!suppressed) {
      this.hideAndReset()
    }
  }

  /**
   * Normalizes progress, emits `open-file-progress`, and updates the overlay.
   *
   * @returns Normalized progress payload (monotonic percentage)
   */
  handle(data: AcDbProgressdEventArgs): AcDbProgressdEventArgs {
    const progress = this.normalize(data)
    if (!this._uiSuppressed) {
      eventBus.emit('open-file-progress', progress)
      this.updateOverlay(progress)
    } else if (isOpenFileProgressComplete(data)) {
      // Keep state clean so the next visible open starts from scratch.
      this.hideAndReset()
    }
    return progress
  }

  /**
   * Returns monotonic open-file progress for UI display.
   *
   * Progress is re-weighted into a single global domain so the bar climbs
   * exactly once per open: FETCH_FILE occupies 0-10%, CONVERSION 10-100%.
   * Domain-start events hold the current peak, so switching stages never dips
   * the bar. Completion is detected from terminal statuses in
   * {@link isOpenFileProgressComplete}, never from the weighted value.
   */
  private normalize(data: AcDbProgressdEventArgs): AcDbProgressdEventArgs {
    const weighted = this.weightPercentage(data)
    this._peak = Math.max(this._peak, weighted)
    return { ...data, percentage: this._peak }
  }

  /**
   * Maps raw stage percentage into the global 0-100 domain.
   */
  private weightPercentage(data: AcDbProgressdEventArgs): number {
    if (data.stage === 'FETCH_FILE') {
      return data.percentage * 0.1
    }
    if (data.stage === 'CONVERSION') {
      // The converter opens with `(0, 'START', 'START')` before any work is
      // actually performed; hold the current peak so the bar does not dip.
      if (data.subStage === 'START' && data.subStageStatus === 'START') {
        return this._peak
      }
      return 10 + data.percentage * 0.9
    }
    return data.percentage
  }

  private resolveMessage(data: AcDbProgressdEventArgs): string | undefined {
    if (data.stage === 'CONVERSION') {
      if (data.subStage) {
        const key =
          'main.progress.' + data.subStage.replace(/_/g, '').toLowerCase()
        return AcApI18n.t(key)
      }
      return undefined
    }
    if (data.stage === 'FETCH_FILE') {
      return AcApI18n.t('main.message.fetchingDrawingFile')
    }
    return undefined
  }

  private updateOverlay(data: AcDbProgressdEventArgs): void {
    if (isOpenFileProgressComplete(data)) {
      if (this._sceneBusyGate?.()) {
        this.holdUntilSceneIdle()
        return
      }
      this.hideAndReset()
      return
    }

    this.clearHoldPoll()

    if (!this._overlayVisible) {
      this._progress.show()
      this._overlayVisible = true
      if (this._seeThrough) {
        this._progress.setOverlayColor(
          AcApOpenFileProgressController.OVERLAY_SEE_THROUGH
        )
      }
    }

    const message = this.resolveMessage(data)
    if (message != null && message !== this._lastMessage) {
      this._progress.setMessage(message)
      this._lastMessage = message
    }

    const percentage = Math.max(0, Math.min(100, Math.round(data.percentage)))
    if (percentage !== this._lastProgress) {
      this._lastProgress = percentage
      this._progress.setProgress(percentage)
    }
  }

  private holdUntilSceneIdle(): void {
    if (!this._overlayVisible) {
      this._progress.show()
      this._overlayVisible = true
    }
    this._progress.setOverlayColor(
      AcApOpenFileProgressController.OVERLAY_SEE_THROUGH
    )
    const message = AcApI18n.t('main.progress.rendering')
    if (message !== this._lastMessage) {
      this._progress.setMessage(message)
      this._lastMessage = message
    }
    // The numeric conversion percentage has reached its end; hide the number
    // while the scene still drains so it does not read a misleading 100% or
    // restart from a low value.
    this._progress.setProgress(undefined)
    this._lastProgress = -1

    if (this._holdPollId != null) {
      return
    }

    const poll = () => {
      if (this._sceneBusyGate?.()) {
        this._holdPollId = setTimeout(poll, 50)
        return
      }
      this._holdPollId = undefined
      this.hideAndReset()
    }
    this._holdPollId = setTimeout(poll, 50)
  }

  private hideAndReset(): void {
    this.clearHoldPoll()
    this._progress.hide()
    this.reset()
  }

  private clearHoldPoll(): void {
    if (this._holdPollId != null) {
      clearTimeout(this._holdPollId)
      this._holdPollId = undefined
    }
  }
}
