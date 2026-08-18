/**
 * Depth-range refresh decision for the 2D view camera.
 *
 * Kept free of renderer imports so the comparison logic can be unit-tested
 * without constructing a WebGL view.
 */

/** Z extent applied to (or observed for) the active camera. */
export interface AcTrDepthRangeExtent {
  min: number
  max: number
}

/**
 * Returns true when the `current` scene Z extent reaches beyond the `applied`
 * camera depth range and the near/far planes should be re-fitted.
 *
 * The scene's Z extent grows during progressive opens and layer-driven
 * conversions after the first framing; without re-fitting, entities outside
 * the original clip range never draw.
 *
 * @param applied - Z extent the camera was last fitted for, or null when the
 *   camera has never been fitted to scene geometry.
 * @param current - Current scene Z extent.
 */
export function shouldRefreshCameraDepthRange(
  applied: AcTrDepthRangeExtent | null,
  current: AcTrDepthRangeExtent
): boolean {
  return !applied || current.min < applied.min || current.max > applied.max
}
