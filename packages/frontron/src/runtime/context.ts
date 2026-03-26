import { createRequire } from 'node:module'

import type {
  FrontronDesktopContext,
  FrontronUpdateState,
  FrontronWindowBounds,
  FrontronWindowPosition,
  FrontronWindowState,
} from '../types'
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

function readWindowBounds(targetWindow: ElectronBrowserWindow | null): FrontronWindowBounds | null {
  if (!targetWindow) {
    return null
  }

  const { x, y, width, height } = targetWindow.getBounds()
  return { x, y, width, height }
}

function readWindowPosition(
  targetWindow: ElectronBrowserWindow | null,
): FrontronWindowPosition | null {
  if (!targetWindow) {
    return null
  }

  const [x, y] = targetWindow.getPosition()
  return { x, y }
}

function createWindowState(targetWindow: ElectronBrowserWindow | null): FrontronWindowState {
  return {
    isMaximized: targetWindow?.isMaximized() ?? false,
    isMinimized: targetWindow?.isMinimized() ?? false,
    isVisible: targetWindow?.isVisible() ?? false,
    isFocused: targetWindow?.isFocused() ?? false,
    alwaysOnTop: targetWindow?.isAlwaysOnTop() ?? false,
    opacity: targetWindow?.getOpacity() ?? null,
    bounds: readWindowBounds(targetWindow),
    position: readWindowPosition(targetWindow),
  }
}

function revealWindow(targetWindow: ElectronBrowserWindow | null) {
  if (!targetWindow) {
    return
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore()
  }

  targetWindow.show()
  targetWindow.focus()
}

function revealWindowInactive(targetWindow: ElectronBrowserWindow | null) {
  if (!targetWindow) {
    return
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore()
  }

  targetWindow.showInactive()
}

function toggleWindowVisibility(targetWindow: ElectronBrowserWindow | null) {
  if (!targetWindow) {
    return
  }

  if (!targetWindow.isVisible() || targetWindow.isMinimized()) {
    revealWindow(targetWindow)
    return
  }

  targetWindow.hide()
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
      isVisible() {
        return windowController.getPrimaryWindow()?.isVisible() ?? false
      },
      isFocused() {
        return windowController.getPrimaryWindow()?.isFocused() ?? false
      },
      show() {
        revealWindow(windowController.getPrimaryWindow())
      },
      showInactive() {
        revealWindowInactive(windowController.getPrimaryWindow())
      },
      toggleVisibility() {
        toggleWindowVisibility(windowController.getPrimaryWindow())
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
      getBounds() {
        return readWindowBounds(windowController.getPrimaryWindow())
      },
      setBounds(bounds) {
        windowController.getPrimaryWindow()?.setBounds(bounds)
      },
      getPosition() {
        return readWindowPosition(windowController.getPrimaryWindow())
      },
      setPosition(position) {
        windowController.getPrimaryWindow()?.setPosition(position.x, position.y)
      },
      getAlwaysOnTop() {
        return windowController.getPrimaryWindow()?.isAlwaysOnTop() ?? false
      },
      setAlwaysOnTop(value) {
        windowController.getPrimaryWindow()?.setAlwaysOnTop(value)
      },
      getOpacity() {
        return windowController.getPrimaryWindow()?.getOpacity() ?? null
      },
      setOpacity(value) {
        windowController.getPrimaryWindow()?.setOpacity(value)
      },
      getState() {
        return createWindowState(windowController.getPrimaryWindow())
      },
    },
    windows: {
      async open(name) {
        await windowController.openConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.open'),
        )
      },
      isVisible(name) {
        return (
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.isVisible'),
          )?.isVisible() ?? false
        )
      },
      isFocused(name) {
        return (
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.isFocused'),
          )?.isFocused() ?? false
        )
      },
      async show(name) {
        revealWindow(
          await windowController.openConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.show'),
          ),
        )
      },
      async showInactive(name) {
        revealWindowInactive(
          await windowController.openConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.showInactive'),
          ),
        )
      },
      async toggleVisibility(name) {
        const configuredName = ensureConfiguredWindowName(
          name,
          'desktopContext.windows.toggleVisibility',
        )
        const targetWindow = windowController.getConfiguredWindow(configuredName)

        if (!targetWindow) {
          revealWindow(await windowController.openConfiguredWindow(configuredName))
          return
        }

        toggleWindowVisibility(targetWindow)
      },
      hide(name) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.hide'),
        )?.hide()
      },
      focus(name) {
        revealWindow(
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.focus'),
          ),
        )
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
      getBounds(name) {
        return readWindowBounds(
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.getBounds'),
          ),
        )
      },
      setBounds(name, bounds) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.setBounds'),
        )?.setBounds(bounds)
      },
      getPosition(name) {
        return readWindowPosition(
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.getPosition'),
          ),
        )
      },
      setPosition(name, position) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.setPosition'),
        )?.setPosition(position.x, position.y)
      },
      getAlwaysOnTop(name) {
        return (
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.getAlwaysOnTop'),
          )?.isAlwaysOnTop() ?? null
        )
      },
      setAlwaysOnTop(name, value) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.setAlwaysOnTop'),
        )?.setAlwaysOnTop(value)
      },
      getOpacity(name) {
        return (
          windowController.getConfiguredWindow(
            ensureConfiguredWindowName(name, 'desktopContext.windows.getOpacity'),
          )?.getOpacity() ?? null
        )
      },
      setOpacity(name, value) {
        windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.setOpacity'),
        )?.setOpacity(value)
      },
      getState(name) {
        const targetWindow = windowController.getConfiguredWindow(
          ensureConfiguredWindowName(name, 'desktopContext.windows.getState'),
        )

        if (!targetWindow) {
          return null
        }

        return createWindowState(targetWindow)
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
