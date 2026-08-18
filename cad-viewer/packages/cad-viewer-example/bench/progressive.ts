/**
 * Standalone browser benchmark page for progressive rendering (M2).
 *
 * Fetches a DXF over HTTP and opens it through the public AcApDocManager API,
 * the same pipeline the CLI runner uses. The status bar reports elapsed time,
 * an animation-frame counter, and a sampled count of non-background pixels on
 * the WebGL canvas, so a mid-load read shows whether the canvas paints before
 * the document finishes opening.
 *
 * Query params:
 *   ?progressive=0  open with progressiveRendering disabled (baseline A/B)
 *   ?file=NAME      fixture served from /bench/fixtures/ (default progressive.dxf)
 */
import { AcApDocManager, AcEdOpenMode } from '@mlightcad/cad-simple-viewer'

const bar = document.getElementById('bar') as HTMLDivElement
const paint = document.getElementById('paint') as HTMLDivElement
const params = new URLSearchParams(location.search)
const progressive = params.get('progressive') !== '0'
const file = params.get('file') ?? 'progressive.dxf'
const t0 = performance.now()

let frames = 0
let lastTick = performance.now()
let maxFrameGapMs = 0
let openOk: unknown = null
const tick = () => {
  const now = performance.now()
  const gap = now - lastTick
  lastTick = now
  if (gap > maxFrameGapMs) maxFrameGapMs = gap
  frames++
  if (frames % 30 === 0) {
    bar.textContent = `[${file}] progressive=${progressive} ok=${String(openOk)} elapsed=${(
      (now - t0) /
      1000
    ).toFixed(1)}s frames=${frames} maxFrameGap=${maxFrameGapMs.toFixed(0)}ms`
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

// Poll the view's THREE renderer statistics every 500ms. `info.render.calls`
// counts real renderer.render() invocations, so growth during loading proves
// incremental painting; staying at 0 during load proves deferred rendering.
// `points` grows as batched geometry is converted.
setInterval(() => {
  const instance = AcApDocManager.instance as unknown as Record<string, unknown>
  const view = (instance['curView'] ?? instance['currentView'] ?? null) as
    | Record<string, unknown>
    | null
  if (!view) {
    paint.textContent = 'view=null'
    return
  }
  const renderer = (view['renderer'] ?? view['_renderer']) as
    | { info?: { render?: { calls?: number; lines?: number; points?: number; triangles?: number } } }
    | {
        internalRenderer?: {
          info?: {
            render?: { calls?: number; lines?: number; points?: number; triangles?: number }
          }
        }
      }
    | undefined
  const info = renderer?.['internalRenderer']?.info ?? renderer?.info
  let stats: Record<string, unknown> | undefined
  try {
    stats = (view['stats'] as Record<string, unknown> | undefined) ?? undefined
  } catch {
    stats = undefined
  }
  const ownProps = Object.getOwnPropertyNames(view).join(',')
  paint.textContent = `view=${view.constructor?.name} renderCalls=${info?.render?.calls ?? 'n/a'} lines=${info?.render?.lines ?? 'n/a'} points=${info?.render?.points ?? 'n/a'} tris=${info?.render?.triangles ?? 'n/a'} processing=${view['isProcessingEntities'] ?? 'n/a'} entities=${stats?.entityCount ?? 'n/a'} meshSize=${stats?.meshSize ?? 'n/a'} lineSize=${stats?.lineSize ?? 'n/a'} unbatched=${stats?.unbatchedSize ?? 'n/a'} ownProps=[${ownProps.slice(0, 120)}]`
}, 500)

AcApDocManager.createInstance({
  container: document.getElementById('cad-root') as HTMLDivElement,
  width: 1280,
  height: 720,
  autoResize: true,
  useMainThreadDraw: true
})

const docManager = AcApDocManager.instance
bar.textContent = `[${file}] fetching…`
const response = await fetch(`/bench/fixtures/${file}`)
const buffer = await response.arrayBuffer()
bar.textContent = `[${file}] opening (progressive=${progressive})…`

const opened = await docManager.openDocument(file, buffer, {
  mode: AcEdOpenMode.Read,
  progressiveRendering: progressive
})
openOk = opened
bar.textContent = `[${file}] open complete in ${(
  (performance.now() - t0) /
  1000
).toFixed(1)}s (progressive=${progressive}, ok=${opened})`

// Debug hook for headless verification scripts (read-only introspection).
;(globalThis as Record<string, unknown>)['__mlViewDebug'] = docManager.curView
