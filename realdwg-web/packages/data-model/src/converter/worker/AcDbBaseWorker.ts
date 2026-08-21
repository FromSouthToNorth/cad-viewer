/**
 * Base class for worker scripts that handles all message passing
 * Users only need to implement the executeTask method
 */

/// <reference lib="webworker" />

/** Message sent from the main thread to a worker task. */
export interface AcDbWorkerMessage<TInput = unknown> {
  /** Unique task identifier used to correlate the response. */
  id: string
  /** Task input payload. */
  input: TInput
}

/**
 * Machine-readable error category for worker failures.
 *
 * - `worker_oom` — postMessage failed due to memory or clone limits
 * - `worker_timeout` — task exceeded the configured timeout (main thread)
 * - `worker_error` — generic worker or postMessage failure
 */
export type AcDbWorkerErrorCode =
  | 'worker_oom'
  | 'worker_timeout'
  | 'worker_error'

/** Response posted back to the main thread after a worker task completes. */
export interface AcDbWorkerResponse<TOutput = unknown> {
  /** Task identifier matching the originating {@link AcDbWorkerMessage.id}. */
  id: string
  /** Whether the task completed without throwing. */
  success: boolean
  /** Task result when {@link success} is true. */
  data?: TOutput
  /** Human-readable error message when {@link success} is false. */
  error?: string
  /** Structured error category when {@link success} is false. */
  errorCode?: AcDbWorkerErrorCode
}

/**
 * Intermediate progress notification posted by a worker task before its final
 * {@link AcDbWorkerResponse}. `progress` is a ratio in `[0, 1]`.
 */
export interface AcDbWorkerProgressMessage {
  /** Task identifier matching the originating {@link AcDbWorkerMessage.id}. */
  id: string
  /** Discriminant so the main thread can tell progress from final responses. */
  type: 'progress'
  /** Completion ratio in `[0, 1]`. */
  progress: number
}

/**
 * Per-task context passed to {@link AcDbBaseWorker.executeTask} so worker
 * implementations can report intermediate progress back to the main thread.
 */
export interface AcDbWorkerTaskContext {
  /** Posts a progress notification for the current task. Ratio in `[0, 1]`. */
  reportProgress(progress: number): void
}

/**
 * Base class for worker scripts
 * Handles all message passing - users only need to implement executeTask
 */
export abstract class AcDbBaseWorker<TInput = unknown, TOutput = unknown> {
  constructor() {
    this.setupMessageHandler()
  }

  /**
   * Set up message handler - called automatically
   */
  private setupMessageHandler(): void {
    self.onmessage = async (event: MessageEvent<AcDbWorkerMessage<TInput>>) => {
      const { id, input } = event.data
      const context: AcDbWorkerTaskContext = {
        reportProgress: progress => this.sendProgress(id, progress)
      }

      try {
        const result = await this.executeTask(input, context)
        this.sendResponse(id, true, result)
      } catch (error) {
        this.sendResponse(
          id,
          false,
          undefined,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  /**
   * Send an intermediate progress notification to the main thread.
   */
  private sendProgress(id: string, progress: number): void {
    const message: AcDbWorkerProgressMessage = {
      id,
      type: 'progress',
      progress: Math.min(1, Math.max(0, progress))
    }
    self.postMessage(message)
  }

  /**
   * Objects transferred (zero-copy) with the success response instead of being
   * structured-cloned. Implementations returning large typed arrays should
   * override this and list their underlying buffers.
   */
  protected getTransferables(_data: TOutput): Transferable[] {
    return []
  }

  /**
   * Send response back to main thread
   */
  private sendResponse(
    id: string,
    success: boolean,
    data?: TOutput,
    error?: string,
    errorCode?: AcDbWorkerErrorCode
  ): void {
    const response: AcDbWorkerResponse<TOutput> = {
      id,
      success,
      data,
      error,
      errorCode
    }

    try {
      const transfer = success && data !== undefined ? this.getTransferables(data) : []
      self.postMessage(response, transfer)
    } catch (postError) {
      const message =
        postError instanceof Error ? postError.message : String(postError)
      self.postMessage({
        id,
        success: false,
        error: message,
        errorCode: this.classifyPostMessageError(message)
      })
    }
  }

  /**
   * Map a postMessage failure message to a structured error code.
   */
  private classifyPostMessageError(message: string): AcDbWorkerErrorCode {
    const lower = message.toLowerCase()
    if (
      lower.includes('out of memory') ||
      lower.includes('data cannot be cloned')
    ) {
      return 'worker_oom'
    }
    return 'worker_error'
  }

  /**
   * Execute the actual task - users must implement this
   * @param input - Input data for the task
   * @param context - Per-task context (progress reporting)
   * @returns Promise or direct result
   */
  protected abstract executeTask(
    input: TInput,
    context: AcDbWorkerTaskContext
  ): Promise<TOutput> | TOutput
}
