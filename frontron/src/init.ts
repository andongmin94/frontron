import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import readline from 'node:readline/promises'

import type { CliOutput } from './cli'

type PackageJson = {
  name?: string
  version?: string
  scripts?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    files?: unknown
    directories?: {
      output?: string
    }
    extraMetadata?: Record<string, unknown>
    [key: string]: unknown
  }
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

export interface InitPrompter {
  text(message: string, defaultValue: string): Promise<string>
  confirm(message: string, defaultValue: boolean): Promise<boolean>
  close(): Promise<void> | void
}

export interface InitContext {
  cwd: string
  output: CliOutput
  prompter?: InitPrompter
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
}

export interface InitOptions {
  yes: boolean
  force: boolean
  desktopDir?: string
  appScript?: string
  buildScript?: string
  webDevScript?: string
  webBuildScript?: string
  outDir?: string
  productName?: string
  appId?: string
  preset?: string
}

type InitPreset = 'minimal' | 'starter-like'

interface InitConfig {
  cwd: string
  packageJsonPath: string
  packageJson: PackageJson
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  desktopDir: string
  appScript: string
  buildScript: string
  webDevScript: string
  webBuildScript: string
  outDir: string
  productName: string
  appId: string
  preset: InitPreset
  allowExtraMetadataMainOverride: boolean
}

const ELECTRON_VERSION = '^40.1.0'
const ELECTRON_BUILDER_VERSION = '^26.0.12'
const TYPESCRIPT_VERSION = '~6.0.2'
const NODE_TYPES_VERSION = '^25.5.0'
const VALID_PRESETS: readonly InitPreset[] = ['minimal', 'starter-like']

function normalizeValue(value: string, fallback: string) {
  const normalized = value.trim()
  return normalized || fallback
}

function normalizePathValue(value: string, fallback: string) {
  return normalizeValue(value, fallback).replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleCase(value: string) {
  return value
    .replace(/^@/, '')
    .replace(/[\\/]/g, ' ')
    .replace(/[-_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function createDefaultAppId(packageName: string) {
  const slug = slugify(packageName || 'desktop-app') || 'desktop-app'
  return `com.local.${slug}`
}

function normalizePresetValue(value: string | undefined, fallback: InitPreset = 'minimal'): InitPreset {
  const normalized = normalizeValue(value ?? fallback, fallback).toLowerCase() as InitPreset

  if (VALID_PRESETS.includes(normalized)) {
    return normalized
  }

  throw new Error(`Unknown preset "${value}". Expected "minimal" or "starter-like".`)
}

function usesStarterBridge(preset: InitPreset) {
  return preset === 'starter-like'
}

function inferPackageManager(cwd: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun'
  return 'npm'
}

function inferOutDir(cwd: string) {
  for (const fileName of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')
    const outDirMatch = source.match(/outDir\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/)
    const outDir = outDirMatch?.slice(1).find(Boolean)

    if (outDir) {
      return normalizePathValue(outDir, 'dist')
    }
  }

  return null
}

function inferScriptName(packageJson: PackageJson, kind: 'dev' | 'build') {
  const scripts = packageJson.scripts ?? {}
  const preferredCandidates =
    kind === 'dev'
      ? ['dev', 'web:dev', 'frontend:dev', 'client:dev', 'start']
      : ['build', 'web:build', 'frontend:build', 'client:build']

  for (const candidate of preferredCandidates) {
    if (scripts[candidate]) {
      return candidate
    }
  }

  const viteCandidates = Object.entries(scripts)
    .filter(([, command]) =>
      kind === 'dev'
        ? /\bvite(?:\s|$)/i.test(command) && !/\bbuild\b/i.test(command)
        : /\bvite\s+build\b/i.test(command),
    )
    .map(([name]) => name)

  return viteCandidates.length === 1 ? viteCandidates[0] : (kind === 'dev' ? 'dev' : 'build')
}

function isViteBuildCommand(command: string | undefined) {
  return Boolean(command && /\bvite\s+build\b/i.test(command))
}

function inferOutDirFromScript(packageJson: PackageJson, scriptName: string) {
  const command = packageJson.scripts?.[scriptName]

  if (!command || !isViteBuildCommand(command)) {
    return null
  }

  const match = command.match(/(?:--outDir|--outdir|-o)(?:\s+|=)([^\s"'`&]+)/i)
  return match?.[1] ? normalizePathValue(match[1], 'dist') : null
}

function inferViteServerValue(cwd: string, key: 'port' | 'host') {
  for (const fileName of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')

    if (key === 'port') {
      const portMatch = source.match(/server\s*:\s*\{[\s\S]*?port\s*:\s*(\d{1,5})/m)
      const port = Number.parseInt(portMatch?.[1] ?? '', 10)

      if (Number.isInteger(port) && port > 0 && port <= 65_535) {
        return String(port)
      }
    } else {
      const hostMatch = source.match(
        /server\s*:\s*\{[\s\S]*?host\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_.:-]+))/m,
      )
      const host = hostMatch?.slice(1).find(Boolean)

      if (host) {
        return host
      }
    }
  }

  return null
}

function normalizeLoopbackHost(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^["'`]|["'`]$/g, '') ?? ''

  if (!normalized || normalized === '0.0.0.0' || normalized === '::' || normalized === 'true') {
    return '127.0.0.1'
  }

  return normalized
}

function inferPort(packageJson: PackageJson, scriptName: string) {
  const command = packageJson.scripts?.[scriptName]

  if (!command) {
    return null
  }

  for (const pattern of [
    /(?:^|[\s"'`])PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])set\s+PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])--port(?:\s+|=)(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])-p(?:\s+|=)?(\d{1,5})(?=$|[\s"'`&])/i,
  ]) {
    const value = Number.parseInt(command.match(pattern)?.[1] ?? '', 10)

    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      return value
    }
  }

  return null
}

function inferHost(packageJson: PackageJson, scriptName: string) {
  const command = packageJson.scripts?.[scriptName]

  if (!command) {
    return null
  }

  for (const pattern of [
    /(?:^|[\s"'`])HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])set\s+HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--hostname(?:\s+|=)([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--host(?:\s+|=)([^\s"'`&]+)/i,
  ]) {
    const host = command.match(pattern)?.[1]

    if (host) {
      return normalizeLoopbackHost(host)
    }
  }

  return null
}

function createReadlinePrompter(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): InitPrompter {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  return {
    async text(message, defaultValue) {
      const answer = await rl.question(`${message} [${defaultValue}]: `)
      return answer.trim() || defaultValue
    },
    async confirm(message, defaultValue) {
      const answer = (await rl.question(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]: `))
        .trim()
        .toLowerCase()

      if (!answer) {
        return defaultValue
      }

      return answer === 'y' || answer === 'yes'
    },
    close() {
      rl.close()
    },
  }
}

async function chooseDesktopScriptName(
  prompter: InitPrompter | null,
  promptEnabled: boolean,
  packageJson: PackageJson,
  message: string,
  defaultValue: string,
  takenNames: Set<string>,
  conflictFallback: string,
) {
  let candidate = normalizeValue(await askText(prompter, promptEnabled, message, defaultValue), defaultValue)

  while (packageJson.scripts?.[candidate] || takenNames.has(candidate)) {
    if (!promptEnabled || !prompter) {
      throw new Error(`Script name "${candidate}" already exists. Choose a different desktop script name.`)
    }

    candidate = normalizeValue(
      await askText(
        prompter,
        true,
        `${message} (이미 사용 중입니다. 다른 이름을 입력하세요)`,
        conflictFallback,
      ),
      conflictFallback,
    )
  }

  return candidate
}

async function askText(
  prompter: InitPrompter | null,
  enabled: boolean,
  message: string,
  defaultValue: string,
) {
  if (!enabled || !prompter) {
    return defaultValue
  }

  return prompter.text(message, defaultValue)
}

async function askConfirm(
  prompter: InitPrompter | null,
  enabled: boolean,
  message: string,
  defaultValue: boolean,
) {
  if (!enabled || !prompter) {
    return defaultValue
  }

  return prompter.confirm(message, defaultValue)
}

function renderMainSource(preset: InitPreset) {
  const importLines = [
    `import { app, Menu } from 'electron'`,
    `import { createMainWindow, getMainWindow } from './window.js'`,
    `import { startStaticServer, stopStaticServer } from './serve.js'`,
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
    : await startStaticServer()

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
    await stopStaticServer().catch(() => {})
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
      : await startStaticServer()

    if (rendererUrl) {
      createMainWindow(rendererUrl)
${usesStarterBridge(preset) ? '\n      setupIpcHandlers()' : ''}
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    void stopStaticServer().catch(() => {})
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

function renderWindowSource(preset: InitPreset) {
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

function renderPreloadSource() {
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

function renderIpcSource() {
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

function renderElectronTypesSource() {
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

function renderServeSource(config: InitConfig) {
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
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PACKAGE_MANAGER = ${JSON.stringify(config.packageManager)}
const WEB_DEV_SCRIPT = ${JSON.stringify(config.webDevScript)}
const WEB_OUT_DIR = ${JSON.stringify(config.outDir)}
const DEV_URL = ${JSON.stringify(devUrl)}
const LOOPBACK_HOST = '127.0.0.1'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(runtimeDir, '..')
const DIST_DIR = path.resolve(ROOT_DIR, 'dist-electron')
const MAIN_ENTRY_PATH = path.join(DIST_DIR, 'main.js')
const RUNTIME_PACKAGE_PATH = path.join(DIST_DIR, 'package.json')
const require = createRequire(import.meta.url)
const electronExecutablePath = require('electron') as string
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

function ensureRuntimePackage() {
  writeFileSync(RUNTIME_PACKAGE_PATH, JSON.stringify({ type: 'module' }, null, 2))
}

function isUrlReady(urlString: string, timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    const request = httpRequest(urlString, { method: 'GET', timeout: timeoutMs }, (response) => {
      response.resume()
      const statusCode = response.statusCode ?? 0
      resolve(statusCode >= 200 && statusCode < 400)
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

export async function startStaticServer() {
  if (rendererServer) {
    const address = rendererServer.address()
    const port = typeof address === 'object' && address !== null ? address.port : null

    if (typeof port === 'number' && port > 0) {
      return \`http://\${LOOPBACK_HOST}:\${port}\`
    }
  }

  const distPath = path.resolve(ROOT_DIR, WEB_OUT_DIR)
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

export async function stopStaticServer() {
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

  electronProcess = spawn(electronExecutablePath, [MAIN_ENTRY_PATH], {
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

function prepareBuild() {
  ensureRuntimePackage()
  const indexPath = path.join(ROOT_DIR, WEB_OUT_DIR, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(\`Renderer entry not found at \${indexPath}. Run the frontend build first.\`)
  }
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

function renderTsconfigSource(desktopDir: string) {
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

function ensureArray(value: unknown, label: string) {
  if (typeof value === 'undefined') {
    return []
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing packaging rules.`)
  }

  return [...value]
}

function ensureObject<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

function patchPackageJson(config: InitConfig) {
  const packageJson = config.packageJson
  const scripts = { ...(packageJson.scripts ?? {}) }
  const devDependencies = { ...(packageJson.devDependencies ?? {}) }
  const build = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, {})
  const directories = ensureObject<{ output?: string }>(build.directories, {})
  const extraMetadata = ensureObject<Record<string, unknown>>(build.extraMetadata, {})
  const files = ensureArray(build.files, 'build.files')
  const webBuildCommand = scripts[config.webBuildScript]

  if (!webBuildCommand) {
    throw new Error(`Selected web build script "${config.webBuildScript}" was not found.`)
  }

  scripts[config.appScript] = 'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app'
  scripts[config.buildScript] =
    `${webBuildCommand} && tsc -p tsconfig.electron.json && node dist-electron/serve.js --prepare-build && electron-builder`

  devDependencies.electron ??= ELECTRON_VERSION
  devDependencies['electron-builder'] ??= ELECTRON_BUILDER_VERSION
  devDependencies['@types/node'] ??= NODE_TYPES_VERSION
  devDependencies.typescript ??= TYPESCRIPT_VERSION

  build.appId ??= config.appId
  build.productName ??= config.productName

  for (const pattern of ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']) {
    if (!files.includes(pattern)) {
      files.push(pattern)
    }
  }

  build.files = files
  directories.output ??= 'release'
  build.directories = directories

  if (typeof extraMetadata.main === 'undefined' || config.allowExtraMetadataMainOverride) {
    extraMetadata.main = 'dist-electron/main.js'
  }

  build.extraMetadata = extraMetadata

  packageJson.scripts = scripts
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}

function createSummary(config: InitConfig) {
  return [
    `- preset: ${config.preset}`,
    `- frontend dev script: ${config.webDevScript}`,
    `- frontend build script: ${config.webBuildScript}`,
    `- Electron directory: ${config.desktopDir}`,
    `- desktop dev script: ${config.appScript}`,
    `- desktop build script: ${config.buildScript}`,
    `- frontend output: ${config.outDir}`,
    `- package manager: ${config.packageManager}`,
    usesStarterBridge(config.preset) ? '- preload bridge: window.electron' : '- preload bridge: disabled',
  ].join('\n')
}

export async function runInit(options: InitOptions, context: InitContext) {
  if (options.preset) {
    normalizePresetValue(options.preset)
  }

  const packageJsonPath = join(context.cwd, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const promptEnabled = !options.yes
  const prompter =
    promptEnabled
      ? context.prompter ?? createReadlinePrompter(context.stdin ?? process.stdin, context.stdout ?? process.stdout)
      : null

  try {
    const inferredWebDevScript = options.webDevScript ?? inferScriptName(packageJson, 'dev')
    const inferredWebBuildScript = options.webBuildScript ?? inferScriptName(packageJson, 'build')
    const webDevScript = normalizeValue(
      await askText(prompter, promptEnabled, '웹 개발 스크립트 이름', inferredWebDevScript),
      inferredWebDevScript,
    )
    const webBuildScript = normalizeValue(
      await askText(prompter, promptEnabled, '웹 빌드 스크립트 이름', inferredWebBuildScript),
      inferredWebBuildScript,
    )

    if (!packageJson.scripts?.[webDevScript]) {
      throw new Error(`Selected web dev script "${webDevScript}" was not found in package.json.`)
    }

    if (!packageJson.scripts?.[webBuildScript]) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found in package.json.`)
    }

    const desktopDir = normalizePathValue(
      await askText(prompter, promptEnabled, 'Electron 소스 디렉토리', options.desktopDir ?? 'electron'),
      options.desktopDir ?? 'electron',
    )
    const takenDesktopScriptNames = new Set<string>()
    const appScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 개발 스크립트 이름',
      options.appScript ?? 'app',
      takenDesktopScriptNames,
      'desktop:app',
    )
    takenDesktopScriptNames.add(appScript)
    const buildScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 빌드 스크립트 이름',
      options.buildScript ?? 'app:build',
      takenDesktopScriptNames,
      'desktop:build',
    )
    const preset = normalizePresetValue(
      await askText(
        prompter,
        promptEnabled,
        'Preset (minimal|starter-like)',
        options.preset ?? 'minimal',
      ),
      'minimal',
    )
    const inferredOutDir =
      options.outDir ??
      inferOutDirFromScript(packageJson, webBuildScript) ??
      inferOutDir(context.cwd)
    if (!inferredOutDir && options.yes) {
      throw new Error(
        `Unable to infer the frontend build output for "${webBuildScript}". Pass --out-dir or run without --yes.`,
      )
    }
    const outDir = normalizePathValue(
      await askText(
        prompter,
        promptEnabled,
        '프론트엔드 빌드 출력 디렉토리',
        inferredOutDir ?? 'dist',
      ),
      inferredOutDir ?? 'dist',
    )
    const packageName = packageJson.name ?? 'desktop-app'
    const productName = normalizeValue(
      await askText(
        prompter,
        promptEnabled,
        'Product name',
        options.productName ?? titleCase(packageName),
      ),
      options.productName ?? titleCase(packageName),
    )
    const appId = normalizeValue(
      await askText(
        prompter,
        promptEnabled,
        'App ID',
        options.appId ?? createDefaultAppId(packageName),
      ),
      options.appId ?? createDefaultAppId(packageName),
    )
    const existingBuild = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, {})
    const existingExtraMetadata = ensureObject<Record<string, unknown>>(existingBuild.extraMetadata, {})
    const existingExtraMetadataMain = existingExtraMetadata.main

    if (
      typeof existingExtraMetadataMain !== 'undefined' &&
      typeof existingExtraMetadataMain !== 'string'
    ) {
      throw new Error(
        'Existing build.extraMetadata.main must be a string to preserve existing packaging rules.',
      )
    }

    let allowExtraMetadataMainOverride =
      typeof existingExtraMetadataMain === 'undefined' ||
      existingExtraMetadataMain === 'dist-electron/main.js' ||
      options.force

    if (!allowExtraMetadataMainOverride && existingExtraMetadataMain) {
      allowExtraMetadataMainOverride = await askConfirm(
        prompter,
        promptEnabled,
        `기존 build.extraMetadata.main (${existingExtraMetadataMain}) 값을 dist-electron/main.js로 바꿀까요?`,
        false,
      )

      if (!allowExtraMetadataMainOverride) {
        throw new Error('Init aborted because build.extraMetadata.main already exists.')
      }
    }

    const filesToWrite = new Map<string, string>([
      [join(context.cwd, desktopDir, 'main.ts'), renderMainSource(preset)],
      [join(context.cwd, desktopDir, 'window.ts'), renderWindowSource(preset)],
      [
        join(context.cwd, desktopDir, 'serve.ts'),
        renderServeSource({
          cwd: context.cwd,
          packageJsonPath,
          packageJson,
          packageManager: inferPackageManager(context.cwd),
          desktopDir,
          appScript,
          buildScript,
          webDevScript,
          webBuildScript,
          outDir,
          productName,
          appId,
          preset,
          allowExtraMetadataMainOverride,
        }),
      ],
      [join(context.cwd, 'tsconfig.electron.json'), renderTsconfigSource(desktopDir)],
    ])

    if (usesStarterBridge(preset)) {
      filesToWrite.set(join(context.cwd, desktopDir, 'preload.ts'), renderPreloadSource())
      filesToWrite.set(join(context.cwd, desktopDir, 'ipc.ts'), renderIpcSource())
      filesToWrite.set(join(context.cwd, 'src', 'types', 'electron.d.ts'), renderElectronTypesSource())
    }

    const conflicts = [...filesToWrite.keys()].filter((filePath) => existsSync(filePath))

    if (conflicts.length > 0 && !options.force) {
      const overwrite = await askConfirm(
        prompter,
        promptEnabled,
        `기존 파일을 덮어쓸까요? ${conflicts
          .map((filePath) => normalizePathValue(relative(context.cwd, filePath), filePath))
          .join(', ')}`,
        false,
      )

      if (!overwrite) {
        throw new Error('Init aborted because one or more target files already exist.')
      }
    }

    const config: InitConfig = {
      cwd: context.cwd,
      packageJsonPath,
      packageJson,
      packageManager: inferPackageManager(context.cwd),
      desktopDir,
      appScript,
      buildScript,
      webDevScript,
      webBuildScript,
      outDir,
      productName,
      appId,
      preset,
      allowExtraMetadataMainOverride,
    }

    patchPackageJson(config)

    for (const [filePath, source] of filesToWrite) {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, source, 'utf8')
    }

    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

    context.output.info(`[Frontron] Added the ${preset} Electron retrofit layer.`)
    context.output.info(createSummary(config))
    context.output.info('')
    context.output.info(`Run "${appScript}" to start the desktop app after installing dependencies.`)
    context.output.info(`Run "${buildScript}" to create a packaged build.`)

    return 0
  } finally {
    await prompter?.close()
  }
}
