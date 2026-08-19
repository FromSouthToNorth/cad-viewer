import * as THREE from 'three'

import { AcTrMaterialManager } from '../../style/AcTrMaterialManager'
import { getMaterialRuntimeUserData } from '../../util/AcTrObjectUserData'
import { AcTrBatchHighlightState } from './AcTrBatchHighlightState'

/** On-screen dash segment length (px) applied to highlighted line slots. */
export const HIGHLIGHT_DASH_SIZE_PX = 8
/** On-screen dash gap length (px) applied to highlighted line slots. */
export const HIGHLIGHT_DASH_GAP_PX = 5

/**
 * Dash wiring variant derived from the material being patched.
 *
 * - `'line'`  — thin lines (`LineBasicMaterial`, pattern `ShaderMaterial`);
 *   distances come from the per-vertex `lineDistance` attribute.
 * - `'line2'` — wide lines (`LineMaterial`); distances come from the
 *   per-instance `instanceDistanceStart/End` attributes.
 * - `'none'`  — meshes and points; their materials are left untouched and
 *   selection feedback comes from vertex markers instead.
 */
export type AcTrBatchHighlightDashMode = 'line' | 'line2' | 'none'

/** Uniform bag injected into batch highlight shader programs. */
export type AcTrBatchHighlightUniforms = {
  /** RGBA mask texture: R = selected, G = hovered. */
  u_highlightMask: { value: THREE.Texture }
  /** Mask texture width and height in pixels. */
  u_highlightMaskSize: { value: THREE.Vector2 }
  /** On-screen dash segment length in pixels. */
  u_highlightDashSize: { value: number }
  /** On-screen dash gap length in pixels. */
  u_highlightDashGap: { value: number }
  /**
   * Shared live camera-zoom uniform (≈ screen px per world unit). Named
   * distinctly because pattern line shaders already declare `u_cameraZoom` in
   * their own source — redeclaring it here would fail program compilation.
   */
  u_highlightZoom: { value: number }
}

const HIGHLIGHT_FRAGMENT_DECL = /* glsl */ `
uniform sampler2D u_highlightMask;
uniform vec2 u_highlightMaskSize;
uniform float u_highlightDashSize;
uniform float u_highlightDashGap;
uniform float u_highlightZoom;
varying float vBatchSlotId;
varying float vBatchLineDistance;

vec3 applyBatchHighlight(vec3 color) {
  if (u_highlightMaskSize.x <= 0.0 || u_highlightMaskSize.y <= 0.0) {
    return color;
  }
  vec2 maskUv = vec2(
    (mod(vBatchSlotId, u_highlightMaskSize.x) + 0.5) / u_highlightMaskSize.x,
    (floor(vBatchSlotId / u_highlightMaskSize.x) + 0.5) / u_highlightMaskSize.y
  );
  vec4 mask = texture2D(u_highlightMask, maskUv);
  if (mask.r > 0.5 || mask.g > 0.5) {
    float dashPeriod = u_highlightDashSize + u_highlightDashGap;
    if (dashPeriod > 0.0 &&
        mod(vBatchLineDistance * u_highlightZoom, dashPeriod) > u_highlightDashSize) {
      discard;
    }
  }
  return color;
}
`

const EMPTY_HIGHLIGHT_MASK = /*@__PURE__*/ (() => {
  const texture = new THREE.DataTexture(
    new Uint8Array(4),
    1,
    1,
    THREE.RGBAFormat
  )
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
})()

const warnedUnpatchedMaterials = new Set<string>()

/**
 * Creates default highlight uniform values backed by a 1×1 empty mask texture.
 *
 * The zoom uniform is the shared {@link AcTrMaterialManager.CameraZoomUniform}
 * reference so dash density follows the live camera without per-material work.
 *
 * @returns Fresh uniform bag for one material instance.
 */
function createHighlightUniforms(): AcTrBatchHighlightUniforms {
  return {
    u_highlightMask: { value: EMPTY_HIGHLIGHT_MASK },
    u_highlightMaskSize: { value: new THREE.Vector2(1, 1) },
    u_highlightDashSize: { value: HIGHLIGHT_DASH_SIZE_PX },
    u_highlightDashGap: { value: HIGHLIGHT_DASH_GAP_PX },
    u_highlightZoom: AcTrMaterialManager.CameraZoomUniform
  }
}

/**
 * Returns persistent highlight uniforms stored on material runtime userData.
 *
 * @param material - Material whose compiled program receives highlight uniforms.
 * @returns Shared uniform bag for the material.
 */
function getOrCreateHighlightUniforms(
  material: THREE.Material
): AcTrBatchHighlightUniforms {
  const runtime = getMaterialRuntimeUserData(material)
  if (!runtime.batchHighlightUniforms) {
    runtime.batchHighlightUniforms = createHighlightUniforms()
  }
  return runtime.batchHighlightUniforms as AcTrBatchHighlightUniforms
}

/**
 * Resolves the dash wiring variant for one material.
 *
 * @param material - Material candidate for the highlight patch.
 * @returns Dash mode, or `'none'` when the material must not be patched.
 */
function resolveDashMode(
  material: THREE.Material
): AcTrBatchHighlightDashMode {
  if (material.type === 'LineMaterial') {
    return 'line2'
  }
  if (material instanceof THREE.LineBasicMaterial) {
    return 'line'
  }
  if (
    material instanceof THREE.ShaderMaterial &&
    material.vertexShader.includes('lineDistance')
  ) {
    return 'line'
  }
  return 'none'
}

/**
 * Injects the `slotId` attribute, the line-distance source, and their varyings
 * into a vertex shader.
 *
 * Pattern line materials already declare `attribute float lineDistance`, so the
 * declaration is only added when missing. Wide-line (`LineMaterial`) shaders
 * read per-instance distances following three's own `USE_DASH` convention.
 *
 * @param source - Original vertex shader source.
 * @param dashMode - Dash wiring variant from {@link resolveDashMode}.
 * @returns Patched vertex shader forwarding slot id and line distance.
 */
function injectVertexHighlight(
  source: string,
  dashMode: Exclude<AcTrBatchHighlightDashMode, 'none'>
) {
  const needsSlotId = !source.includes('vBatchSlotId')
  const needsDash = !source.includes('vBatchLineDistance')
  if (!needsSlotId && !needsDash) {
    return source
  }

  const declarations: string[] = []
  if (needsSlotId) {
    declarations.push('attribute float slotId;', 'varying float vBatchSlotId;')
  }
  if (needsDash) {
    if (dashMode === 'line2') {
      declarations.push(
        'attribute float instanceDistanceStart;',
        'attribute float instanceDistanceEnd;'
      )
    } else if (!source.includes('attribute float lineDistance')) {
      declarations.push('attribute float lineDistance;')
    }
    declarations.push('varying float vBatchLineDistance;')
  }

  let vertexShader = source
  const declarationBlock = declarations.join('\n')
  if (vertexShader.includes('#include <common>')) {
    vertexShader = vertexShader.replace(
      '#include <common>',
      `#include <common>
${declarationBlock}`
    )
  } else {
    vertexShader = `${declarationBlock}
${vertexShader}`
  }

  const assignments: string[] = []
  if (needsSlotId) {
    assignments.push('vBatchSlotId = slotId;')
  }
  if (needsDash) {
    assignments.push(
      dashMode === 'line2'
        ? 'vBatchLineDistance = ( position.y < 0.5 ) ? instanceDistanceStart : instanceDistanceEnd;'
        : 'vBatchLineDistance = lineDistance;'
    )
  }
  const assignmentBlock = assignments.join('\n')
  if (vertexShader.includes('#include <begin_vertex>')) {
    return vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
${assignmentBlock}`
    )
  }

  if (vertexShader.includes('void main() {')) {
    return vertexShader.replace(
      'void main() {',
      `void main() {
${assignmentBlock}`
    )
  }

  return vertexShader
}

/**
 * Injects highlight sampling helpers and applies dash discards before final
 * color output.
 *
 * Prefers replacing the final `gl_FragColor` assignment itself — that applies
 * the effect to the already-computed outgoing color and never reads
 * `gl_FragColor` before it was written (undefined behavior some drivers
 * exploit). When no assignment pattern matches, falls back to inserting the
 * apply call before standard output-processing includes.
 *
 * @param source - Original fragment shader source.
 * @returns Patched fragment shader and whether highlight application was wired in.
 */
function injectFragmentHighlight(source: string): {
  source: string
  injected: boolean
} {
  if (
    source.includes('applyBatchHighlight(gl_FragColor.rgb)') ||
    source.includes('applyBatchHighlight(diffuseColor.rgb)') ||
    source.includes('applyBatchHighlight( outgoingLight )')
  ) {
    return { source, injected: true }
  }

  // Both wiring strategies below insert a call to `applyBatchHighlight`; the
  // helper and its uniforms must exist before either one runs, otherwise the
  // replacement wins on raw sources (e.g. LineMaterial declares the final
  // `gl_FragColor` assignment literally) and the patched program fails to
  // compile with "no matching overloaded function found".
  const fragmentShader = source.includes('applyBatchHighlight')
    ? source
    : HIGHLIGHT_FRAGMENT_DECL + source

  // 1) Assignment replacement — unambiguous and safe for any material.
  const assignmentPatterns: Array<[string, string]> = [
    [
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      'gl_FragColor = vec4( applyBatchHighlight( diffuseColor.rgb ), alpha );'
    ],
    [
      'gl_FragColor = vec4( diffuseColor.rgb, opacity );',
      'gl_FragColor = vec4( applyBatchHighlight( diffuseColor.rgb ), opacity );'
    ],
    [
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'gl_FragColor = vec4( applyBatchHighlight( outgoingLight ), diffuseColor.a );'
    ]
  ]
  for (const [pattern, replacement] of assignmentPatterns) {
    if (fragmentShader.includes(pattern)) {
      return {
        source: fragmentShader.split(pattern).join(replacement),
        injected: true
      }
    }
  }

  // 2) Include-adjacent insertion — the assignment happens before these
  //    output-processing includes in every current three.js built-in, so the
  //    read is well-defined; the effect then survives tone mapping / dithering.
  const applySnippet =
    'gl_FragColor.rgb = applyBatchHighlight(gl_FragColor.rgb);'

  if (fragmentShader.includes('#include <colorspace_fragment>')) {
    return {
      source: fragmentShader
        .split('#include <colorspace_fragment>')
        .join(`${applySnippet}\n#include <colorspace_fragment>`),
      injected: true
    }
  }

  if (fragmentShader.includes('#include <tonemapping_fragment>')) {
    return {
      source: fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `${applySnippet}\n#include <tonemapping_fragment>`
      ),
      injected: true
    }
  }

  if (fragmentShader.includes('#include <dithering_fragment>')) {
    return {
      source: fragmentShader.replace(
        '#include <dithering_fragment>',
        `${applySnippet}\n#include <dithering_fragment>`
      ),
      injected: true
    }
  }

  return { source, injected: false }
}

/**
 * Logs a one-time development warning when highlight injection fails.
 *
 * @param material - Material whose fragment shader could not be patched.
 */
function warnUnpatchedHighlightMaterial(material: THREE.Material) {
  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'production'
  ) {
    return
  }

  const key = material.type
  if (warnedUnpatchedMaterials.has(key)) {
    return
  }
  warnedUnpatchedMaterials.add(key)
  console.warn(
    `[AcTrBatchHighlight] Could not inject highlight shader for material type "${key}". Highlight dashing may be skipped.`
  )
}

/**
 * Merges persistent highlight uniforms into one compiled shader parameter bag.
 *
 * @param shader - Shader parameters produced by Three.js compilation.
 * @param uniforms - Highlight uniform bag owned by the source material.
 */
function mergeShaderUniforms(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: AcTrBatchHighlightUniforms
) {
  shader.uniforms.u_highlightMask = uniforms.u_highlightMask
  shader.uniforms.u_highlightMaskSize = uniforms.u_highlightMaskSize
  shader.uniforms.u_highlightDashSize = uniforms.u_highlightDashSize
  shader.uniforms.u_highlightDashGap = uniforms.u_highlightDashGap
  shader.uniforms.u_highlightZoom = uniforms.u_highlightZoom
}

/**
 * Copies highlight uniforms onto a {@link THREE.ShaderMaterial} instance.
 *
 * @param material - Shader material receiving direct uniform references.
 * @param uniforms - Highlight uniform bag to bind.
 */
function attachHighlightUniforms(
  material: THREE.Material,
  uniforms: AcTrBatchHighlightUniforms
) {
  if (material instanceof THREE.ShaderMaterial) {
    material.uniforms.u_highlightMask = uniforms.u_highlightMask
    material.uniforms.u_highlightMaskSize = uniforms.u_highlightMaskSize
    material.uniforms.u_highlightDashSize = uniforms.u_highlightDashSize
    material.uniforms.u_highlightDashGap = uniforms.u_highlightDashGap
    material.uniforms.u_highlightZoom = uniforms.u_highlightZoom
  }
}

/**
 * Forces Three.js to recompile or refresh uniforms for a patched material.
 *
 * @param material - Material whose GPU program must be rebuilt or updated.
 */
function markMaterialProgramDirty(material: THREE.Material) {
  material.needsUpdate = true
  if (material instanceof THREE.ShaderMaterial) {
    material.uniformsNeedUpdate = true
  }
}

/**
 * Patches one line material so batched draw calls render highlighted slots as
 * screen-space dashes (without changing their color) via a per-batch mask
 * texture bound in {@link bindBatchHighlightUniforms}.
 *
 * Mesh and point materials are intentionally left untouched: their selection
 * feedback is provided by vertex markers, so they never pay a recompile.
 *
 * @param material - Drawable material compiled for batched geometry rendering.
 */
export function patchMaterialForBatchHighlight(material: THREE.Material) {
  const runtime = getMaterialRuntimeUserData(material)
  const uniforms = getOrCreateHighlightUniforms(material)

  if (!runtime.batchHighlightPatched) {
    const dashMode = resolveDashMode(material)
    if (dashMode === 'none') {
      return
    }

    if (material instanceof THREE.ShaderMaterial) {
      // Compute the fragment patch first. When highlight cannot be wired into
      // this shader, leave the material completely untouched: a half-patched
      // program would force a rebuild for nothing and could drop the whole
      // batch draw on strict drivers. Highlight dashing is simply skipped
      // for such materials.
      const fragmentPatch = injectFragmentHighlight(material.fragmentShader)
      if (!fragmentPatch.injected) {
        warnUnpatchedHighlightMaterial(material)
        return
      }
      runtime.batchHighlightPatched = true
      material.vertexShader = injectVertexHighlight(
        material.vertexShader,
        dashMode
      )
      material.fragmentShader = fragmentPatch.source
      attachHighlightUniforms(material, uniforms)
      markMaterialProgramDirty(material)
      return
    }

    runtime.batchHighlightPatched = true
    const previousOnBeforeCompile = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile?.call(material, shader, renderer)
      const fragmentPatch = injectFragmentHighlight(shader.fragmentShader)
      if (!fragmentPatch.injected) {
        warnUnpatchedHighlightMaterial(material)
        return
      }
      mergeShaderUniforms(shader, uniforms)
      shader.vertexShader = injectVertexHighlight(shader.vertexShader, dashMode)
      shader.fragmentShader = fragmentPatch.source
    }

    const previousCacheKey = material.customProgramCacheKey ?? (() => '')
    material.customProgramCacheKey = () =>
      `${previousCacheKey.call(material)}|batchHighlight:${dashMode}`

    markMaterialProgramDirty(material)
  }

  attachHighlightUniforms(material, uniforms)
}

/**
 * Binds one batch highlight mask to the compiled material uniforms.
 *
 * @param material - One material or material array used by the batch drawable.
 * @param state - CPU/GPU highlight mask owned by the batch container.
 */
export function bindBatchHighlightUniforms(
  material: THREE.Material | THREE.Material[],
  state: AcTrBatchHighlightState
) {
  const materials = Array.isArray(material) ? material : [material]
  const texture = state.uploadMaskTexture()

  for (const entry of materials) {
    patchMaterialForBatchHighlight(entry)
    const uniforms = getOrCreateHighlightUniforms(entry)
    uniforms.u_highlightMask.value = texture
    const dimensions = state.getMaskTextureDimensions()
    uniforms.u_highlightMaskSize.value.set(dimensions.width, dimensions.height)
    uniforms.u_highlightDashSize.value = HIGHLIGHT_DASH_SIZE_PX
    uniforms.u_highlightDashGap.value = HIGHLIGHT_DASH_GAP_PX
    if (entry instanceof THREE.ShaderMaterial) {
      entry.uniformsNeedUpdate = true
    }
  }
}

/**
 * Installs an `onBeforeRender` hook that uploads the batch highlight mask
 * before each draw call sharing the batch material.
 *
 * @param object - Batch drawable whose draw calls should refresh highlight uniforms.
 * @param state - CPU/GPU highlight mask owned by the batch container.
 */
export function installBatchHighlightRenderer(
  object: THREE.Object3D,
  state: AcTrBatchHighlightState
) {
  const runtime = object.userData as {
    batchHighlightRendererInstalled?: boolean
  }
  if (runtime.batchHighlightRendererInstalled) {
    return
  }
  runtime.batchHighlightRendererInstalled = true

  const previousOnBeforeRender = object.onBeforeRender
  object.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    material,
    group
  ) => {
    // Invoke the previous hook as a method of the drawable. Built-in hooks
    // such as LineSegments2.prototype.onBeforeRender read `this.material`
    // (LineMaterial resolution refresh) and throw on an undefined `this`.
    previousOnBeforeRender?.call(
      object,
      renderer,
      scene,
      camera,
      geometry,
      material,
      group
    )
    if (!state.hasAnyHighlight() || !material) {
      return
    }
    bindBatchHighlightUniforms(material, state)
  }
}
