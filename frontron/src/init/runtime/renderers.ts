import type { InitConfig, InitPreset } from '../shared'
import { usesStarterBridge } from '../shared'
import { inferHost, inferPort, inferViteServerValue, normalizeLoopbackHost } from '../detect'

export function renderMainSource(preset: InitPreset) {
  const importLines = [
    `import { app, Menu } from 'electron'`,
    `import { createMainWindow, getMainWindow } from './window.js'`,
    `import { startRendererRuntime, stopRendererRuntime } from './serve.js'`,
  ]

  if (usesStarterBridge(preset)) {
    importLines.splice(2, 0, `import { setupIpcHandlers } from './ipc.js'`)
  }

  return `${importLines.join('\n')}

const isDev = process.env.NODE_ENV === 'development'
let isQuitting = false

async function boot() {
  await app.whenReady()

  const rendererUrl = isDev
    ? process.env.ELECTRON_RENDERER_URL?.trim()
    : await startRendererRuntime()

  if (!rendererUrl) {
    throw new Error('ELECTRON_RENDERER_URL is required in development mode.')
  }

  createMainWindow(rendererUrl)
${usesStarterBridge(preset) ? '\n  setupIpcHandlers()' : ''}

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
${usesStarterBridge(preset) ? '\n      setupIpcHandlers()' : ''}
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

export function renderWindowSource(preset: InitPreset) {
  return `import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

const isDev = process.env.NODE_ENV === 'development'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(runtimeDir, 'preload.js')
const defaultIconPath = path.resolve(runtimeDir, '../public/icon.ico')

let mainWindow: BrowserWindow | null = null

export function getMainWindow() {
  return mainWindow
}

function toWebSocketOrigin(rendererUrl: URL) {
  return \`\${rendererUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//\${rendererUrl.host}\`
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
      ? \`script-src 'self' 'unsafe-inline' 'unsafe-eval' \${origin.origin}\`
      : "script-src 'self'",
    isDev
      ? \`connect-src 'self' \${origin.origin} \${toWebSocketOrigin(origin)}\`
      : "connect-src 'self'",
  ]

  return directives.join('; ')
}

export function createMainWindow(rendererUrl: string) {
  if (mainWindow) {
    void mainWindow.loadURL(rendererUrl)
    return mainWindow
  }

${usesStarterBridge(preset) ? `  if (!existsSync(preloadPath)) {
    console.warn(\`[frontron:init] Preload script not found at \${preloadPath}.\`)
  }

` : ''}  const windowOptions: BrowserWindowConstructorOptions = {
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
${usesStarterBridge(preset) ? "      preload: preloadPath,\n" : ''}    },
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

${usesStarterBridge(preset) ? `  if (isDev) {
    void mainWindow.webContents
      .executeJavaScript(
        \`Boolean(window.electron && typeof window.electron.getWindowState === "function")\`,
        true,
      )
      .then((hasBridge) => {
        if (!hasBridge) {
          console.warn('[frontron:init] Preload bridge is unavailable in the renderer.')
        }
      })
      .catch(() => {})
  }

` : ''}  if (isDev) {
${usesStarterBridge(preset) ? `    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(\`[frontron:init] Preload error at \${preloadPath}:\`, error)
    })

` : ''}    mainWindow.webContents.on('console-message', (details) => {
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

export function renderPreloadSource() {
  return `// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron')

const hideWindowChannel = 'window:hide'
const minimizeWindowChannel = 'window:minimize'
const toggleMaximizeWindowChannel = 'window:toggle-maximize'
const getWindowStateChannel = 'window:get-state'
const maximizedChangedChannel = 'window:maximized-changed'
const quitAppChannel = 'app:quit'

contextBridge.exposeInMainWorld('electron', {
  hideWindow: () => ipcRenderer.send(hideWindowChannel),
  minimizeWindow: () => ipcRenderer.send(minimizeWindowChannel),
  toggleMaximizeWindow: () => ipcRenderer.send(toggleMaximizeWindowChannel),
  quitApp: () => ipcRenderer.send(quitAppChannel),
  getWindowState: () => ipcRenderer.invoke(getWindowStateChannel),
  onWindowMaximizedChanged: (listener: (isMaximized: boolean) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      listener(Boolean(value))
    }

    ipcRenderer.on(maximizedChangedChannel, wrapped)
    return () => ipcRenderer.removeListener(maximizedChangedChannel, wrapped)
  },
})
`
}

export function renderIpcSource() {
  return `import { app, ipcMain } from 'electron'

import { getMainWindow } from './window.js'

const hideWindowChannel = 'window:hide'
const minimizeWindowChannel = 'window:minimize'
const toggleMaximizeWindowChannel = 'window:toggle-maximize'
const getWindowStateChannel = 'window:get-state'
const maximizedChangedChannel = 'window:maximized-changed'
const quitAppChannel = 'app:quit'
let hasRegisteredIpcHandlers = false
let boundWindow: ReturnType<typeof getMainWindow> = null

export function setupIpcHandlers() {
  const window = getMainWindow()

  if (!window) return

  if (boundWindow !== window) {
    boundWindow = window
    const sendMaxState = () => {
      const activeWindow = getMainWindow()

      if (!activeWindow) return
      activeWindow.webContents.send(maximizedChangedChannel, activeWindow.isMaximized())
    }

    window.on('maximize', sendMaxState)
    window.on('unmaximize', sendMaxState)
  }

  if (hasRegisteredIpcHandlers) {
    return
  }

  hasRegisteredIpcHandlers = true

  ipcMain.on(hideWindowChannel, () => {
    getMainWindow()?.hide()
  })

  ipcMain.on(minimizeWindowChannel, () => {
    getMainWindow()?.minimize()
  })

  ipcMain.on(toggleMaximizeWindowChannel, () => {
    const activeWindow = getMainWindow()

    if (!activeWindow) return

    if (activeWindow.isMaximized()) activeWindow.unmaximize()
    else activeWindow.maximize()
    activeWindow.webContents.send(maximizedChangedChannel, activeWindow.isMaximized())
  })

  ipcMain.on(quitAppChannel, () => {
    app.quit()
  })

  ipcMain.handle(getWindowStateChannel, () => {
    const activeWindow = getMainWindow()

    return {
      isMaximized: Boolean(activeWindow?.isMaximized()),
      isMinimized: Boolean(activeWindow?.isMinimized()),
    }
  })
}
`
}

export function renderElectronTypesSource() {
  return `export {}

type DesktopWindowState = {
  isMaximized: boolean
  isMinimized: boolean
}

declare global {
  interface Window {
    electron?: {
      hideWindow: () => void
      minimizeWindow: () => void
      toggleMaximizeWindow: () => void
      quitApp: () => void
      getWindowState: () => Promise<DesktopWindowState>
      onWindowMaximizedChanged: (
        listener: (isMaximized: boolean) => void
      ) => () => void
    }
  }
}
`
}

export function renderServeSource(config: InitConfig) {
  const devHost =
    inferHost(config.packageJson, config.webDevScript) ??
    normalizeLoopbackHost(inferViteServerValue(config.cwd, 'host')) ??
    '127.0.0.1'
  const devPort =
    inferPort(config.packageJson, config.webDevScript) ??
    Number.parseInt(inferViteServerValue(config.cwd, 'port') ?? '', 10) ??
    5173
  const devUrl = `http://${devHost}:${Number.isInteger(devPort) ? devPort : 5173}`

  return `import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PACKAGE_MANAGER = readEmbeddedJson<'npm' | 'pnpm' | 'yarn' | 'bun'>(${JSON.stringify(JSON.stringify(config.packageManager))})
const RUNTIME_STRATEGY = readEmbeddedJson<'static-export' | 'node-server'>(${JSON.stringify(JSON.stringify(config.runtimeStrategy))})
const WEB_DEV_SCRIPT = readEmbeddedJson<string>(${JSON.stringify(JSON.stringify(config.webDevScript))})
const WEB_OUT_DIR = readEmbeddedJson<string>(${JSON.stringify(JSON.stringify(config.outDir))})
const NODE_SERVER_SOURCE_ROOT = readEmbeddedJson<string | null>(${JSON.stringify(JSON.stringify(config.nodeServerSourceRoot))})
const NODE_SERVER_ENTRY = readEmbeddedJson<string | null>(${JSON.stringify(JSON.stringify(config.nodeServerEntry))})
const NODE_SERVER_COPY_TARGETS = readEmbeddedJson<Array<{ from: string; to: string }>>(${JSON.stringify(JSON.stringify(config.nodeServerCopyTargets))})
const DEV_URL = readEmbeddedJson<string>(${JSON.stringify(JSON.stringify(devUrl))})
const LOOPBACK_HOST = '127.0.0.1'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(runtimeDir, '..')
const DIST_DIR = path.resolve(ROOT_DIR, 'dist-electron')
const MAIN_ENTRY_PATH = path.join(DIST_DIR, 'main.js')
const RUNTIME_PACKAGE_PATH = path.join(DIST_DIR, 'package.json')
const mimeTypes = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

let rendererServer: ReturnType<typeof createServer> | null = null
let rendererProcess: ChildProcess | null = null
let rendererRuntimeUrl: string | null = null

function readEmbeddedJson<T>(value: string) {
  return JSON.parse(value) as T
}

function getRunnerCommand() {
  if (process.platform !== 'win32') return PACKAGE_MANAGER
  if (PACKAGE_MANAGER === 'npm') return 'npm.cmd'
  if (PACKAGE_MANAGER === 'pnpm') return 'pnpm.cmd'
  if (PACKAGE_MANAGER === 'yarn') return 'yarn.cmd'
  if (PACKAGE_MANAGER === 'bun') return 'bun.cmd'
  return PACKAGE_MANAGER
}

function getRunnerArgs(scriptName: string) {
  return PACKAGE_MANAGER === 'yarn' ? [scriptName] : ['run', scriptName]
}

function getElectronExecutablePath() {
  const require = createRequire(import.meta.url)
  return require('electron') as string
}

function ensureRuntimePackage() {
  writeFileSync(RUNTIME_PACKAGE_PATH, JSON.stringify({ type: 'module' }, null, 2))
}

function getPackagedRootDir() {
  const appAsarSegment = \`\${path.sep}app.asar\`

  return ROOT_DIR.includes(appAsarSegment)
    ? ROOT_DIR.replace(appAsarSegment, \`\${path.sep}app.asar.unpacked\`)
    : ROOT_DIR
}

function getRendererRuntimeRootDir() {
  return path.resolve(
    RUNTIME_STRATEGY === 'node-server' ? getPackagedRootDir() : ROOT_DIR,
    WEB_OUT_DIR,
  )
}

function isUrlReady(urlString: string, timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    const request = httpRequest(urlString, { method: 'GET', timeout: timeoutMs }, (response) => {
      response.resume()
      const statusCode = response.statusCode ?? 0
      resolve(statusCode >= 200 && statusCode < 500)
    })

    request.once('timeout', () => {
      request.destroy()
      resolve(false)
    })

    request.once('error', () => {
      resolve(false)
    })

    request.end()
  })
}

export async function waitForUrlReady(urlString: string, timeoutMs = 30_000, intervalMs = 250) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isUrlReady(urlString)) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(\`Timed out waiting for \${urlString}\`)
}

function getAvailablePort(host = LOOPBACK_HOST) {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer()

    probe.once('error', reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : null

      probe.close((error) => {
        if (error) {
          reject(error)
          return
        }

        if (typeof port !== 'number' || port <= 0) {
          reject(new Error('Failed to allocate a production server port.'))
          return
        }

        resolve(port)
      })
    })
  })
}

function sendResponse(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
) {
  response.writeHead(statusCode, { 'Content-Type': contentType })
  response.end(body)
}

function getContentType(filePath: string) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

function resolveRequestPath(distPath: string, requestPath: string) {
  const normalizedPath = path.posix.normalize(requestPath)
  const relativePath =
    normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\\/+/, '')
  const resolvedPath = path.resolve(distPath, relativePath)
  const isInsideDist =
    resolvedPath === distPath || resolvedPath.startsWith(\`\${distPath}\${path.sep}\`)

  return isInsideDist ? resolvedPath : null
}

function serveFile(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  filePath: string,
) {
  response.writeHead(200, { 'Content-Type': getContentType(filePath) })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function handleRendererRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  distPath: string,
  indexPath: string,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendResponse(response, 405, 'Method Not Allowed')
    return
  }

  let pathname: string

  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  } catch {
    sendResponse(response, 400, 'Bad Request')
    return
  }

  const resolvedPath = resolveRequestPath(distPath, pathname)

  if (!resolvedPath) {
    sendResponse(response, 403, 'Forbidden')
    return
  }

  if (existsSync(resolvedPath)) {
    serveFile(request, response, resolvedPath)
    return
  }

  if (path.extname(pathname)) {
    sendResponse(response, 404, 'Not Found')
    return
  }

  serveFile(request, response, indexPath)
}

async function startStaticServer() {
  if (rendererServer) {
    const address = rendererServer.address()
    const port = typeof address === 'object' && address !== null ? address.port : null

    if (typeof port === 'number' && port > 0) {
      return \`http://\${LOOPBACK_HOST}:\${port}\`
    }
  }

  const distPath = getRendererRuntimeRootDir()
  const indexPath = path.join(distPath, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(\`Renderer entry not found at \${indexPath}. Run the frontend build first.\`)
  }

  rendererServer = createServer((request, response) => {
    handleRendererRequest(request, response, distPath, indexPath)
  })

  return new Promise<string>((resolve, reject) => {
    const server = rendererServer

    if (!server) {
      reject(new Error('Renderer server failed to initialize.'))
      return
    }

    const handleError = (error: Error) => {
      rendererServer = null
      reject(error)
    }

    server.once('error', handleError)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', handleError)
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : null

      if (typeof port !== 'number' || port <= 0) {
        rendererServer = null
        reject(new Error('Renderer server failed to bind to a valid port.'))
        return
      }

      resolve(\`http://\${LOOPBACK_HOST}:\${port}\`)
    })
  })
}

async function stopStaticServer() {
  if (!rendererServer) return

  const server = rendererServer
  rendererServer = null

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function startNodeServerRuntime() {
  if (rendererProcess && rendererRuntimeUrl) {
    return rendererRuntimeUrl
  }

  const runtimeRoot = getRendererRuntimeRootDir()

  if (!NODE_SERVER_ENTRY) {
    throw new Error('A node-server adapter must define a production server entry.')
  }

  const serverEntryPath = path.join(runtimeRoot, NODE_SERVER_ENTRY)

  if (!existsSync(serverEntryPath)) {
    throw new Error(\`Node server entry not found at \${serverEntryPath}. Run the frontend build first.\`)
  }

  const port = await getAvailablePort()
  const runtimeUrl = \`http://\${LOOPBACK_HOST}:\${port}\`

  rendererProcess = spawn(process.execPath, [serverEntryPath], {
    cwd: runtimeRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: LOOPBACK_HOST,
      NODE_ENV: 'production',
      PORT: String(port),
    },
  })
  rendererRuntimeUrl = runtimeUrl

  rendererProcess.once('exit', () => {
    rendererProcess = null
    rendererRuntimeUrl = null
  })

  rendererProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start the packaged node server.', error)
  })

  try {
    await waitForUrlReady(runtimeUrl)
    return runtimeUrl
  } catch (error) {
    const activeProcess = rendererProcess
    rendererProcess = null
    rendererRuntimeUrl = null

    if (activeProcess && activeProcess.exitCode === null && activeProcess.signalCode === null) {
      activeProcess.kill('SIGTERM')
    }

    throw error
  }
}

async function stopNodeServerRuntime() {
  const activeProcess = rendererProcess
  rendererProcess = null
  rendererRuntimeUrl = null

  if (!activeProcess) {
    return
  }

  if (activeProcess.exitCode !== null || activeProcess.signalCode !== null) {
    return
  }

  await new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (activeProcess.exitCode === null && activeProcess.signalCode === null) {
        activeProcess.kill('SIGKILL')
      }
    }, 5_000)

    activeProcess.once('exit', () => {
      clearTimeout(forceKillTimer)
      resolve()
    })

    activeProcess.kill('SIGTERM')
  })
}

export async function startRendererRuntime() {
  return RUNTIME_STRATEGY === 'node-server'
    ? startNodeServerRuntime()
    : startStaticServer()
}

export async function stopRendererRuntime() {
  if (RUNTIME_STRATEGY === 'node-server') {
    await stopNodeServerRuntime()
    return
  }

  await stopStaticServer()
}

function spawnWebDevServer() {
  return spawn(getRunnerCommand(), getRunnerArgs(WEB_DEV_SCRIPT), {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
}

async function runDevApp() {
  ensureRuntimePackage()

  const webDevProcess = spawnWebDevServer()
  let electronProcess: ChildProcess | null = null

  const shutdown = (exitCode = 0) => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill('SIGTERM')
    }

    if (!webDevProcess.killed) {
      webDevProcess.kill('SIGTERM')
    }

    process.exit(exitCode)
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => shutdown(0))
  }

  webDevProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start the frontend dev server.', error)
    shutdown(1)
  })

  webDevProcess.once('exit', (code) => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill('SIGTERM')
    }

    if (typeof code === 'number' && code !== 0) {
      process.exit(code)
    }
  })

  await waitForUrlReady(DEV_URL)

  electronProcess = spawn(getElectronExecutablePath(), [MAIN_ENTRY_PATH], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: DEV_URL,
    },
  })

  electronProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start Electron.', error)
    shutdown(1)
  })

  electronProcess.once('exit', (code) => {
    if (!webDevProcess.killed) {
      webDevProcess.kill('SIGTERM')
    }

    process.exit(code ?? 0)
  })
}

function prepareStaticBuild() {
  const indexPath = path.join(ROOT_DIR, WEB_OUT_DIR, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(\`Renderer entry not found at \${indexPath}. Run the frontend build first.\`)
  }
}

function prepareNodeServerBuild() {
  if (!NODE_SERVER_SOURCE_ROOT || !NODE_SERVER_ENTRY) {
    throw new Error('A node-server adapter must define both a source runtime root and a server entry.')
  }

  const sourceRuntimeDir = path.resolve(ROOT_DIR, NODE_SERVER_SOURCE_ROOT)
  const sourceServerEntry = path.join(sourceRuntimeDir, NODE_SERVER_ENTRY)
  const stagedRuntimeDir = path.resolve(ROOT_DIR, WEB_OUT_DIR)
  const stagedServerEntry = path.join(stagedRuntimeDir, NODE_SERVER_ENTRY)

  if (!existsSync(sourceServerEntry)) {
    throw new Error(
      \`Node server entry not found at \${sourceServerEntry}. Run the frontend build first.\`,
    )
  }

  rmSync(stagedRuntimeDir, { recursive: true, force: true })
  mkdirSync(path.dirname(stagedRuntimeDir), { recursive: true })
  cpSync(sourceRuntimeDir, stagedRuntimeDir, { recursive: true })

  for (const target of NODE_SERVER_COPY_TARGETS) {
    const sourcePath = path.resolve(ROOT_DIR, target.from)
    const destinationPath = path.join(stagedRuntimeDir, target.to)

    if (!existsSync(sourcePath)) {
      continue
    }

    mkdirSync(path.dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { recursive: true })
  }

  if (!existsSync(stagedServerEntry)) {
    throw new Error(\`Node server entry not found at \${stagedServerEntry} after staging.\`)
  }
}

function prepareBuild() {
  ensureRuntimePackage()

  if (RUNTIME_STRATEGY === 'node-server') {
    prepareNodeServerBuild()
    return
  }

  prepareStaticBuild()
}

if (process.argv.includes('--dev-app')) {
  void runDevApp().catch((error) => {
    console.error('[frontron:init] Failed to run the desktop app.', error)
    process.exit(1)
  })
}

if (process.argv.includes('--prepare-build')) {
  try {
    prepareBuild()
  } catch (error) {
    console.error('[frontron:init] Failed to prepare the production build.', error)
    process.exit(1)
  }
}
`
}

export function renderTsconfigSource(desktopDir: string) {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        rootDir: `./${desktopDir}`,
        outDir: './dist-electron',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmitOnError: true,
        types: ['node'],
      },
      include: [`${desktopDir}/**/*.ts`],
    },
    null,
    2,
  )}\n`
}
