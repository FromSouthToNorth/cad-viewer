/**
 * Default work-slice budget (ms) before a cooperative UI yield during
 * main-thread work. Large enough to keep throughput high; small enough that
 * spinners and progress UI still update.
 */
export const ACCM_DEFAULT_UI_YIELD_BUDGET_MS = 50

/**
 * True when the page is in a background tab (or no document exists, e.g. Node).
 *
 * In a hidden tab `requestAnimationFrame` is throttled to ~1fps or paused, so
 * yields must fall back to timers there to keep cooperative parsing from
 * stalling; foreground tabs keep rAF so each yield still produces a paint.
 */
function accmIsPageHidden(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as { document?: { hidden?: boolean } }).document?.hidden === true
  )
}

/**
 * Yields once to the event loop / next animation frame so the browser can
 * paint and handle input. Prefer this inside hot loops (time-gated via
 * {@link AcCmUiYieldGate}).
 *
 * Uses a single `requestAnimationFrame` when available and the page is
 * visible (not a double-rAF), falling back to `setTimeout(0)` — also in
 * background tabs, where rAF is throttled.
 *
 * @returns Promise that resolves after one frame (or next timer tick).
 */
export function accmYieldToUi(): Promise<void> {
  return new Promise(resolve => {
    const raf = (
      globalThis as unknown as {
        requestAnimationFrame?: (cb: () => void) => number
      }
    ).requestAnimationFrame
    if (typeof raf === 'function' && !accmIsPageHidden()) {
      raf(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Waits until after at least one paint (double rAF). Use sparingly — e.g. once
 * before a long sync stretch so a loading overlay can appear. Do not call this
 * per chunk on large files. In hidden tabs (no paint needed) this collapses to
 * a single timer tick.
 *
 * @returns Promise that resolves after two animation frames (or one timer tick).
 */
export function accmYieldForPaint(): Promise<void> {
  return new Promise(resolve => {
    const raf = (
      globalThis as unknown as {
        requestAnimationFrame?: (cb: () => void) => number
      }
    ).requestAnimationFrame
    if (typeof raf === 'function' && !accmIsPageHidden()) {
      raf(() => raf(() => resolve()))
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Time-budgeted cooperative yields: only awaits {@link accmYieldToUi} when at
 * least `budgetMs` of wall time has elapsed since the previous yield completed.
 *
 * Typical usage: construct one gate per long job, then `await gate.maybeYield()`
 * inside each loop iteration.
 */
export class AcCmUiYieldGate {
  /**
   * High-resolution timestamp (ms) of when the last yield finished, or when the
   * gate was constructed / {@link mark}ed.
   */
  private _lastYieldCompletedAt: number

  /**
   * Creates a yield gate.
   *
   * @param _budgetMs - Minimum wall time between yields, in milliseconds.
   *   Defaults to {@link ACCM_DEFAULT_UI_YIELD_BUDGET_MS}.
   */
  constructor(
    private readonly _budgetMs: number = ACCM_DEFAULT_UI_YIELD_BUDGET_MS
  ) {
    this._lastYieldCompletedAt = AcCmUiYieldGate.now()
  }

  /**
   * Minimum wall time between yields, in milliseconds.
   */
  get budgetMs(): number {
    return this._budgetMs
  }

  /**
   * Yields when at least {@link budgetMs} has elapsed since the last completed
   * yield (or since construction / {@link mark}).
   *
   * @param yieldFn - Async yield implementation. Defaults to {@link accmYieldToUi}.
   * @returns Whether a yield actually ran.
   */
  async maybeYield(
    yieldFn: () => Promise<void> = accmYieldToUi
  ): Promise<boolean> {
    const now = AcCmUiYieldGate.now()
    if (now - this._lastYieldCompletedAt < this._budgetMs) {
      return false
    }
    await yieldFn()
    this._lastYieldCompletedAt = AcCmUiYieldGate.now()
    return true
  }

  /**
   * Marks the timeline without yielding (e.g. after an explicit paint wait).
   * Resets the budget clock so the next {@link maybeYield} waits a full
   * {@link budgetMs} from this point.
   */
  mark(): void {
    this._lastYieldCompletedAt = AcCmUiYieldGate.now()
  }

  /**
   * Current high-resolution time in milliseconds (`performance.now` when
   * available, otherwise `Date.now`).
   *
   * @returns Monotonic-ish timestamp in ms suitable for budget comparisons.
   */
  private static now(): number {
    if (
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
    ) {
      return performance.now()
    }
    return Date.now()
  }
}
