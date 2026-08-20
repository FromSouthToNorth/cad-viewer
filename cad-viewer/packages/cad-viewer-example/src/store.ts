import { reactive } from 'vue'

export const store = reactive<{
  selectedFile: File | null
  isNewDrawing: boolean
}>({
  selectedFile: null,
  // Start directly in MlCadViewer with a new empty drawing on app load.
  isNewDrawing: true
})
