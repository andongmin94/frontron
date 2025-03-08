import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, request as createHttpRequest, type Server } from 'node:http'
import { request as createHttpsRequest } from 'node:https'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  FrontronDeepLinkState,
  FrontronBridgeConfig,
  FrontronDesktopContext,
  FrontronUpdateState,
  FrontronWindowConfig,
  ResolvedFrontronConfig,
} from '../types'
import { createDesktopContext, type RuntimeWindowController } from './context'
import { createRuntimeBridge } from './bridge'
import { loadRuntimeConfig } from './config'
import type { RuntimeManifest } from './manifest'
import { loadRustRuntime } from './native'
import { applyConfiguredSecurityPolicy } from './security'
import { applyConfiguredMenu, createConfiguredTray } from './shell'

const require = createRequire(import.meta.url)
const electron = require('electron') as typeof import('electron')
const { app, autoUpdater, BrowserWindow, ipcMain } = electron

type ElectronBrowserWindow = InstanceType<typeof BrowserWindow>
type ElectronTray = import('electron').Tray

let primaryWindowName: string | null = null
const openWindows = new Map<string, ElectronBrowserWindow>()
let appTray: ElectronTray | null = null
let productionWebServer: Server | null = null
let productionWebOrigin: string | null = null
let productionWebRootDir: string | null = null
const smokeResultPath = process.env.FRONTRON_SMOKE_RESULT_PATH
  ? resolve(process.env.FRONTRON_SMOKE_RESULT_PATH)
  : null
const isSmokeTest = process.env.FRONTRON_SMOKE_TEST === '1'
const smokeOpenWindowNames = (process.env.FRONTRON_SMOKE_OPEN_WINDOWS ?? '')
  .split(',')
  .map((windowName) => windowName.trim())
  .filter(Boolean)

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

function createDefaultWindowConfig(): FrontronWindowConfig {
  return {
    route: '/',
    width: 1280,
    height: 800,
    frame: true,
    resizable: true,
  }
}

function getConfiguredWindowNames(manifest: RuntimeManifest) {
  const configuredWindowNames = Object.keys(manifest.windows ?? {})

  return configuredWindowNames.length > 0 ? configuredWindowNames : ['main']
}

function getPrimaryWindowName(manifest: RuntimeManifest) {
  if (manifest.windows.main) {
    return 'main'
  }

  return getConfiguredWindowNames(manifest)[0] ?? 'main'
}

function getConfiguredWindowConfig(
  manifest: RuntimeManifest,
  windowName: string,
): FrontronWindowConfig {
  return manifest.windows[windowName] ?? createDefaultWindowConfig()
}

function getPrimaryWindowConfig(manifest: RuntimeManifest) {
  return getConfiguredWindowConfig(manifest, getPrimaryWindowName(manifest))
}

function getPrimaryWindow() {
  if (!primaryWindowName) {
    return null
  }

  return openWindows.get(primaryWindowName) ?? null
}

function getOpenWindowNames() {
  return [...openWindows.keys()].sort()
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneConfigValue(item))
  }

  if (!isPlainObjectRecord(value)) {
    return value
  }

  const clonedValue: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    clonedValue[key] = cloneConfigValue(nestedValue)
  }

  return clonedValue
}

function mergeConfigRecords(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown>,
) {
  const mergedRecord = (cloneConfigValue(base) as Record<string, unknown> | undefined) ?? {}

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = mergedRecord[key]

    if (isPlainObjectRecord(baseValue) && isPlainObjectRecord(overrideValue)) {
      mergedRecord[key] = mergeConfigRecords(baseValue, overrideValue)
      continue
    }

    mergedRecord[key] = cloneConfigValue(overrideValue)
  }

  return mergedRecord
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

function readUpdateErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createDeepLinkState(
  deepLinksConfig: ResolvedFrontronConfig['deepLinks'],
  partial: Partial<FrontronDeepLinkState> = {},
): FrontronDeepLinkState {
  return {
    enabled: deepLinksConfig?.enabled ?? false,
    schemes: deepLinksConfig?.schemes ?? [],
    pending: [],
    ...partial,
  }
}

type RuntimeDeepLinksController = FrontronDesktopContext['deepLinks'] & {
  enqueue(urls: string[]): void
}

function normalizeDeepLinkScheme(scheme: string) {
  return scheme.trim().toLowerCase().replace(/:$/, '')
}

function isConfiguredDeepLink(urlText: string, schemes: string[]) {
  try {
    const parsed = new URL(urlText)
    return schemes.includes(normalizeDeepLinkScheme(parsed.protocol))
  } catch {
    return false
  }
}

function readDeepLinksFromArgv(argv: string[], schemes: string[]) {
  return argv.filter((value) => isConfiguredDeepLink(value, schemes))
}

function createDeepLinksController(
  deepLinksConfig: ResolvedFrontronConfig['deepLinks'],
  onIncomingDeepLink?: () => void,
): RuntimeDeepLinksController {
  let state = createDeepLinkState(deepLinksConfig)

  return {
    getState() {
      return {
        ...state,
        pending: [...state.pending],
      }
    },
    consumePending() {
      const pendingLinks = [...state.pending]
      state = createDeepLinkState(deepLinksConfig, {
        ...state,
        pending: [],
      })
      return pendingLinks
    },
    enqueue(urls) {
      if (!deepLinksConfig?.enabled || urls.length === 0) {
        return
      }

      const nextUrls = urls.filter((url) => isConfiguredDeepLink(url, state.schemes))

      if (nextUrls.length === 0) {
        return
      }

      state = createDeepLinkState(deepLinksConfig, {
        ...state,
        pending: [...state.pending, ...nextUrls],
        last: nextUrls[nextUrls.length - 1],
      })

      onIncomingDeepLink?.()
    },
  }
}

function createUpdateState(
  manifest: RuntimeManifest,
  partial: Partial<FrontronUpdateState>,
): FrontronUpdateState {
  return {
    enabled: false,
    supported: false,
    status: 'disabled',
    currentVersion: manifest.app.version,
    ...partial,
  }
}

function focusWindow(targetWindow: ElectronBrowserWindow | null) {
  if (!targetWindow) {
    return
  }

  if (!targetWindow.isVisible()) {
    targetWindow.show()
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore()
  }

  targetWindow.focus()
}

function focusPrimaryWindow() {
  focusWindow(getPrimaryWindow())
}

function createUpdatesController(
  manifest: RuntimeManifest,
  updatesConfig: ResolvedFrontronConfig['updates'],
): FrontronDesktopContext['updates'] {
  let state = createUpdateState(manifest, {
    enabled: updatesConfig?.enabled ?? false,
    status: updatesConfig?.enabled === false || !updatesConfig ? 'disabled' : 'unsupported',
  })

  if (!updatesConfig || updatesConfig.enabled === false) {
    return {
      getState() {
        return state
      },
      async check() {
        return state
      },
      quitAndInstall() {
        return false
      },
    }
  }

  const supported = manifest.mode === 'production' && app.isPackaged && process.platform === 'darwin'

  state = createUpdateState(manifest, {
    enabled: true,
    supported,
    status: supported ? 'idle' : 'unsupported',
  })

  if (!supported) {
    return {
      getState() {
        return state
      },
      async check() {
        return state
      },
      quitAndInstall() {
        return false
      },
    }
  }

  let configured = false
  let listenersRegistered = false

  const registerListeners = () => {
    if (listenersRegistered) {
      return
    }

    listenersRegistered = true

    autoUpdater.on('checking-for-update', () => {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'checking',
        error: undefined,
      })
    })

    autoUpdater.on('update-available', () => {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'available',
        error: undefined,
      })
    })

    autoUpdater.on('update-not-available', () => {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'not-available',
        error: undefined,
      })
    })

    autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'downloaded',
        latestVersion: releaseName || state.latestVersion,
        error: undefined,
      })
    })

    autoUpdater.on('error', (error) => {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'error',
        error: readUpdateErrorMessage(error),
      })
    })
  }

  const ensureConfigured = () => {
    if (configured) {
      return true
    }

    if (!updatesConfig.url) {
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'error',
        error: 'Missing updates.url for the configured auto-update feed.',
      })
      return false
    }

    try {
      registerListeners()
      autoUpdater.setFeedURL({
        url: updatesConfig.url,
      })
      configured = true
      return true
    } catch (error) {
      const message = readUpdateErrorMessage(error)
      state = createUpdateState(manifest, {
        ...state,
        enabled: true,
        supported: true,
        status: 'error',
        error: message,
      })
      console.error(`[Frontron] Auto updates could not be configured: ${message}`)
      return false
    }
  }

  return {
    getState() {
      return state
    },
    async check() {
      if (!ensureConfigured()) {
        return state
      }

      try {
        autoUpdater.checkForUpdates()
      } catch (error) {
        const message = readUpdateErrorMessage(error)
        state = createUpdateState(manifest, {
          ...state,
          enabled: true,
          supported: true,
          status: 'error',
          error: message,
        })
      }

      return state
    },
    quitAndInstall() {
      if (state.status !== 'downloaded') {
        return false
      }

      try {
        autoUpdater.quitAndInstall()
        return true
      } catch (error) {
        state = createUpdateState(manifest, {
          ...state,
          enabled: true,
          supported: true,
          status: 'error',
          error: readUpdateErrorMessage(error),
        })
        return false
      }
    },
  }
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
  targetWindow: ElectronBrowserWindow,
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
    await targetWindow.loadURL(windowUrl)
    return
  }

  const serverOrigin = await ensureProductionWebServer(manifest, manifestPath)
  const windowUrl = new URL(route, `${serverOrigin}/`).toString()

  await targetWindow.loadURL(windowUrl)
}

function sendPrimaryMaximizedChanged() {
  const primaryWindow = getPrimaryWindow()

  if (!primaryWindow) {
    return
  }

  primaryWindow.webContents.send(
    'frontron:event:window.maximizedChanged',
    primaryWindow.isMaximized(),
  )
}

function reportSmokeSuccess(payload: Record<string, unknown>) {
  if (!isSmokeTest || !smokeResultPath) {
    return
  }

  writeFileSync(smokeResultPath, JSON.stringify(payload, null, 2))
}

async function readSmokeRenderState() {
  const primaryWindow = getPrimaryWindow()

  if (!primaryWindow) {
    return null
  }

  try {
    return await primaryWindow.webContents.executeJavaScript(
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
      sendPrimaryMaximizedChanged()
    }

    return result
  })
}

interface OpenConfiguredWindowOptions {
  reveal?: boolean
  focus?: boolean
  onDidFinishLoad?: () => void
}

async function openConfiguredWindow(
  windowName: string,
  manifest: RuntimeManifest,
  manifestPath: string,
  desktopContext: FrontronDesktopContext,
  securityConfig: ResolvedFrontronConfig['security'],
  options: OpenConfiguredWindowOptions = {
    reveal: true,
    focus: true,
  },
) {
  if (!getConfiguredWindowNames(manifest).includes(windowName)) {
    throw new Error(`[Frontron] Unknown configured window "${windowName}".`)
  }

  const existingWindow = openWindows.get(windowName)
  const shouldRevealWindow = options.reveal ?? true
  const shouldFocusWindow = options.focus ?? true

  if (existingWindow) {
    if (shouldRevealWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore()
      }

      existingWindow.show()
    }

    if (shouldFocusWindow) {
      focusWindow(existingWindow)
    }

    return existingWindow
  }

  const windowConfig = getConfiguredWindowConfig(manifest, windowName)
  const preloadPath = join(dirname(fileURLToPath(import.meta.url)), 'preload.mjs')
  const iconPath = resolveManifestPath(manifestPath, manifest.app.icon)

  const browserWindowOptions = mergeConfigRecords(
    isPlainObjectRecord(windowConfig.advanced) ? windowConfig.advanced : undefined,
    {
      show: false,
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
        zoomFactor: windowConfig.zoomFactor,
        sandbox: windowConfig.sandbox,
        spellcheck: windowConfig.spellcheck,
        webSecurity: windowConfig.webSecurity,
      },
    },
  )

  const targetWindow = new BrowserWindow(
    browserWindowOptions as import('electron').BrowserWindowConstructorOptions,
  )
  const isPrimaryWindow = windowName === primaryWindowName

  openWindows.set(windowName, targetWindow)

  if (isPrimaryWindow) {
    targetWindow.on('maximize', sendPrimaryMaximizedChanged)
    targetWindow.on('unmaximize', sendPrimaryMaximizedChanged)
  }

  targetWindow.on('closed', () => {
    openWindows.delete(windowName)
  })

  if (windowConfig.center) {
    targetWindow.center()
  }

  targetWindow.once('ready-to-show', () => {
    const shouldShowWindow = shouldRevealWindow || (windowConfig.show ?? true)

    if (!isSmokeTest && shouldShowWindow && !targetWindow.isVisible()) {
      targetWindow.show()
    }

    if (!isSmokeTest && shouldFocusWindow) {
      focusWindow(targetWindow)
    }

    if (isPrimaryWindow) {
      sendPrimaryMaximizedChanged()
    }
  })

  if (options.onDidFinishLoad) {
    targetWindow.webContents.once('did-finish-load', options.onDidFinishLoad)
  }

  await loadWindowContent(targetWindow, manifest, manifestPath, windowConfig)
  applyConfiguredSecurityPolicy(targetWindow.webContents, desktopContext.shell, securityConfig)

  return targetWindow
}

async function bootstrap() {
  const { manifest, manifestPath } = readManifest()
  primaryWindowName = getPrimaryWindowName(manifest)
  const runtimeConfig = await loadRuntimeConfig(manifest)
  const deepLinksController = createDeepLinksController(runtimeConfig?.deepLinks, () => {
    if (!isSmokeTest) {
      focusPrimaryWindow()
    }
  })
  const configuredDeepLinkSchemes = runtimeConfig?.deepLinks?.enabled
    ? runtimeConfig.deepLinks.schemes
    : []

  if (configuredDeepLinkSchemes.length > 0) {
    app.on('open-url', (event, url) => {
      event.preventDefault()
      deepLinksController.enqueue([url])
    })

    if (process.platform !== 'darwin') {
      deepLinksController.enqueue(readDeepLinksFromArgv(process.argv, configuredDeepLinkSchemes))
    }
  }

  if (isSmokeTest) {
    app.setPath('userData', join(manifest.rootDir, '.frontron-smoke-user-data'))
  }

  if (!isSmokeTest && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', (_event, argv) => {
    if (configuredDeepLinkSchemes.length > 0) {
      deepLinksController.enqueue(readDeepLinksFromArgv(argv, configuredDeepLinkSchemes))
    }

    focusPrimaryWindow()
  })

  await app.whenReady()
  app.on('before-quit', () => {
    appTray?.destroy()
    appTray = null
    void stopProductionWebServer()
  })
  app.setName(manifest.app.name)
  const updatesController = createUpdatesController(manifest, runtimeConfig?.updates)
  let desktopContext!: FrontronDesktopContext
  const windowController: RuntimeWindowController = {
    getPrimaryWindow() {
      return getPrimaryWindow()
    },
    async openConfiguredWindow(name) {
      return await openConfiguredWindow(
        name,
        manifest,
        manifestPath,
        desktopContext,
        runtimeConfig?.security,
      )
    },
    getConfiguredWindow(name) {
      return openWindows.get(name) ?? null
    },
    hasConfiguredWindow(name) {
      return getConfiguredWindowNames(manifest).includes(name)
    },
    listConfiguredWindows() {
      return getConfiguredWindowNames(manifest)
    },
    listOpenWindows() {
      return getOpenWindowNames()
    },
  }
  desktopContext = createDesktopContext(
    manifest,
    windowController,
    sendPrimaryMaximizedChanged,
    deepLinksController,
    updatesController,
  )
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
        for (const windowName of smokeOpenWindowNames) {
          if (windowName === primaryWindowName || !windowController.hasConfiguredWindow(windowName)) {
            continue
          }

          await desktopContext.windows.open(windowName)
        }

        const renderState = await readSmokeRenderState()

        reportSmokeSuccess({
          mode: manifest.mode,
          rootDir: manifest.rootDir,
          configFile: manifest.configFile,
          bridgeNamespaces: Object.keys(runtimeConfig?.bridge ?? {}),
          hasMenu: Boolean(runtimeConfig?.menu?.length),
          hasTray: Boolean(runtimeConfig?.tray),
          nativeStatus: rustRuntime.getStatus(),
          windowRoute: getPrimaryWindowConfig(manifest).route,
          configuredWindowNames: getConfiguredWindowNames(manifest),
          openWindowNames: getOpenWindowNames(),
          loadedUrl: getPrimaryWindow()?.webContents.getURL(),
          zoomFactor: getPrimaryWindow()?.webContents.getZoomFactor(),
          renderState,
        })

        setTimeout(() => {
          try {
            for (const openWindow of openWindows.values()) {
              openWindow.destroy()
            }
          } catch {
            // Best-effort cleanup before forcing smoke exit.
          }

          process.exit(0)
        }, 0)
      }
    : undefined

  await openConfiguredWindow(
    primaryWindowName,
    manifest,
    manifestPath,
    desktopContext,
    runtimeConfig?.security,
    {
      reveal: false,
      focus: false,
      onDidFinishLoad: smokeCallback,
    },
  )

  if (!isSmokeTest && runtimeConfig?.updates?.enabled && runtimeConfig.updates.checkOnLaunch) {
    void updatesController.check()
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      appTray?.destroy()
      appTray = null
      app.quit()
    }
  })

  app.on('activate', async () => {
    if (!getPrimaryWindow()) {
      await openConfiguredWindow(
        primaryWindowName,
        manifest,
        manifestPath,
        desktopContext,
        runtimeConfig?.security,
        {
          reveal: true,
          focus: true,
          onDidFinishLoad: smokeCallback,
        },
      )
      return
    }

    focusPrimaryWindow()
  })
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  void stopProductionWebServer()
  app.quit()
})
