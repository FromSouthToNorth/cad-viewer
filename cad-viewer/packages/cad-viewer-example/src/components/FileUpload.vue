<template>
  <div class="file-upload-container">
    <div class="upload-panel">
      <div class="upload-main">
        <section class="upload-hero">
          <div class="upload-icon">
            <el-icon :size="20">
              <UploadFilled />
            </el-icon>
          </div>
          <div class="upload-hero-text">
            <h1 class="upload-title">{{ $t('fileUpload.title') }}</h1>
            <p class="upload-subtitle">
              {{ $t('fileUpload.subtitle') }}
            </p>
          </div>
        </section>

        <div class="upload-actions">
          <button
            type="button"
            class="new-drawing-button"
            @click="handleNewDrawing"
          >
            {{ $t('fileUpload.newDrawing') }}
          </button>

          <p class="upload-divider" aria-hidden="true">
            <span>{{ $t('fileUpload.or') }}</span>
          </p>

          <el-upload
            class="upload-dropzone"
            drag
            :auto-upload="false"
            accept=".dwg,.dxf"
            :on-change="handleFileChange"
            :before-upload="beforeUpload"
          >
            <div class="dropzone-content">
              <p class="dropzone-title">
                {{ $t('fileUpload.dropFile') }}
                <span class="dropzone-link">{{ $t('fileUpload.browse') }}</span>
              </p>
              <div class="format-tags">
                <span class="format-tag">DWG</span>
                <span class="format-tag">DXF</span>
              </div>
            </div>
          </el-upload>
        </div>
      </div>

      <section class="settings-section">
        <header class="settings-header">
          <h2 class="settings-title">{{ $t('fileUpload.openOptions') }}</h2>
        </header>

        <div class="settings-grid">
          <div class="setting-block setting-block--full">
            <h3 class="setting-label">{{ $t('fileUpload.initialView') }}</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              :aria-label="$t('fileUpload.initialView')"
            >
              <button
                v-for="option in openViewModes"
                :key="option.value"
                type="button"
                class="pill-option"
                :class="{ 'is-active': selectedOpenViewMode === option.value }"
                role="radio"
                :aria-checked="selectedOpenViewMode === option.value"
                :title="option.description"
                @click="selectedOpenViewMode = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="setting-block setting-block--full">
            <h3 class="setting-label">{{ $t('fileUpload.accessMode') }}</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              :aria-label="$t('fileUpload.accessMode')"
            >
              <button
                v-for="mode in accessModes"
                :key="mode.value"
                type="button"
                class="pill-option"
                :class="{ 'is-active': selectedMode === mode.value }"
                role="radio"
                :aria-checked="selectedMode === mode.value"
                :title="mode.description"
                @click="selectedMode = mode.value"
              >
                {{ mode.label }}
              </button>
            </div>
          </div>

          <div class="setting-block">
            <h3 class="setting-label">{{ $t('fileUpload.textRendering') }}</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              :aria-label="$t('fileUpload.textRendering')"
            >
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': !useMainThreadDraw }"
                role="radio"
                :aria-checked="!useMainThreadDraw"
                :title="$t('fileUpload.textRenderingModes.workerDesc')"
                @click="useMainThreadDraw = false"
              >
                {{ $t('fileUpload.textRenderingModes.worker') }}
              </button>
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': useMainThreadDraw }"
                role="radio"
                :aria-checked="useMainThreadDraw"
                :title="$t('fileUpload.textRenderingModes.mainThreadDesc')"
                @click="useMainThreadDraw = true"
              >
                {{ $t('fileUpload.textRenderingModes.mainThread') }}
              </button>
            </div>
          </div>

          <div class="setting-block">
            <h3 class="setting-label">{{ $t('fileUpload.progressive') }}</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              :aria-label="$t('fileUpload.progressive')"
            >
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': progressiveRendering }"
                role="radio"
                :aria-checked="progressiveRendering"
                :title="$t('fileUpload.progressiveModes.onDesc')"
                @click="progressiveRendering = true"
              >
                {{ $t('fileUpload.progressiveModes.on') }}
              </button>
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': !progressiveRendering }"
                role="radio"
                :aria-checked="!progressiveRendering"
                :title="$t('fileUpload.progressiveModes.offDesc')"
                @click="progressiveRendering = false"
              >
                {{ $t('fileUpload.progressiveModes.off') }}
              </button>
            </div>
          </div>

          <div class="setting-block">
            <h3 class="setting-label">{{ $t('fileUpload.nonPlottable') }}</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              :aria-label="$t('fileUpload.nonPlottable')"
            >
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': !drawNoPlotLayers }"
                role="radio"
                :aria-checked="!drawNoPlotLayers"
                :title="$t('fileUpload.nonPlottableModes.hideDesc')"
                @click="drawNoPlotLayers = false"
              >
                {{ $t('fileUpload.nonPlottableModes.hide') }}
              </button>
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': drawNoPlotLayers }"
                role="radio"
                :aria-checked="drawNoPlotLayers"
                :title="$t('fileUpload.nonPlottableModes.showDesc')"
                @click="drawNoPlotLayers = true"
              >
                {{ $t('fileUpload.nonPlottableModes.show') }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { UploadFilled } from '@element-plus/icons-vue'
import { AcApOpenViewMode, AcEdOpenMode } from '@mlightcad/cad-simple-viewer'
import { log } from '@mlightcad/data-model'
import type { UploadFile, UploadProps } from 'element-plus'
import { ElIcon, ElUpload } from 'element-plus'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  onFileSelect: (
    file: File,
    mode: AcEdOpenMode,
    useMainThreadDraw: boolean,
    drawNoPlotLayers: boolean,
    progressiveRendering: boolean,
    openViewMode: AcApOpenViewMode | undefined
  ) => void
  onNewDrawing?: (
    mode: AcEdOpenMode,
    useMainThreadDraw: boolean,
    drawNoPlotLayers: boolean,
    progressiveRendering: boolean,
    openViewMode: AcApOpenViewMode | undefined
  ) => void
}

const props = defineProps<Props>()

const { t } = useI18n()

type OpenViewModeChoice = 'auto' | AcApOpenViewMode

const selectedMode = ref<AcEdOpenMode>(AcEdOpenMode.Write)
const selectedOpenViewMode = ref<OpenViewModeChoice>('auto')
const useMainThreadDraw = ref(false)
const drawNoPlotLayers = ref(false)
const progressiveRendering = ref(false)

const openViewModes = computed(() => [
  {
    value: 'auto' as const,
    label: t('fileUpload.viewModes.auto'),
    description: t('fileUpload.viewModes.autoDesc')
  },
  {
    value: AcApOpenViewMode.Extents,
    label: t('fileUpload.viewModes.extents'),
    description: t('fileUpload.viewModes.extentsDesc')
  },
  {
    value: AcApOpenViewMode.Saved,
    label: t('fileUpload.viewModes.saved'),
    description: t('fileUpload.viewModes.savedDesc')
  }
])

const resolveOpenViewMode = (): AcApOpenViewMode | undefined =>
  selectedOpenViewMode.value === 'auto' ? undefined : selectedOpenViewMode.value

const accessModes = computed(() => [
  {
    value: AcEdOpenMode.Read,
    label: t('fileUpload.accessModes.read'),
    description: t('fileUpload.accessModes.readDesc')
  },
  {
    value: AcEdOpenMode.Review,
    label: t('fileUpload.accessModes.review'),
    description: t('fileUpload.accessModes.reviewDesc')
  },
  {
    value: AcEdOpenMode.Write,
    label: t('fileUpload.accessModes.write'),
    description: t('fileUpload.accessModes.writeDesc')
  }
])

const handleFileChange: UploadProps['onChange'] = (uploadFile: UploadFile) => {
  if (uploadFile.raw) {
    if (isValidFile(uploadFile.raw)) {
      props.onFileSelect(
        uploadFile.raw,
        selectedMode.value,
        useMainThreadDraw.value,
        drawNoPlotLayers.value,
        progressiveRendering.value,
        resolveOpenViewMode()
      )
    }
  }
}

const handleNewDrawing = () => {
  props.onNewDrawing?.(
    selectedMode.value,
    useMainThreadDraw.value,
    drawNoPlotLayers.value,
    progressiveRendering.value,
    resolveOpenViewMode()
  )
}

const beforeUpload: UploadProps['beforeUpload'] = (rawFile: File) => {
  if (!isValidFile(rawFile)) {
    log.warn('Invalid file type. Please upload DWG or DXF files.')
    return false
  }
  return true
}

const isValidFile = (file: File): boolean => {
  const validExtensions = ['.dwg', '.dxf']
  const fileName = file.name.toLowerCase()
  return validExtensions.some(ext => fileName.endsWith(ext))
}
</script>

<style scoped>
.file-upload-container {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 820px;
  padding: 12px 16px;
  box-sizing: border-box;
}

.upload-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto;
  width: 100%;
  border-radius: 14px;
  background: #ffffff;
  box-shadow:
    0 20px 40px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.upload-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18px 20px;
}

.upload-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.upload-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #5b6fd6 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.28);
}

.upload-hero-text {
  min-width: 0;
}

.upload-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #0f172a;
  line-height: 1.25;
}

.upload-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}

.upload-actions {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.new-drawing-button {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #5b6fd6 100%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(102, 126, 234, 0.26);
  transition:
    transform 0.15s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.new-drawing-button:hover {
  filter: brightness(1.03);
  box-shadow: 0 8px 18px rgba(102, 126, 234, 0.32);
}

.new-drawing-button:active {
  transform: translateY(1px);
}

.upload-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.upload-divider::before,
.upload-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.upload-dropzone {
  width: 100%;
  box-sizing: border-box;
}

.upload-dropzone :deep(.el-upload) {
  display: block;
  width: 100%;
}

.upload-dropzone :deep(.el-upload-dragger) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 12px;
  border: 1.5px dashed #c7d2fe;
  border-radius: 10px;
  background: #f8faff;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}

.upload-dropzone :deep(.el-upload-dragger:hover) {
  border-color: #667eea;
  background: #f1f5ff;
  box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.08);
}

.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.dropzone-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.dropzone-link {
  color: #667eea;
  font-weight: 600;
}

.format-tags {
  display: flex;
  gap: 6px;
}

.format-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: #e8edff;
  color: #4f5fd0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.settings-section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18px 20px;
  background: #f8fafc;
  border-left: 1px solid #e8edf5;
}

.settings-header {
  margin-bottom: 10px;
}

.settings-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 12px;
}

.setting-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-block--full {
  grid-column: 1 / -1;
}

.setting-label {
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #94a3b8;
}

.pill-segment {
  display: flex;
  gap: 0;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  background: #ffffff;
  overflow: hidden;
}

.pill-option {
  flex: 1;
  padding: 6px 8px;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.pill-option:not(:last-child) {
  border-right: 1px solid #e2e8f0;
}

.pill-option:hover:not(.is-active) {
  background: #f8fafc;
  color: #475569;
}

.pill-option.is-active {
  background: #f1f5ff;
  color: #4f5fd0;
}

/* Dark theme overrides (Element Plus dark palette) */
:root[data-ml-ui-theme='dark'] .upload-panel {
  background: #1d1e1f;
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.06);
}

:root[data-ml-ui-theme='dark'] .upload-title {
  color: #e5eaf3;
}

:root[data-ml-ui-theme='dark'] .upload-subtitle {
  color: #a3a6ad;
}

:root[data-ml-ui-theme='dark'] .upload-divider {
  color: #8a8f99;
}

:root[data-ml-ui-theme='dark'] .upload-divider::before,
:root[data-ml-ui-theme='dark'] .upload-divider::after {
  background: #414243;
}

:root[data-ml-ui-theme='dark'] .upload-dropzone :deep(.el-upload-dragger) {
  border-color: #4c4d4f;
  background: #262727;
}

:root[data-ml-ui-theme='dark'] .upload-dropzone :deep(.el-upload-dragger:hover) {
  border-color: #589ef8;
  background: #2b3139;
  box-shadow: inset 0 0 0 1px rgba(88, 158, 248, 0.12);
}

:root[data-ml-ui-theme='dark'] .dropzone-title {
  color: #e5eaf3;
}

:root[data-ml-ui-theme='dark'] .dropzone-link {
  color: #79aefc;
}

:root[data-ml-ui-theme='dark'] .format-tag {
  background: rgba(102, 126, 234, 0.18);
  color: #a8b8f0;
}

:root[data-ml-ui-theme='dark'] .settings-section {
  background: #141414;
  border-left-color: #414243;
}

:root[data-ml-ui-theme='dark'] .settings-title {
  color: #cfd3dc;
}

:root[data-ml-ui-theme='dark'] .setting-label {
  color: #8a8f99;
}

:root[data-ml-ui-theme='dark'] .pill-segment {
  border-color: #414243;
  background: #1d1e1f;
}

:root[data-ml-ui-theme='dark'] .pill-option {
  color: #a3a6ad;
}

:root[data-ml-ui-theme='dark'] .pill-option:not(:last-child) {
  border-right-color: #414243;
}

:root[data-ml-ui-theme='dark'] .pill-option:hover:not(.is-active) {
  background: #262727;
  color: #cfd3dc;
}

:root[data-ml-ui-theme='dark'] .pill-option.is-active {
  background: rgba(88, 158, 248, 0.15);
  color: #79aefc;
}

/* Narrow viewports: stack upload + settings as two vertical rows */
@media (max-width: 768px) {
  .file-upload-container {
    max-width: 100%;
    padding: 12px;
  }

  .upload-panel {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }

  .settings-section {
    border-left: none;
    border-top: 1px solid #e8edf5;
  }

  :root[data-ml-ui-theme='dark'] .settings-section {
    border-top-color: #414243;
  }

  .settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .setting-block--full {
    grid-column: 1 / -1;
  }
}

@media (max-width: 400px) {
  .upload-main,
  .settings-section {
    padding-left: 14px;
    padding-right: 14px;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .setting-block--full {
    grid-column: auto;
  }
}
</style>
