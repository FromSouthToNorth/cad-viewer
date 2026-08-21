import 'element-plus/dist/index.css'

import {
  DXF_PARSER_WORKER_FILE,
  LIBREDWG_PARSER_WORKER_FILE
} from '@mlightcad/cad-simple-viewer'
import { i18n } from '@mlightcad/cad-viewer'
import ElementPlus from 'element-plus'
import { createApp } from 'vue'

import App from './App.vue'
import { initializeLocale } from './locale'
import { registerLibreDwgConverter } from './registerLibreDwg'
import { registerNativeDxfConverter } from './registerNativeDxf'

const initApp = () => {
  // Opt into GPL DWG support before the viewer mounts.
  registerLibreDwgConverter(`./assets/${LIBREDWG_PARSER_WORKER_FILE}`)
  // DXF tokenizes in its parser worker when the bundle is deployed.
  registerNativeDxfConverter(`./assets/${DXF_PARSER_WORKER_FILE}`)

  // Register example-app messages up front: the upload screen renders
  // before the viewer is created, so it cannot wait for onViewerCreate.
  initializeLocale()

  const app = createApp(App)
  // Required when Vite aliases `@mlightcad/ui-components` to source: those SFCs
  // use `<el-*>` tags without local imports (their own build auto-imports them).
  app.use(ElementPlus)
  app.use(i18n)
  app.mount('#app')
  // Hide the loading spinner
  const loader = document.getElementById('loader')
  if (loader) {
    loader.style.display = 'none'
  }
}

initApp()
