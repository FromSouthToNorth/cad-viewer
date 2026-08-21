import { AcDbProgressdEventArgs } from '@mlightcad/data-model'

/**
 * Returns whether an open-file progress event represents a terminal state.
 *
 * Progress values are re-weighted per stage (see
 * `AcApOpenFileProgressController.normalize`), so completion must be detected
 * from terminal statuses, never from the numeric value: `ERROR` always
 * terminates, and `END` terminates either the CONVERSION sub-stage
 * (`subStage === 'END'`) or the trailing FETCH_FILE completion emitted after
 * `openUri` finishes parsing.
 */
export function isOpenFileProgressComplete(
  data: AcDbProgressdEventArgs
): boolean {
  if (data.subStageStatus === 'ERROR') {
    return true
  }

  if (data.subStageStatus !== 'END') {
    return false
  }

  return data.stage === 'FETCH_FILE' || data.subStage === 'END'
}
