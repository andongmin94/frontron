import { existsSync } from "node:fs"
import path from "path"
import { app, BrowserWindow, shell } from "electron"

import { __dirname, isDev, isQuitting } from "./main.js"
import { closeSplash } from "./splash.js"

export let mainWindow: BrowserWindow | null = null

// isRendererUrl 함수는 URL이 현재 렌더러와 같은 protocol과 host인지 확인한다.
function isRendererUrl(urlString: string, rendererUrl: URL) {
  try {
    const url = new URL(urlString)
    return url.protocol === rendererUrl.protocol && url.host === rendererUrl.host
  } catch {
    return false
  }
}

// openExternalHttpUrl 함수는 안전한 외부 웹 URL만 기본 브라우저로 연다.
function openExternalHttpUrl(urlString: string) {
  try {
    const url = new URL(urlString)

    if (url.protocol !== "http:" && url.protocol !== "https:") return

    void shell.openExternal(url.toString()).catch((error) => {
      console.error("Failed to open external URL:", error)
    })
  } catch {
    return
  }
}

// createWindow 함수는 렌더러 URL을 로드하는 메인 창을 만든다.
export function createWindow(rendererUrl: string) {
  const preloadPath = path.join(__dirname, "preload.js")
  const windowIconPath = path.join(__dirname, "../../public/icon.ico")

  if (!existsSync(preloadPath)) {
    console.error(`Preload script not found at ${preloadPath}.`)
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    frame: false,
    resizable: isDev,
    ...(existsSync(windowIconPath) ? { icon: windowIconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      preload: preloadPath,
    },
  })

  const rendererBaseUrl = new URL(rendererUrl)

  mainWindow.webContents.on("will-redirect", (details) => {
    if (isRendererUrl(details.url, rendererBaseUrl)) return

    details.preventDefault()
    openExternalHttpUrl(details.url)
  })

  mainWindow.webContents.on("will-frame-navigate", (details) => {
    if (isRendererUrl(details.url, rendererBaseUrl)) return

    details.preventDefault()

    if (details.isMainFrame) {
      openExternalHttpUrl(details.url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererUrl(url, rendererBaseUrl)) {
      openExternalHttpUrl(url)
    }

    return { action: "deny" }
  })

  mainWindow.loadURL(rendererUrl)

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash()
    if (!process.env.FRONTRON_RENDERER_PROBE_PATH) {
      mainWindow?.show()
    }

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
