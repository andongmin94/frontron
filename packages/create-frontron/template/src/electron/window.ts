import { existsSync } from "node:fs"
import path from "path"
import { app, BrowserWindow } from "electron"

import { __dirname, isDev, isQuitting } from "./main.js"
import { closeSplash } from "./splash.js"

export let mainWindow: BrowserWindow | null = null

function toWebSocketOrigin(rendererUrl: URL) {
  return `${rendererUrl.protocol === "https:" ? "wss:" : "ws:"}//${rendererUrl.host}`
}

function buildContentSecurityPolicy(rendererUrl: string) {
  const origin = new URL(rendererUrl)
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origin.origin}`
      : "script-src 'self'",
    isDev
      ? `connect-src 'self' ${origin.origin} ${toWebSocketOrigin(origin)}`
      : "connect-src 'self'",
  ]

  return directives.join("; ")
}

export function createWindow(rendererUrl: string) {
  const preloadPath = path.join(__dirname, "preload.js")

  if (!existsSync(preloadPath)) {
    console.error(`Preload script not found at ${preloadPath}.`)
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      preload: preloadPath,
    },
  })

  const rendererOrigin = new URL(rendererUrl).origin
  const contentSecurityPolicy = buildContentSecurityPolicy(rendererUrl)

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    {
      urls: [`${rendererOrigin}/*`],
    },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [contentSecurityPolicy],
        },
      })
    }
  )

  mainWindow.loadURL(rendererUrl)

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash()
    mainWindow?.show()

    if (isDev) {
      void mainWindow?.webContents
        .executeJavaScript(
          `Boolean(window.electron && typeof window.electron.getWindowState === "function")`,
          true
        )
        .then((hasBridge) => {
          if (!hasBridge) {
            console.warn(
              "[template] Preload bridge is unavailable in the renderer."
            )
          }
        })
        .catch(() => {})
    }
  })

  if (isDev) {
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`[template] Preload error at ${preloadPath}:`, error)
    })

    mainWindow.webContents.on("console-message", (details) => {
      if (details.level === "warning" || details.level === "error") {
        console.error(`[renderer:${details.level}] ${details.message}`)
      }
    })
  }

  if (process.platform === "win32") {
    mainWindow.on("system-context-menu", (event) => {
      event.preventDefault()
    })
  } else {
    mainWindow.webContents.on("context-menu", (event) => {
      event.preventDefault()
    })
  }

  mainWindow.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
      app.dock?.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}
