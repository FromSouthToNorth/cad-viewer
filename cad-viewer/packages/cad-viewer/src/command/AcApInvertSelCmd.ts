import {
  AcApContext,
  AcApDocManager,
  AcEdCommand
} from '@mlightcad/cad-simple-viewer'

/**
 * invertsel command:
 * inverts the active selection set — selected entities are deselected and
 * every other model-space entity is selected.
 */
export class AcApInvertSelCmd extends AcEdCommand {
  async execute(_context: AcApContext) {
    AcApDocManager.instance.curView?.invertSelection()
  }
}
