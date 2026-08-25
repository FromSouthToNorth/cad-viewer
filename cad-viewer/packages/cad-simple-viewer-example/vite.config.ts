import { createReadStream, existsSync, statSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { exampleRollupOutput } from '../vite-config/pluginRollupOutput'
import {
  DATA_MODEL_PACKAGE,
  DXF_PARSER_WORKER_FILE,
  LIBREDWG_CONVERTER_PACKAGE,
  LIBREDWG_PARSER_WASM_FILE,
  LIBREDWG_PARSER_WORKER_FILE,
  MTEXT_RENDERER_WORKER_FILE
} from '../../tools/worker-assets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Relative to this package root; works with vite-plugin-static-copy on Windows. */
const VIEWER_RUNTIME_SRC = '../cad-html-plugin/dist/viewer-runtime.iife.js'

export default defineConfig(() => {
  const runtimePath = resolve(__dirname, VIEWER_RUNTIME_SRC)
  const hasViewerRuntime = existsSync(runtimePath)
  if (!hasViewerRuntime) {
    console.warn(
      '[cad-simple-viewer-example] viewer-runtime.iife.js not found — HTML export (chtml) will be unavailable. ' +
        'Build @mlightcad/cad-html-plugin to enable it. Opening DXF/DWG does not require this file.'
    )
  }

  const realdwgRoot = resolve(__dirname, '../../../realdwg-web')
  const cadToolsRoot = resolve(__dirname, '../../../cad-tools')
  const libredwgDist = `./node_modules/${LIBREDWG_CONVERTER_PACKAGE}/dist`
  const libredwgWasmSrc = resolve(
    __dirname,
    'node_modules',
    LIBREDWG_CONVERTER_PACKAGE,
    'dist',
    LIBREDWG_PARSER_WASM_FILE
  )

  const cadLayerDir = resolve(cadToolsRoot, 'cadLayer')

  return {
    base: './',
    server: {
      // Local pnpm overrides point at sibling realdwg-web packages.
      // cad-tools/cadLayer 目录包含默认加载的矿图 DXF 样本。
      fs: {
        allow: [resolve(__dirname, '../..'), realdwgRoot, cadToolsRoot]
      },
      watch: {
        // Avoid HMR reloads when realdwg-web rebuilds mid OPENPROF run.
        ignored: ['**/realdwg-web/**']
      }
    },
    configureServer(server) {
      // 提供 cad-tools/cadLayer 目录的静态文件服务(用于默认加载矿图 DXF)
      // 访问路径: /cadlayer/<filename>
      const MIME_TYPES: Record<string, string> = {
        '.dxf': 'application/dxf',
        '.dwg': 'application/octet-stream'
      }
      server.middlewares.use('/cadlayer', (req, res, next) => {
        const fileName = decodeURIComponent(req.url || '').replace(/^\/+/, '')
        if (!fileName) {
          return next()
        }
        const filePath = join(cadLayerDir, fileName)
        // 防止路径穿越
        if (!filePath.startsWith(cadLayerDir)) {
          return next()
        }
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          return next()
        }
        const ext = extname(filePath).toLowerCase()
        const mime = MIME_TYPES[ext] || 'application/octet-stream'
        res.setHeader('Content-Type', mime)
        res.setHeader('Accept-Ranges', 'bytes')
        createReadStream(filePath).pipe(res)
      })
    },
    build: {
      modulePreload: false,
      minify: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        output: exampleRollupOutput
      }
    },
    plugins: [
      vue(),
      viteStaticCopy({
        targets: [
          {
            src: `./node_modules/@mlightcad/cad-simple-viewer/dist/${MTEXT_RENDERER_WORKER_FILE}`,
            dest: 'workers',
            rename: { stripBase: true }
          },
          {
            src: `./node_modules/${DATA_MODEL_PACKAGE}/dist/${DXF_PARSER_WORKER_FILE}`,
            dest: 'workers',
            rename: { stripBase: true }
          },
          {
            src: `${libredwgDist}/${LIBREDWG_PARSER_WORKER_FILE}`,
            dest: 'workers',
            rename: { stripBase: true }
          },
          ...(existsSync(libredwgWasmSrc)
            ? [
                {
                  src: `${libredwgDist}/${LIBREDWG_PARSER_WASM_FILE}`,
                  dest: 'workers',
                  rename: { stripBase: true }
                }
              ]
            : []),
          ...(hasViewerRuntime
            ? [
                {
                  src: VIEWER_RUNTIME_SRC,
                  dest: '',
                  rename: { stripBase: true }
                }
              ]
            : [])
        ]
      })
    ]
  }
})
