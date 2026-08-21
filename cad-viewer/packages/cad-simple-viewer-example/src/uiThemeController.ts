import {
  acedApplyUiTheme,
  type AcEdUiTheme,
  isLightColorTheme
} from '@mlightcad/cad-simple-viewer'
import {
  type AcDbDatabase,
  type AcDbSysVarEventArgs,
  AcDbSystemVariables,
  AcDbSysVarManager
} from '@mlightcad/data-model'

const THEME_STORAGE_KEY = 'cad-simple-viewer-example:ui-theme'

/** Reads the persisted shell theme, defaulting to dark. */
export function readStoredShellTheme(): AcEdUiTheme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage unavailable (privacy mode) — fall through to the default
  }
  return 'dark'
}

function persistShellTheme(theme: AcEdUiTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // best effort only
  }
}

/**
 * Keeps the whole example shell (sidebar, dev toolbar, menus) in sync with
 * the viewer UI theme.
 *
 * The simple-UI plugin owns `data-ml-ui-theme` on the viewer pane and routes
 * theme changes through the session-scoped `COLORTHEME` sysvar. This
 * controller mirrors the active theme onto `document.documentElement` so the
 * shell outside the viewer pane follows, and persists the choice.
 */
export class ShellUiThemeController {
  private observer?: MutationObserver

  constructor(
    private readonly viewerPane: HTMLElement,
    private readonly getDatabase: () => AcDbDatabase | undefined,
    private readonly onThemeChanged?: (theme: AcEdUiTheme) => void
  ) {}

  start() {
    this.apply(readStoredShellTheme(), false)
    AcDbSysVarManager.instance().events.sysVarChanged.addEventListener(
      this.handleSysVarChanged
    )
    // Covers plugin-side toggles that bypass COLORTHEME when no drawing is
    // open (its theme sync writes the host attribute directly in that case).
    this.observer = new MutationObserver(() => {
      if (this.getDatabase()) return
      const attr = this.viewerPane.getAttribute('data-ml-ui-theme')
      if ((attr === 'light' || attr === 'dark') && attr !== this.getTheme()) {
        this.apply(attr)
      }
    })
    this.observer.observe(this.viewerPane, {
      attributes: true,
      attributeFilter: ['data-ml-ui-theme']
    })
    this.onThemeChanged?.(this.getTheme())
  }

  stop() {
    AcDbSysVarManager.instance().events.sysVarChanged.removeEventListener(
      this.handleSysVarChanged
    )
    this.observer?.disconnect()
    this.observer = undefined
  }

  getTheme(): AcEdUiTheme {
    const attr = document.documentElement.getAttribute('data-ml-ui-theme')
    return attr === 'light' || attr === 'dark' ? attr : 'dark'
  }

  toggle() {
    this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark')
  }

  /**
   * Routes through `COLORTHEME` when a drawing is open so the plugin chrome
   * (toolbar, dock panel, dialogs) updates through the same code path.
   */
  setTheme(theme: AcEdUiTheme) {
    const database = this.getDatabase()
    if (database) {
      AcDbSysVarManager.instance().setVar(
        AcDbSystemVariables.COLORTHEME,
        theme === 'light' ? 1 : 0,
        database
      )
      return
    }
    this.apply(theme)
    // Keep the plugin theme sync's host in step even before its install.
    acedApplyUiTheme(theme, this.viewerPane)
  }

  /**
   * Re-asserts the shell theme into the session `COLORTHEME` value.
   *
   * Call when a document is activated: `COLORTHEME` is session-scoped and
   * defaults to dark, so without this the plugin would reset the chrome to
   * dark on every drawing open regardless of the stored preference.
   */
  syncActiveDocument() {
    this.setTheme(this.getTheme())
  }

  private handleSysVarChanged = (args: AcDbSysVarEventArgs) => {
    if (
      args.name.toLowerCase() !== AcDbSystemVariables.COLORTHEME.toLowerCase()
    ) {
      return
    }
    const database = this.getDatabase()
    if (!database || args.database !== database) return
    this.apply(isLightColorTheme(args.newVal) ? 'light' : 'dark')
  }

  private apply(theme: AcEdUiTheme, persist = true) {
    acedApplyUiTheme(theme, document.documentElement)
    if (persist) persistShellTheme(theme)
    this.onThemeChanged?.(theme)
  }
}
