// Minimal preset sources are kept as plain source templates so renderers.ts can
// focus on choosing which source to emit instead of carrying every runtime file.
// renderMinimalMainSource 함수는 minimal preset용 Electron main.ts 템플릿 소스를 만든다.
export function renderMinimalMainSource() {
  return `import { app, Menu } from 'electron'
import { createMainWindow, getMainWindow } from './window.js'
import { startRendererRuntime, stopRendererRuntime } from './serve.js'

const isDev = process.env.NODE_ENV === 'development'
let isQuitting = false

// boot 함수는 Electron 앱이 준비된 뒤 렌더러 런타임과 메인 창을 시작한다.
async function boot() {
  await app.whenReady()

  const rendererUrl = isDev
    ? process.env.ELECTRON_RENDERER_URL?.trim()
    : await startRendererRuntime()

  if (!rendererUrl) {
    throw new Error('ELECTRON_RENDERER_URL is required in development mode.')
  }

  createMainWindow(rendererUrl)

  if (!isDev) {
    Menu.setApplicationMenu(null)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()

    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void boot().catch(async (error) => {
    console.error('[frontron:init] Failed to start Electron.', error)
    await stopRendererRuntime().catch(() => {})
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', async () => {
    const mainWindow = getMainWindow()

    if (mainWindow) {
      mainWindow.show()
      return
    }

    const rendererUrl = isDev
      ? process.env.ELECTRON_RENDERER_URL?.trim()
      : await startRendererRuntime()

    if (rendererUrl) {
      createMainWindow(rendererUrl)
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    void stopRendererRuntime().catch(() => {})
  })

  app.on('browser-window-created', (_event, window) => {
    window.on('close', (event) => {
      if (process.platform === 'darwin' && !isQuitting) {
        event.preventDefault()
        window.hide()
        app.dock?.hide()
      }
    })
  })
}
`
}

// renderMinimalWindowSource 함수는 minimal preset용 Electron window.ts 템플릿 소스를 만든다.
export function renderMinimalWindowSource() {
  return `import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

const isDev = process.env.NODE_ENV === 'development'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const defaultIconPath = path.resolve(runtimeDir, '../public/icon.ico')

let mainWindow: BrowserWindow | null = null

// getMainWindow 함수는 현재 유지 중인 Electron 메인 창 인스턴스를 돌려준다.
export function getMainWindow() {
  return mainWindow
}

// toWebSocketOrigin 함수는 렌더러 URL을 HMR WebSocket origin으로 변환한다.
function toWebSocketOrigin(rendererUrl: URL) {
  return \`\${rendererUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//\${rendererUrl.host}\`
}

// buildContentSecurityPolicy 함수는 렌더러 URL에 맞는 Content-Security-Policy 문자열을 만든다.
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
      ? \`script-src 'self' \${origin.origin}\`
      : "script-src 'self'",
    isDev
      ? \`connect-src 'self' \${origin.origin} \${toWebSocketOrigin(origin)}\`
      : "connect-src 'self'",
  ]

  return directives.join('; ')
}

// createMainWindow 함수는 렌더러 URL을 로드하는 Electron 메인 창을 만들거나 재사용한다.
export function createMainWindow(rendererUrl: string) {
  if (mainWindow) {
    void mainWindow.loadURL(rendererUrl)
    return mainWindow
  }

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  }

  if (existsSync(defaultIconPath)) {
    windowOptions.icon = defaultIconPath
  }

  mainWindow = new BrowserWindow(windowOptions)

  const rendererOrigin = new URL(rendererUrl).origin
  const contentSecurityPolicy = buildContentSecurityPolicy(rendererUrl)

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    {
      urls: [\`\${rendererOrigin}/*\`],
    },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [contentSecurityPolicy],
        },
      })
    },
  )

  void mainWindow.loadURL(rendererUrl)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.webContents.on('console-message', (details) => {
      if (details.level === 'warning' || details.level === 'error') {
        console.error(\`[renderer:\${details.level}] \${details.message}\`)
      }
    })
  }

  if (process.platform === 'win32') {
    mainWindow.on('system-context-menu', (event) => {
      event.preventDefault()
    })
  } else {
    mainWindow.webContents.on('context-menu', (event) => {
      event.preventDefault()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}
`
}
