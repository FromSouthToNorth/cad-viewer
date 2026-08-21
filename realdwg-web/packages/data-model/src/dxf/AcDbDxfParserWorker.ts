/// <reference lib="webworker" />

import { acdbCreateDxfPairReader } from '../base/AcDbDxfPairReader'
import {
  acdbDrainDxfPairs,
  type AcDbDxfPairWireData,
  acdbDxfPairWireTransferables} from '../base/AcDbDxfPairWire'
import {
  AcDbBaseWorker,
  type AcDbWorkerTaskContext
} from '../converter/worker/AcDbBaseWorker'

/**
 * DXF tokenize worker.
 *
 * Turns raw DXF bytes (ASCII or binary) into a drained, transferable pair
 * stream ({@link AcDbDxfPairWireData}). Semantic work — building tables,
 * entities, and the database — stays on the main thread, which replays the
 * pairs through the same filer/document-reader pipeline used for main-thread
 * parsing.
 */
class AcDbDxfParserWorker extends AcDbBaseWorker<
  ArrayBuffer,
  AcDbDxfPairWireData
> {
  protected executeTask(
    input: ArrayBuffer,
    context: AcDbWorkerTaskContext
  ): AcDbDxfPairWireData {
    const reader = acdbCreateDxfPairReader(input)
    return acdbDrainDxfPairs(reader, {
      totalBytes: input.byteLength,
      onProgress: ratio => context.reportProgress(ratio)
    })
  }

  protected override getTransferables(data: AcDbDxfPairWireData) {
    return acdbDxfPairWireTransferables(data)
  }
}

// Initialize the worker
new AcDbDxfParserWorker()
