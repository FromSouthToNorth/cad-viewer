import {
  ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
  AcCmUiYieldGate,
  accmYieldForPaint
} from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  type AcDbDxfPairWireData,
  acdbMakeDxfPairArrayReader} from '../base/AcDbDxfPairWire'
import { acdbCreateWorkerApi } from '../converter/worker/AcDbWorkerManager'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import {
  type AcDbConversionProgressCallback,
  AcDbDatabaseConverter,
  type AcDbDatabaseConverterConfig,
  type AcDbDatabaseConverterReadOptions
} from '../database/AcDbDatabaseConverter'
import { AcDbDxfDocumentReader } from './AcDbDxfDocumentReader'

/**
 * Progress weights mirror typical open cost: a small PARSE slice, then most of
 * the bar for ENTITY add/render (same idea as the old converter where ENTITY
 * carried the largest step).
 */
const PARSE_START_PCT = 1
const PARSE_END_PCT = 18
/**
 * When tokenization runs in the parser worker, worker progress covers PARSE
 * up to this percentage; the semantic build (document reader) then covers
 * from here to {@link PARSE_END_PCT}.
 */
const TOKENIZE_END_PCT = 10
const ENTITY_START_PCT = 20
const ENTITY_END_PCT = 98

/** Default URL of the DXF parser worker bundle (`dxf-parser-worker.js`). */
const DEFAULT_DXF_PARSER_WORKER_URL = '/assets/dxf-parser-worker.js'

/**
 * Native DXF → database converter.
 *
 * Tokenization (bytes → typed group-code/value pairs) runs in a web worker
 * when `useWorker` is on and a `parserWorkerUrl` is reachable; the worker
 * posts back a drained, transferable pair stream. Semantic building —
 * {@link AcDbDxfDocumentReader} streaming pairs through {@link AcDbDxfFiler}
 * directly into {@link AcDbDatabase} — always runs on the main thread against
 * the same pipeline, so worker and main-thread parses are behavior-identical.
 * When no worker is available (Node, missing bundle, worker failure), the
 * converter falls back to tokenizing on the main thread.
 *
 * Conversion stages: `START → PARSE → ENTITY → END`. The reader fills the
 * database quietly (entity-appended events batched); then the batch flushes so
 * the first draw happens after parse completes. Fonts are loaded on demand by
 * the mtext renderer when a font is first needed.
 *
 * Mid-PARSE progress, chunked ENTITY flush, and time-budgeted UI yields keep
 * the status bar / spinner responsive without stalling large files on
 * per-chunk `requestAnimationFrame` waits.
 */
export class AcDbNativeDxfConverter extends AcDbDatabaseConverter<null> {
  constructor(config: AcDbDatabaseConverterConfig = {}) {
    super({
      parserWorkerUrl: DEFAULT_DXF_PARSER_WORKER_URL,
      ...config
    })
  }

  override async read(
    data: ArrayBuffer,
    db: AcDbDatabase,
    options: AcDbDatabaseConverterReadOptions = {}
  ) {
    const { minimumChunkSize = 10, progress } = options

    this.progress = progress

    const emit = async (
      percentage: number,
      stage: Parameters<AcDbConversionProgressCallback>[1],
      status: Parameters<AcDbConversionProgressCallback>[2],
      stageData?: unknown
    ) => {
      if (!progress) return
      await progress(percentage, stage, status, stageData)
    }

    await emit(0, 'START', 'START')
    await emit(PARSE_START_PCT, 'PARSE', 'START')
    // Let the open-file overlay paint before sync-heavy parse work (once).
    await accmYieldForPaint()

    // Tokenize in the parser worker when configured; null means "run the
    // whole parse on the main thread" (no worker support or worker failure).
    const wire = await this.tokenizeInWorker(data, emit)

    // Suppress entityAppended (and related) until parse finishes so the viewer
    // does not worldDraw mid-stream while the open-file progress bar is still
    // in PARSE.
    db.beginEventBatch()
    let batchOpen = true
    try {
      let filer: AcDbDxfFiler
      let totalUnits: number
      let buildStartPct: number
      if (wire) {
        // Replay worker-tokenized pairs; the array reader reports its pair
        // index as position, so progress units are pairs, not bytes.
        filer = AcDbDxfFiler.forReading(acdbMakeDxfPairArrayReader(wire), {
          database: db
        })
        totalUnits = wire.count
        buildStartPct = TOKENIZE_END_PCT
      } else {
        filer = AcDbDxfFiler.fromBuffer(data, { database: db })
        totalUnits = data.byteLength
        buildStartPct = PARSE_START_PCT
      }

      let lastParsePct = buildStartPct
      const reader = new AcDbDxfDocumentReader(db, {
        entityBatchSize: Math.max(1, minimumChunkSize || 200),
        yieldBudgetMs: ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
        totalBytes: totalUnits,
        onProgress: async ratio => {
          const pct = Math.min(
            PARSE_END_PCT - 1,
            buildStartPct +
              Math.floor(ratio * (PARSE_END_PCT - buildStartPct))
          )
          if (pct <= lastParsePct) return
          lastParsePct = pct
          await emit(pct, 'PARSE', 'IN-PROGRESS')
        }
      })
      const result = await reader.read(filer)

      await emit(PARSE_END_PCT, 'PARSE', 'END', {
        unknownEntityCount: result.unknownEntityCount
      })

      await emit(ENTITY_START_PCT, 'ENTITY', 'START')
      const chunkSize = Math.max(1, minimumChunkSize || 200)
      let lastEntityPct = ENTITY_START_PCT
      const yieldGate = new AcCmUiYieldGate(ACCM_DEFAULT_UI_YIELD_BUDGET_MS)
      // Flush queued entityAppended in chunks while advancing most of the
      // open-file progress bar.
      await db.endEventBatchChunked(chunkSize, async (flushed, total) => {
        const pct =
          total <= 0
            ? ENTITY_END_PCT
            : Math.min(
                ENTITY_END_PCT,
                ENTITY_START_PCT +
                  Math.floor(
                    (flushed / total) * (ENTITY_END_PCT - ENTITY_START_PCT)
                  )
              )
        if (pct > lastEntityPct) {
          lastEntityPct = pct
          await emit(pct, 'ENTITY', 'IN-PROGRESS')
        }
        // Time-budgeted single-frame yield — not per progress percent.
        await yieldGate.maybeYield()
      })
      batchOpen = false
      await emit(ENTITY_END_PCT, 'ENTITY', 'END')

      await emit(100, 'END', 'END')
    } catch (error) {
      if (batchOpen) {
        db.endEventBatch()
      }
      throw error
    }
  }

  protected override async parse(_data: ArrayBuffer) {
    return { model: null, data: { unknownEntityCount: 0 } }
  }

  /**
   * Tokenizes DXF bytes in the parser worker and returns the drained pair
   * stream. Returns `null` when worker parsing is disabled or unavailable
   * (Node, `Worker` missing, task failure) so the caller can fall back to
   * main-thread tokenization — the input buffer is copied before crossing
   * to the worker, so the fallback path still owns readable bytes.
   */
  private async tokenizeInWorker(
    data: ArrayBuffer,
    emit: (
      percentage: number,
      stage: Parameters<AcDbConversionProgressCallback>[1],
      status: Parameters<AcDbConversionProgressCallback>[2],
      stageData?: unknown
    ) => Promise<void>
  ): Promise<AcDbDxfPairWireData | null> {
    const workerUrl = this.config.parserWorkerUrl
    if (!this.config.useWorker || !workerUrl) return null
    if (typeof Worker === 'undefined') return null

    const api = acdbCreateWorkerApi({
      workerUrl,
      timeout: this.getParserWorkerTimeout(data),
      // One concurrent worker needed for parser
      maxConcurrentWorkers: 1
    })

    let lastPct = PARSE_START_PCT
    const result = await api.execute<ArrayBuffer, AcDbDxfPairWireData>(
      // The worker detaches whatever it receives; send a copy so a failed
      // worker attempt cannot neuter the main-thread fallback's input.
      data.slice(0),
      undefined,
      ratio => {
        const pct = Math.min(
          TOKENIZE_END_PCT - 1,
          PARSE_START_PCT +
            Math.floor(ratio * (TOKENIZE_END_PCT - PARSE_START_PCT))
        )
        if (pct <= lastPct) return
        lastPct = pct
        // Progress is advisory; never let a listener error fail the parse.
        void emit(pct, 'PARSE', 'IN-PROGRESS').catch(() => undefined)
      }
    )
    api.destroy()

    if (!result.success || !result.data) {
      console.warn(
        `DXF parser worker failed (${result.error ?? 'unknown error'}); ` +
          'falling back to main-thread parsing.'
      )
      return null
    }
    return result.data
  }
}
