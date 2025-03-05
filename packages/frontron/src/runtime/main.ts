import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, request as createHttpRequest, type Server } from 'node:http'
import { request as createHttpsRequest } from 'node:https'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FrontronBridgeConfig, FrontronWindowConfig } from '../types'
import { createDesktopContext } from './context'
import { createRuntimeBridge } from './bridge'
import { loadRuntimeConfig } from './config'
import type { RuntimeManifest } from './manifest'
import { loadRustRuntime } from './native'
import { applyConfiguredMenu, createConfiguredTray } from './shell'

const require = createRequire(import.meta.url)
const electron = require('electron') as typeof import('electron')
const { app, BrowserWindow, ipcMain } = electron

type ElectronBrowserWindow = InstanceType<typeof BrowserWindow>
type ElectronTray = import('electron').Tray

let mainWindow: ElectronBrowserWindow | null = null
let appTray: ElectronTray | null = null
let productionWebServer: Server | null = null
let productionWebOrigin: string | null = null
let productionWebRootDir: string | null = null
const smokeResultPath = process.env.FRONTRON_SMOKE_RESULT_PATH
  ? resolve(process.env.FRONTRON_SMOKE_RESULT_PATH)
  : null
const isSmokeTest = process.env.FRONTRON_SMOKE_TEST === '1'

function getManifestPath() {
  if (process.env.FRONTRON_MANIFEST_PATH) {
    return resolve(process.env.FRONTRON_MANIFEST_PATH)
  }

  return join(dirname(fileURLToPath(import.meta.url)), 'manifest.json')
}

function readManifest() {
  const manifestPath = getManifestPath()

  if (!existsSync(manifestPath)) {
    throw new Error(`[Frontron] Runtime manifest not found: ${manifestPath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeManifest

  return {
    manifest,
    manifestPath,
  }
}

function resolveManifestPath(manifestPath: string, value: string | undefined) {
  if (!value) {
    return value
  }

  if (isAbsolute(value)) {
    return value
  }

  return resolve(dirname(manifestPath), value)
}

function getMainWindowConfig(manifest: RuntimeManifest): FrontronWindowConfig {
  return (
    manifest.windows.main ??
    Object.values(manifest.windows)[0] ?? {
      route: '/',
      width: 1280,
      height: 800,
      frame: true,
      resizable: true,
    }
  )
}

function normalizeRoute(route: string | undefined) {
  if (!route || route === '/') {
    return '/'
  }

  return route.startsWith('/') ? route : `/${route}`
}

function probeUrl(url: string, timeoutMs: number) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const requestUrl = new URL(url)
    const request =
      requestUrl.protocol === 'https:'
        ? createHttpsRequest(requestUrl, { method: 'GET' })
        : createHttpRequest(requestUrl, { method: 'GET' })

    const timeout = setTimeout(() => {
      request.destroy(new Error(`[Frontron] Timed out probing URL: ${url}`))
    }, timeoutMs)

    request.on('response', (response) => {
      clearTimeout(timeout)
      response.resume()
      resolvePromise()
    })

    request.on('error', (error) => {
      clearTimeout(timeout)
      rejectPromise(error)
    })

    request.end()
  })
}

async function waitForUrlReady(url: string, timeoutMs = 30_000, intervalMs = 250) {
  const startedAt = Date.now()
  const requestTimeoutMs = Math.max(500, Math.min(intervalMs, 1_000))

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await probeUrl(url, requestTimeoutMs)
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs))
    }
  }

  throw new Error(`[Frontron] Timed out waiting for dev server: ${url}`)
}

function isPathInsideRoot(rootDir: string, targetPath: string) {
  const relativePath = relative(rootDir, targetPath)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function getContentType(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.gif':
      return 'image/gif'
    case '.htm':
    case '.html':
      return 'text/html; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function resolveStaticFilePath(rootDir: string, pathname: string) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const directPath = resolve(rootDir, `.${requestedPath}`)

  if (isPathInsideRoot(rootDir, directPath) && existsSync(directPath)) {
    const directStats = statSync(directPath)

    if (directStats.isFile()) {
      return directPath
    }

    if (directStats.isDirectory()) {
      const indexPath = join(directPath, 'index.html')

      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath
      }
    }
  }

  if (extname(pathname).length > 0) {
    return null
  }

  const fallbackPath = join(rootDir, 'index.html')
  return existsSync(fallbackPath) && statSync(fallbackPath).isFile() ? fallbackPath : null
}

async function stopProductionWebServer() {
  const server = productionWebServer

  productionWebServer = null
  productionWebOrigin = null
  productionWebRootDir = null

  if (!server) {
    return
  }

  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })
}

async function ensureProductionWebServer(
  manifest: RuntimeManifest,
  manifestPath: string,
) {
  const outDir = resolveManifestPath(manifestPath, manifest.web.outDir)

  if (!outDir) {
    throw new Error('[Frontron] Missing "web.build.outDir" for production runtime.')
  }

  const indexPath = join(outDir, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(`[Frontron] Built web entry not found: ${indexPath}`)
  }

  if (productionWebServer && productionWebOrigin && productionWebRootDir === outDir) {
    return productionWebOrigin
  }

  await stopProductionWebServer()

  const origin = await new Promise<string>((resolvePromise, rejectPromise) => {
    const server = createServer((request, response) => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, {
            'content-type': 'text/plain; charset=utf-8',
          })
          response.end('Method Not Allowed')
          return
        }

        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        const filePath = resolveStaticFilePath(outDir, decodeURIComponent(requestUrl.pathname))

        if (!filePath) {
          response.writeHead(404, {
            'content-type': 'text/plain; charset=utf-8',
          })
          response.end('Not Found')
          return
        }

        response.writeHead(200, {
          'content-type': getContentType(filePath),
        })

        if (request.method === 'HEAD') {
          response.end()
          return
        }

        response.end(readFileSync(filePath))
      } catch {
        response.writeHead(500, {
          'content-type': 'text/plain; charset=utf-8',
        })
        response.end('Internal Server Error')
      }
    })

    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close()
        rejectPromise(new Error('[Frontron] Could not start the packaged web server.'))
        return
      }

      productionWebServer = server
      productionWebRootDir = outDir
      productionWebOrigin = `http://127.0.0.1:${address.port}`
      resolvePromise(productionWebOrigin)
    })
  })

  await waitForUrlReady(origin)
  return origin
}

async function loadWindowContent(
  manifest: RuntimeManifest,
  manifestPath: string,
  windowConfig: FrontronWindowConfig,
) {
  const route = normalizeRoute(windowConfig.route)

  if (manifest.mode === 'development') {
    const devUrl = manifest.web.devUrl

    if (!devUrl) {
      throw new Error('[Frontron] Missing "web.dev.url" for development runtime.')
    }

    await waitForUrlReady(devUrl)

    const windowUrl = route === '/' ? devUrl : new URL(route, devUrl).toString()
    await mainWindow?.loadURL(windowUrl)
    return
  }

  const serverOrigin = await ensureProductionWebServer(manifest, manifestPath)
  const windowUrl = new URL(route, `${serverOrigin}/`).toString()

  await mainWindow?.loadURL(windowUrl)
}

function sendMaximizedChanged() {
  if (!mainWindow) {
    return
  }

  mainWindow.webContents.send(
    'frontron:event:window.maximizedChanged',
    mainWindow.isMaximized(),
  )
}

function reportSmokeSuccess(payload: Record<string, unknown>) {
  if (!isSmokeTest || !smokeResultPath) {
    return
  }

  writeFileSync(smokeResultPath, JSON.stringify(payload, null, 2))
}

async function readSmokeRenderState() {
  if (!mainWindow) {
    return null
  }

  try {
    return await mainWindow.webContents.executeJavaScript(
      `(() => {
        const root = document.getElementById('root')
        return {
          title: document.title,
          bodyText: document.body?.innerText ?? '',
          rootHtmlLength: root ? root.innerHTML.length : null,
        }
      })()`,
      true,
    )
  } catch {
    return null
  }
}

function readBridgeHandler(
  bridge: FrontronBridgeConfig,
  command: string,
) {
  const separatorIndex = command.indexOf('.')

  if (separatorIndex <= 0 || separatorIndex >= command.length - 1) {
    throw new Error(`[Frontron] Invalid bridge command "${command}".`)
  }

  const namespace = command.slice(0, separatorIndex)
  const method = command.slice(separatorIndex + 1)
  const handler = bridge[namespace]?.[method]

  if (typeof handler !== 'function') {
    throw new Error(`[Frontron] Unknown bridge command "${command}".`)
  }

  return handler
}

function registerBridgeHandlers(bridge: FrontronBridgeConfig) {
  ipcMain.handle('frontron:invoke', async (_event, command: string, ...args: unknown[]) => {
    const handler = readBridgeHandler(bridge, command)
    const result = await handler(...args)

    if (command === 'window.toggleMaximize') {
      sendMaximizedChanged()
    }

    return result
  })
}

async function createWindow(
  manifest: RuntimeManifest,
  manifestPath: string,
  onDidFinishLoad?: () => void,
) {
  const windowConfig = getMainWindowConfig(manifest)
  const shouldShowWindow = windowConfig.show ?? true
  const preloadPath = join(dirname(fileURLToPath(import.meta.url)), 'preload.mjs')
  const iconPath = resolveManifestPath(manifestPath, manifest.app.icon)

  mainWindow = new BrowserWindow({
    show: windowConfig.show ?? false,
    width: windowConfig.width ?? 1280,
    height: windowConfig.height ?? 800,
    minWidth: windowConfig.minWidth,
    minHeight: windowConfig.minHeight,
    maxWidth: windowConfig.maxWidth,
    maxHeight: windowConfig.maxHeight,
    frame: windowConfig.frame ?? true,
    resizable: windowConfig.resizable ?? true,
    fullscreen: windowConfig.fullscreen,
    fullscreenable: windowConfig.fullscreenable,
    maximizable: windowConfig.maximizable,
    minimizable: windowConfig.minimizable,
    closable: windowConfig.closable,
    alwaysOnTop: windowConfig.alwaysOnTop,
    backgroundColor: windowConfig.backgroundColor,
    transparent: windowConfig.transparent,
    autoHideMenuBar: windowConfig.autoHideMenuBar,
    skipTaskbar: windowConfig.skipTaskbar,
    title: windowConfig.title ?? manifest.app.name,
    titleBarStyle: windowConfig.titleBarStyle,
    icon: iconPath && existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  })

  mainWindow.on('maximize', sendMaximizedChanged)
  mainWindow.on('unmaximize', sendMaximizedChanged)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (windowConfig.center) {
    mainWindow.center()
  }

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest && shouldShowWindow && !mainWindow?.isVisible()) {
      mainWindow?.show()
    }

    sendMaximizedChanged()
  })

  if (onDidFinishLoad) {
    mainWindow.webContents.once('did-finish-load', onDidFinishLoad)
  }

  await loadWindowContent(manifest, manifestPath, windowConfig)
}

async function bootstrap() {
  const { manifest, manifestPath } = readManifest()

  if (isSmokeTest) {
    app.setPath('userData', join(manifest.rootDir, '.frontron-smoke-user-data'))
  }

  if (!isSmokeTest && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  await app.whenReady()
  app.on('before-quit', () => {
    appTray?.destroy()
    appTray = null
    void stopProductionWebServer()
  })
  app.setName(manifest.app.name)
  const desktopContext = createDesktopContext(
    manifest,
    () => mainWindow,
    sendMaximizedChanged,
  )
  const runtimeConfig = await loadRuntimeConfig(manifest)
  const rustRuntime = loadRustRuntime(runtimeConfig?.rust, manifest.mode)
  const bridge = createRuntimeBridge(
    runtimeConfig?.bridge,
    manifest.app.version,
    desktopContext,
    rustRuntime,
  )
  registerBridgeHandlers(bridge)
  applyConfiguredMenu(runtimeConfig?.menu, desktopContext)
  if (!isSmokeTest) {
    appTray = createConfiguredTray(runtimeConfig?.tray, manifest, manifestPath, desktopContext)
  }

  const smokeCallback = isSmokeTest
    ? async () => {
        const renderState = await readSmokeRenderState()

        reportSmokeSuccess({
          mode: manifest.mode,
          rootDir: manifest.rootDir,
          configFile: manifest.configFile,
          bridgeNamespaces: Object.keys(runtimeConfig?.bridge ?? {}),
          hasMenu: Boolean(runtimeConfig?.menu?.length),
          hasTray: Boolean(runtimeConfig?.tray),
          nativeStatus: rustRuntime.getStatus(),
          windowRoute: getMainWindowConfig(manifest).route,
          loadedUrl: mainWindow?.webContents.getURL(),
          renderState,
        })

        setTimeout(() => {
          try {
            mainWindow?.destroy()
          } catch {
            // Best-effort cleanup before forcing smoke exit.
          }

          process.exit(0)
        }, 0)
      }
    : undefined

  await createWindow(manifest, manifestPath, smokeCallback)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      appTray?.destroy()
      appTray = null
      app.quit()
    }
  })

  app.on('activate', async () => {
    if (!mainWindow) {
      await createWindow(manifest, manifestPath, smokeCallback)
      return
    }

    mainWindow.show()
  })
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  void stopProductionWebServer()
  app.quit()
})
