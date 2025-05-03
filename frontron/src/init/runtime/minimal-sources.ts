// minimal preset 소스는 문자열 템플릿으로 두어 renderers.ts가 출력 종류 선택에만 집중하게 한다.
// renderMinimalMainSource 함수는 minimal preset용 Electron main.ts 템플릿 소스를 만든다.
export function renderMinimalMainSource() {
  return `import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { app, Menu, net, protocol } from 'electron'
import { createMainWindow, getMainWindow } from './window.js'
import { startRendererRuntime, stopRendererRuntime } from './serve.js'

const isDev = process.env.NODE_ENV === 'development'
const rendererScheme = 'frontron'
export const rendererOrigin = \`\${rendererScheme}://app\`
const defaultRendererCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
let isQuitting = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererScheme,
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])

// resolveRendererProxyUrl 함수는 custom protocol 요청을 내부 렌더러 서버 URL로 바꾼다.
function resolveRendererProxyUrl(requestUrl: string, targetOrigin: string) {
  const rendererRequestUrl = new URL(requestUrl)

  if (
    rendererRequestUrl.protocol !== \`\${rendererScheme}:\` ||
    rendererRequestUrl.host !== 'app'
  ) {
    return null
  }

  const proxyUrl = new URL(targetOrigin)
  proxyUrl.pathname = rendererRequestUrl.pathname
  proxyUrl.search = rendererRequestUrl.search
  return proxyUrl
}

// rewriteRendererLocation 함수는 내부 서버 redirect가 안정적인 렌더러 origin을 유지하게 한다.
function rewriteRendererLocation(headers: Headers, proxyUrl: URL, targetOrigin: string) {
  const location = headers.get('location')

  if (!location) return

  try {
    const redirectUrl = new URL(location, proxyUrl)

    if (redirectUrl.origin === targetOrigin) {
      headers.set(
        'location',
        \`\${rendererOrigin}\${redirectUrl.pathname}\${redirectUrl.search}\${redirectUrl.hash}\`,
      )
    }
  } catch {
    headers.delete('location')
  }
}

// ensureRendererCsp 함수는 앱이 CSP를 제공하지 않았을 때만 Electron용 기본 정책을 추가한다.
function ensureRendererCsp(headers: Headers) {
  if (!headers.has('content-security-policy')) {
    headers.set('content-security-policy', defaultRendererCsp)
  }
}

// rewriteRendererRequestHeaders 함수는 custom origin을 내부 서버가 기대하는 loopback origin으로 바꾼다.
function rewriteRendererRequestHeaders(request: Request, targetOrigin: string) {
  const headers = new Headers(request.headers)

  if (headers.get('origin') === rendererOrigin) {
    headers.set('origin', targetOrigin)
  }

  const referer = headers.get('referer')

  if (referer) {
    try {
      const refererUrl = new URL(referer)

      if (
        refererUrl.protocol === \`\${rendererScheme}:\` &&
        refererUrl.host === 'app'
      ) {
        headers.set(
          'referer',
          \`\${targetOrigin}\${refererUrl.pathname}\${refererUrl.search}\${refererUrl.hash}\`,
        )
      }
    } catch {
      headers.delete('referer')
    }
  }

  return headers
}

// registerRendererProtocol 함수는 production 렌더러 요청을 내부 HTTP 서버로 프록시한다.
export async function registerRendererProtocol(rendererTargetUrl: string) {
  const targetOrigin = new URL(rendererTargetUrl).origin

  await protocol.handle(rendererScheme, async (request) => {
    const proxyUrl = resolveRendererProxyUrl(request.url, targetOrigin)

    if (!proxyUrl) {
      return new Response('Not Found', { status: 404 })
    }

    try {
      const upstreamResponse = await net.fetch(proxyUrl.toString(), {
        method: request.method,
        headers: rewriteRendererRequestHeaders(request, targetOrigin),
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : request.body,
        redirect: 'manual',
        signal: request.signal,
      })
      const responseHeaders = new Headers(upstreamResponse.headers)

      rewriteRendererLocation(responseHeaders, proxyUrl, targetOrigin)
      ensureRendererCsp(responseHeaders)

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      console.error('[frontron:init] Failed to proxy renderer request.', error)
      return new Response('Bad Gateway', { status: 502 })
    }
  })
}

// runRendererProbe 함수는 release smoke에서 실제 custom protocol 렌더링 결과를 기록한다.
function runRendererProbe(mainWindow: Electron.BrowserWindow) {
  const outputPath = process.env.FRONTRON_RENDERER_PROBE_PATH?.trim()

  if (!outputPath) return

  // capture 함수는 실제 renderer의 protocol과 bridge 상태를 smoke 결과 파일에 기록한다.
  const capture = async () => {
    try {
      const result = await mainWindow.webContents.executeJavaScript(
        \`({
          protocol: window.location.protocol,
          origin: window.location.origin,
          title: document.title,
          bodyText: document.body?.innerText ?? '',
          bridgeType: typeof window.electron,
        })\`,
        true,
      )

      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(
        outputPath,
        \`\${JSON.stringify({ ok: true, ...result }, null, 2)}\\n\`,
        'utf8',
      )
      app.exit(0)
    } catch (error) {
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(
        outputPath,
        \`\${JSON.stringify({ ok: false, error: String(error) }, null, 2)}\\n\`,
        'utf8',
      )
      app.exit(1)
    }
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => void capture())
  } else {
    void capture()
  }
}

// boot 함수는 Electron 앱이 준비된 뒤 렌더러 런타임과 메인 창을 시작한다.
async function boot() {
  await app.whenReady()

  let rendererUrl: string | undefined

  if (isDev) {
    rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim()
  } else {
    const rendererTargetUrl = await startRendererRuntime()
    await registerRendererProtocol(rendererTargetUrl)
    rendererUrl = \`\${rendererOrigin}/\`
  }

  if (!rendererUrl) {
    throw new Error('ELECTRON_RENDERER_URL is required in development mode.')
  }

  const mainWindow = createMainWindow(rendererUrl)
  runRendererProbe(mainWindow)

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
      : \`\${rendererOrigin}/\`

    if (!isDev) {
      await startRendererRuntime()
    }

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
import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'

const isDev = process.env.NODE_ENV === 'development'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const defaultIconPath = path.resolve(runtimeDir, '../public/icon.ico')

let mainWindow: BrowserWindow | null = null

// getMainWindow 함수는 현재 유지 중인 Electron 메인 창 인스턴스를 돌려준다.
export function getMainWindow() {
  return mainWindow
}

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

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return

    void shell.openExternal(url.toString()).catch((error) => {
      console.error('[frontron:init] Failed to open external URL.', error)
    })
  } catch {
    return
  }
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

  const rendererBaseUrl = new URL(rendererUrl)

  mainWindow.webContents.on('will-redirect', (details) => {
    if (isRendererUrl(details.url, rendererBaseUrl)) return

    details.preventDefault()
    openExternalHttpUrl(details.url)
  })

  mainWindow.webContents.on('will-frame-navigate', (details) => {
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

    return { action: 'deny' }
  })

  void mainWindow.loadURL(rendererUrl)

  mainWindow.once('ready-to-show', () => {
    if (!process.env.FRONTRON_RENDERER_PROBE_PATH) {
      mainWindow?.show()
    }
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
