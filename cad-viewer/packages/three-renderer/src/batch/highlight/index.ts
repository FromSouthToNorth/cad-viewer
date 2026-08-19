export {
  BATCH_SLOT_ID_ATTRIBUTE,
  ensureInstancedSlotIdAttribute,
  ensureSlotIdAttribute,
  writeInstancedSlotIdRange,
  writeSlotIdRange
} from './AcTrBatchSlotId'
export {
  AcTrBatchHighlightState,
  type AcTrBatchHighlightKind
} from './AcTrBatchHighlightState'
export {
  bindBatchHighlightUniforms,
  HIGHLIGHT_DASH_GAP_PX,
  HIGHLIGHT_DASH_SIZE_PX,
  installBatchHighlightRenderer,
  patchMaterialForBatchHighlight
} from './AcTrBatchHighlightShaders'
