import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, type Tray } from 'electron'

import type { FrontronBridgeConfig, FrontronWindowConfig } from '../types'
import { createDesktopContext } from './context'
import { createRuntimeBridge } from './bridge'
import { loadRuntimeConfig } from './config'
import type { RuntimeManifest } from './manifest'
import { loadRustRuntime } from './native'
import { applyConfiguredMenu, createConfiguredTray } from './shell'

let mainWindow: BrowserWindow | null = null
let appTray: Tray | null = null
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

async function waitForUrlReady(url: string, timeoutMs = 30_000, intervalMs = 250) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(url, { method: 'GET' })
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs))
    }
  }

  throw new Error(`[Frontron] Timed out waiting for dev server: ${url}`)
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

  const outDir = resolveManifestPath(manifestPath, manifest.web.outDir)

  if (!outDir) {
    throw new Error('[Frontron] Missing "web.build.outDir" for production runtime.')
  }

  const indexPath = join(outDir, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(`[Frontron] Built web entry not found: ${indexPath}`)
  }

  await mainWindow?.loadFile(indexPath, route === '/' ? undefined : { hash: route.slice(1) })
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
  const preloadPath = join(dirname(fileURLToPath(import.meta.url)), 'preload.mjs')
  const iconPath = resolveManifestPath(manifestPath, manifest.app.icon)

  mainWindow = new BrowserWindow({
    show: false,
    width: windowConfig.width ?? 1280,
    height: windowConfig.height ?? 800,
    frame: windowConfig.frame ?? true,
    resizable: windowConfig.resizable ?? true,
    title: windowConfig.title ?? manifest.app.name,
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

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) {
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

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  await app.whenReady()
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
    ? () => {
        reportSmokeSuccess({
          mode: manifest.mode,
          rootDir: manifest.rootDir,
          configFile: manifest.configFile,
          bridgeNamespaces: Object.keys(runtimeConfig?.bridge ?? {}),
          hasMenu: Boolean(runtimeConfig?.menu?.length),
          hasTray: Boolean(runtimeConfig?.tray),
          nativeStatus: rustRuntime.getStatus(),
          windowRoute: getMainWindowConfig(manifest).route,
        })

        setTimeout(() => {
          app.quit()
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
  app.quit()
})
