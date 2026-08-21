import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * Builds the DXF parser worker as a self-contained ES bundle
 * (`dist/dxf-parser-worker.js`). A plain Rollup entry (not `build.lib`) keeps
 * parity with the LibreDWG worker build and avoids lib-mode asset inlining.
 */
export default defineConfig({
  base: './',
  esbuild: {
    drop: ['console'],
    legalComments: 'none'
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'src/dxf/AcDbDxfParserWorker.ts'),
      external: [],
      output: {
        format: 'es',
        entryFileNames: 'dxf-parser-worker.js',
        inlineDynamicImports: true,
        compact: true
      }
    },
    minify: 'esbuild'
  }
})
