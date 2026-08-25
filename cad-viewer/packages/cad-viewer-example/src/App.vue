<template>
  <div id="app-root">
    <!-- Upload screen when no drawing is open -->
    <div v-if="!showViewer" class="upload-screen">
      <button
        type="button"
        class="theme-toggle"
        :aria-label="
          theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
        "
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '🌙 Dark' : '☀️ Light' }}
      </button>
      <FileUpload
        @file-select="handleFileSelect"
        @new-drawing="handleNewDrawing"
      />
    </div>

    <!-- CAD viewer when a file is selected or a new drawing is created -->
    <div v-else>
      <MlCadViewer
        :url="DEFAULT_DRAWING_URL"
        :local-file="store.selectedFile ?? undefined"
        :mode="selectedMode"
        :use-main-thread-draw="useMainThreadDraw"
        :draw-no-plot-layers="drawNoPlotLayers"
        :progressive-rendering="progressiveRendering"
        :open-view-mode="openViewMode"
        :theme="theme"
        @create="onViewerCreate"
        :base-url="BASE_URL"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// import { AcApSettingManager } from '@mlightcad/cad-simple-viewer'
import {
  AcApDocManager,
  AcApOpenViewMode,
  AcEdCommandStack,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer'
import { MlCadViewer } from '@mlightcad/cad-viewer'
import { log } from '@mlightcad/data-model'
import { computed, nextTick, ref, watch } from 'vue'

import { AcApQuitCmd } from './commands'
import FileUpload from './components/FileUpload.vue'
import { initializeLocale } from './locale'
import { store } from './store'

type UiTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'cad-viewer-example:ui-theme'

const readStoredTheme = (): UiTheme => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage unavailable (privacy mode) — fall through to the default
  }
  return 'dark'
}

const theme = ref<UiTheme>(readStoredTheme())

// Applies the example-shell theme. The viewer itself receives the same value
// through the `theme` prop, which writes the COLORTHEME sysvar.
const applyThemeToPage = (value: UiTheme) => {
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.setAttribute('data-ml-ui-theme', value)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value)
  } catch {
    // best effort only
  }
}

watch(theme, applyThemeToPage, { immediate: true })

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

const initialize = () => {
  initializeLocale()
  if (import.meta.env.DEV) {
    ;(
      window as Window & { AcApDocManager?: typeof AcApDocManager }
    ).AcApDocManager = AcApDocManager
  }
  const register = AcApDocManager.instance.commandManager
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'quit',
    'quit',
    new AcApQuitCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'exit',
    'exit',
    new AcApQuitCmd()
  )
}

// Decide whether to show command line vertical toolbar at the right side,
// performance stats, coordinates in status bar, etc.
// AcApSettingManager.instance.isShowCommandLine = false
// AcApSettingManager.instance.isShowToolbar = false
// AcApSettingManager.instance.isShowStats = false
// AcApSettingManager.instance.isShowCoordinate = false

const BASE_URL = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/'

// 默认加载的图纸 URL
// 通过 vite define 注入的 /@fs/ 前缀访问 server.fs.allow 中的本地文件
// 需要完整 URL(new URL() 要求绝对路径)
const CAD_LAYER_PREFIX = import.meta.env.VITE_CAD_LAYER_PREFIX as string
const DEFAULT_DRAWING_URL =
  typeof window !== 'undefined' && CAD_LAYER_PREFIX
    ? `${window.location.origin}${CAD_LAYER_PREFIX}${encodeURI('安全监控布置图.dxf')}`
    : ''

const showViewer = computed(
  () => store.selectedFile != null || store.isNewDrawing
)

const selectedMode = ref<AcEdOpenMode>(AcEdOpenMode.Write)
const useMainThreadDraw = ref(false)
const drawNoPlotLayers = ref(false)
const progressiveRendering = ref(true)
const openViewMode = ref<AcApOpenViewMode | undefined>(undefined)

const createNewDrawing = async () => {
  const success = await AcApDocManager.instance.newDocument({
    mode: selectedMode.value,
    drawNoPlotLayers: drawNoPlotLayers.value,
    progressiveRendering: progressiveRendering.value,
    ...(openViewMode.value != null ? { openViewMode: openViewMode.value } : {})
  })
  if (!success) {
    log.error('Failed to create new drawing')
  }
}

const onViewerCreate = async () => {
  initialize()
  // 如果提供了默认图纸 URL,不创建新空白文档(由 MlCadViewer 自动加载)
  if (store.isNewDrawing && !DEFAULT_DRAWING_URL) {
    await nextTick()
    await createNewDrawing()
  }
}

const applyOpenOptions = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  selectedMode.value = mode
  useMainThreadDraw.value = mainThreadDraw
  drawNoPlotLayers.value = showNoPlotLayers
  progressiveRendering.value = enableProgressiveRendering
  openViewMode.value = viewMode
}

// Handle file selection from upload component
const handleFileSelect = (
  file: File,
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  store.isNewDrawing = false
  store.selectedFile = file
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode
  )
}

const handleNewDrawing = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  store.selectedFile = null
  store.isNewDrawing = true
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode
  )
}
</script>

<style scoped>
#app-root {
  height: 100vh;
  position: fixed;
}

.upload-screen {
  height: 100vh;
  width: 100vw;
  display: flex;
  justify-content: center;
  align-items: safe center;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 0;
  padding: 16px;
  box-sizing: border-box;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  pointer-events: auto; /* Allow clicks on upload screen */
}

:root[data-ml-ui-theme='dark'] .upload-screen {
  background: linear-gradient(135deg, #1e2235 0%, #17142b 100%);
}

.theme-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(4px);
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.22);
}
</style>
