import { createRequire } from 'node:module'

import type { FrontronDesktopContext } from '../types'
import type { RuntimeManifest } from './manifest'

const require = createRequire(import.meta.url)
const electron = require('electron') as typeof import('electron')
const { app, shell } = electron

type ElectronBrowserWindow = import('electron').BrowserWindow

function readOpenExternalUrl(input: string | { url: string }) {
  if (typeof input === 'string') {
    return input
  }

  return input.url
}

export function createDesktopContext(
  manifest: RuntimeManifest,
  getMainWindow: () => ElectronBrowserWindow | null,
  onWindowStateChanged?: () => void,
): FrontronDesktopContext {
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
        const mainWindow = getMainWindow()

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
        getMainWindow()?.hide()
      },
      focus() {
        getMainWindow()?.focus()
      },
      minimize() {
        getMainWindow()?.minimize()
      },
      toggleMaximize() {
        const mainWindow = getMainWindow()

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
        const mainWindow = getMainWindow()

        return {
          isMaximized: mainWindow?.isMaximized() ?? false,
          isMinimized: mainWindow?.isMinimized() ?? false,
        }
      },
    },
  }
}
