import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import {
  AcCmColor,
  AcCmColorMethod,
  type AcDbColorTheme,
  AcDbDatabase,
  AcDbSystemVariables,
  AcDbSysVarManager
} from '@mlightcad/data-model'
import { computed, ref } from 'vue'

import {
  getColorThemeFromDatabase,
  setColorThemeForDatabase
} from './useSystemVars'

const currentTheme = ref<AcDbColorTheme>('dark')
let isThemeSyncInitialized = false

function applyThemeToDom(theme: AcDbColorTheme) {
  if (typeof document === 'undefined') return

  const html = document.documentElement
  html.classList.toggle('dark', theme === 'dark')
}

function updateCurrentTheme(theme: AcDbColorTheme) {
  currentTheme.value = theme
  applyThemeToDom(theme)
}

/**
 * Keeps the active drawing's model-space canvas background in step with the
 * UI theme (black in dark theme, white in light theme). Paper space keeps
 * its own paper-white background and is intentionally left untouched.
 */
function applyThemeCanvasBackground(
  database: AcDbDatabase | null,
  theme: AcDbColorTheme
) {
  if (!database) return

  const background = new AcCmColor(AcCmColorMethod.ByColor)
  background.setRGB(...(theme === 'dark' ? [0, 0, 0] : [255, 255, 255]))
  AcDbSysVarManager.instance().setVar(
    AcDbSystemVariables.MODELBKCOLOR,
    background,
    database
  )
}

function getExistingDocManager(): AcApDocManager | null {
  const singleton = AcApDocManager as unknown as {
    _instance?: AcApDocManager
  }
  return singleton._instance ?? null
}

function getCurrentDatabase(): AcDbDatabase | null {
  return getExistingDocManager()?.curDocument?.database ?? null
}

function syncThemeFromDatabase(database: AcDbDatabase | null) {
  if (!database) return
  updateCurrentTheme(getColorThemeFromDatabase(database))
}

export function ensureColorThemeSync() {
  if (isThemeSyncInitialized) return

  const docManager = getExistingDocManager()
  if (!docManager) return

  isThemeSyncInitialized = true
  syncThemeFromDatabase(getCurrentDatabase())

  AcDbSysVarManager.instance().events.sysVarChanged.addEventListener(args => {
    if (
      args.name.toLowerCase() !== AcDbSystemVariables.COLORTHEME.toLowerCase()
    ) {
      return
    }
    const theme = getColorThemeFromDatabase(args.database)
    updateCurrentTheme(theme)
    applyThemeCanvasBackground(args.database, theme)
  })

  docManager.events.documentActivated.addEventListener(args => {
    syncThemeFromDatabase(args.doc.database)
  })
}

export function setColorTheme(
  theme: AcDbColorTheme,
  database?: AcDbDatabase | null
) {
  updateCurrentTheme(theme)

  ensureColorThemeSync()

  const targetDatabase = database ?? getCurrentDatabase()
  if (!targetDatabase) return

  applyThemeCanvasBackground(targetDatabase, theme)

  if (getColorThemeFromDatabase(targetDatabase) === theme) return
  setColorThemeForDatabase(targetDatabase, theme)
}

export const isDark = computed<boolean>({
  get: () => currentTheme.value === 'dark',
  set: value => {
    setColorTheme(value ? 'dark' : 'light')
  }
})

export const toggleDark = () => {
  setColorTheme(isDark.value ? 'light' : 'dark')
}

applyThemeToDom(currentTheme.value)
