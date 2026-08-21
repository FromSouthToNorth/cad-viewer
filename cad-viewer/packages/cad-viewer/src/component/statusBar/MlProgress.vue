<template>
  <div v-if="visible" class="ml-progress" :title="stageTitle">
    <el-progress
      :text-inside="true"
      :stroke-width="20"
      :percentage="percentage"
      :format="format"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  AcApDocManager,
  eventBus,
  isOpenFileProgressComplete
} from '@mlightcad/cad-simple-viewer'
import {
  AcDbParsingTaskStats,
  AcDbProgressdEventArgs
} from '@mlightcad/data-model'
import { ElProgress } from 'element-plus'
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useNotificationCenter } from '../../composable'

const { t, te } = useI18n()
const percentage = ref(0)
const visible = ref(false)
const stageTitle = ref<string | undefined>(undefined)
const { warning } = useNotificationCenter()

const resetProgress = () => {
  percentage.value = 0
  visible.value = false
  stageTitle.value = undefined
}

/**
 * Maps a progress event to a localized stage label for the status-bar
 * tooltip, mirroring the overlay's `main.progress.*` key convention.
 * Returns `undefined` when no translation exists for the current stage.
 */
const resolveStageTitle = (data: AcDbProgressdEventArgs) => {
  if (data.stage === 'CONVERSION' && data.subStage) {
    const key = 'main.progress.' + data.subStage.replace(/_/g, '').toLowerCase()
    return te(key) ? t(key) : undefined
  }
  if (data.stage === 'FETCH_FILE') {
    return te('main.message.fetchingDrawingFile')
      ? t('main.message.fetchingDrawingFile')
      : undefined
  }
  return undefined
}

const updateProgress = (data: AcDbProgressdEventArgs) => {
  if (data.stage === 'CONVERSION') {
    if (data.subStage) {
      if (
        data.subStage === 'PARSE' &&
        data.subStageStatus === 'END' &&
        data.data
      ) {
        const stats = data.data as AcDbParsingTaskStats
        if (stats.unknownEntityCount > 0) {
          warning(
            t('main.notification.title.parsingWarning'),
            t('main.message.unknownEntities', {
              count: stats.unknownEntityCount
            })
          )
        }
      }
    }
  }
  percentage.value = data.percentage
  visible.value = !isOpenFileProgressComplete(data)
  stageTitle.value = resolveStageTitle(data) ?? undefined
}

const format = (percentage: number) => {
  return `${percentage.toFixed(0)}%`
}

onMounted(() => {
  eventBus.on('open-file-progress', updateProgress)
  eventBus.on('failed-to-open-file', resetProgress)
  AcApDocManager.instance.events.documentToBeOpened.addEventListener(
    resetProgress
  )
})

onUnmounted(() => {
  eventBus.off('open-file-progress', updateProgress)
  eventBus.off('failed-to-open-file', resetProgress)
  AcApDocManager.instance.events.documentToBeOpened.removeEventListener(
    resetProgress
  )
})
</script>

<style scoped>
.ml-progress {
  width: 100px;
}
</style>
