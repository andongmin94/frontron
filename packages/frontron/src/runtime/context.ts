import { createRequire } from 'node:module'

import type { FrontronDesktopContext, FrontronUpdateState } from '../types'
import type { RuntimeManifest } from './manifest'

const require = createRequire(import.meta.url)
const electron = require('electron') as typeof import('electron')
const { app, shell } = electron

type ElectronBrowserWindow = import('electron').BrowserWindow

export interface RuntimeWindowController {
  getPrimaryWindow(): ElectronBrowserWindow | null
  openConfiguredWindow(name: string): Promise<ElectronBrowserWindow | null>
  getConfiguredWindow(name: string): ElectronBrowserWindow | null
  hasConfiguredWindow(name: string): boolean
  listConfiguredWindows(): string[]
  listOpenWindows(): string[]
}

function readOpenExternalUrl(input: string | { url: string }) {
  if (typeof input === 'string') {
    return input
  }

  return input.url
}

function createDisabledUpdateState(
  manifest: RuntimeManifest,
  status: FrontronUpdateState['status'] = 'disabled',
): FrontronUpdateState {
  return {
    enabled: false,
    supported: false,
    status,
    currentVersion: manifest.app.version,
  }
}

export function createDesktopContext(
  manifest: RuntimeManifest,
  windowController: RuntimeWindowController,
  onWindowStateChanged?: () => void,
  deepLinksController?: FrontronDesktopContext['deepLinks'],
  updatesController?: FrontronDesktopContext['updates'],
): FrontronDesktopContext {
  const ensureConfiguredWindowName = (
    name: string,
    owner: string,
  ) => {
    if (!windowController.hasConfiguredWindow(name)) {
      throw new Error(`[Frontron] "${owner}" references an unknown window "${name}".`)
    }

    return name
  }

  const fallbackDeepLinksController: FrontronDesktopContext['deepLinks'] = {
    getState() {
      return {
        enabled: false,
        schemes: [],
        pending: [],
      }
    },
    consumePending() {
      return []
    },
  }

  const fallbackUpdatesController: FrontronDesktopContext['updates'] = {
    getState() {
      return createDisabledUpdateState(manifest)
    },
    async check() {
      return createDisabledUpdateState(manifest)
    },
    quitAndInstall() {
      return false
    },
  }

  return {
    rootDir: manifest.rootDir,
    mode: manifest.mode,
    app: {
      quit() {
        app.quit()
      },
    },
    shell: {
      async openExternal(input) {
        await shell.openExternal(readOpenExternalUrl(input))
      },
    },
    window: {
      show() {
        const mainWindow = windowController.getPrimaryWindow()

        if (!mainWindow) {
          return
        }

        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }

        mainWindow.show()
        mainWindow.focus()
      },
      hide() {
        windowController.getPrimaryWindow()?.hide()
      },
      focus() {
        windowController.getPrimaryWindow()?.focus()
      },
      minimize() {
        windowController.getPrimaryWindow()?.minimize()
      },
      toggleMaximize() {
        const mainWindow = windowController.getPrimaryWindow()

        if (!mainWindow) {
          return
        }

        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize()
        } else {
          mainWindow.maximize()
        }

        onWindowStateChanged?.()
      },
      getState() {
        const mainWindow = windowController.getPrimaryWindow()

        return {
          isMaximized: mainWindow?.isMaximized() ?? false,
          isMinimized: mainWindow?.isMinimized() ?? false,
        }
      },
    },
    windows: {
      async open(name) {
        await windowController.openConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.open'),
        )
      },
      async show(name) {
        const targetWindow = await windowController.openConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.show'),
        )

        if (!targetWindow) {
          return
        }

        if (targetWindow.isMinimized()) {
          targetWindow.restore()
        }

        targetWindow.show()
        targetWindow.focus()
      },
      hide(name) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.hide'),
        )?.hide()
      },
      focus(name) {
        const targetWindow = windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.focus'),
        )

        if (!targetWindow) {
          return
        }

        if (targetWindow.isMinimized()) {
          targetWindow.restore()
        }

        targetWindow.focus()
      },
      close(name) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.close'),
        )?.close()
      },
      minimize(name) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.minimize'),
        )?.minimize()
      },
      toggleMaximize(name) {
        const targetWindow = windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.toggleMaximize'),
        )

        if (!targetWindow) {
          return
        }

        if (targetWindow.isMaximized()) {
          targetWindow.unmaximize()
        } else {
          targetWindow.maximize()
        }
      },
      exists(name) {
        return (
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.exists'),
          ) !== null
        )
      },
      getState(name) {
        const targetWindow = windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.getState'),
        )

        if (!targetWindow) {
          return null
        }

        return {
          isMaximized: targetWindow.isMaximized(),
          isMinimized: targetWindow.isMinimized(),
        }
      },
      listConfigured() {
        return windowController.listConfiguredWindows()
      },
      listOpen() {
        return windowController.listOpenWindows()
      },
    },
    deepLinks: deepLinksController ?? fallbackDeepLinksController,
    updates: updatesController ?? fallbackUpdatesController,
  }
}
