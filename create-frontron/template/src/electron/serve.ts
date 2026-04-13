import { spawn, type ChildProcess } from "node:child_process"
import fs from "fs"
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type ServerResponse,
} from "node:http"
import { request as httpsRequest } from "node:https"
import { createRequire } from "node:module"
import path from "path"
import { fileURLToPath } from "url"

const loopbackHost = "127.0.0.1"
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(runtimeDir, "../..")
const require = createRequire(import.meta.url)
const electronExecutablePath = require("electron") as string
const { ELECTRON_RUN_AS_NODE: _ignoredElectronRunAsNode, ...childEnv } =
  process.env
const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

let rendererServer: ReturnType<typeof createServer> | null = null
let viteDevServer: import("vite").ViteDevServer | null = null
let electronProcess: ChildProcess | null = null
let devShutdownPromise: Promise<void> | null = null
let closeElectronWatcher: (() => void) | null = null
let closeLauncherWatcher: (() => void) | null = null
let electronHasExited = false
let electronRestartPromise: Promise<void> | null = null
let electronRestartQueued = false
let hasStartedElectronOnce = false
let isIntentionallyStoppingElectron = false
let isRestartingLauncher = false
let isLauncherRestartScheduled = false
let launcherRestartTimeout: ReturnType<typeof setTimeout> | null = null
type PackageJson = {
  scripts?: Record<string, string>
}
type ViteDevServerOptions = {
  host: string | null
  port: number | null
}

function resolveDevRendererUrl(server: import("vite").ViteDevServer) {
  const localUrl =
    server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network?.[0]

  if (localUrl) {
    return localUrl
  }

  const address = server.httpServer?.address()

  if (typeof address === "object" && address !== null) {
    return `http://localhost:${address.port}`
  }

  throw new Error("Failed to resolve the Vite dev server URL.")
}

async function stopElectronProcess() {
  if (!electronProcess || electronHasExited) {
    electronProcess = null
    return
  }

  const child = electronProcess
  isIntentionallyStoppingElectron = true

  await new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL")
    }, 5_000)

    child.once("exit", () => {
      clearTimeout(forceKillTimer)
      resolve()
    })

    child.kill("SIGTERM")
  })

  electronProcess = null
  electronHasExited = true
  isIntentionallyStoppingElectron = false
}

function spawnElectronProcess(rendererUrl: string) {
  electronHasExited = false
  electronProcess = spawn(electronExecutablePath, ["."], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...childEnv,
      NODE_ENV: "development",
      ELECTRON_RENDERER_URL: rendererUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  })

  electronProcess.once("error", async (error) => {
    console.error("[template] Failed to start Electron.", error)
    await shutdownDevLauncher(1)
  })

  electronProcess.once("exit", async (code, signal) => {
    electronHasExited = true

    if (isIntentionallyStoppingElectron) {
      return
    }

    electronProcess = null

    if (signal) {
      await shutdownDevLauncher(1)
      return
    }

    await shutdownDevLauncher(code ?? 0)
  })
}

async function restartElectronProcess(rendererUrl: string) {
  if (isRestartingLauncher || isLauncherRestartScheduled) {
    return Promise.resolve()
  }

  if (electronRestartPromise) {
    electronRestartQueued = true
    return electronRestartPromise
  }

  electronRestartPromise = (async () => {
    do {
      electronRestartQueued = false

      if (hasStartedElectronOnce) {
        console.log("[template] Electron sources changed. Restarting app...")
        await stopElectronProcess()
      }

      spawnElectronProcess(rendererUrl)
      hasStartedElectronOnce = true
    } while (electronRestartQueued)
  })().finally(() => {
    electronRestartPromise = null
  })

  return electronRestartPromise
}

async function shutdownDevLauncher(exitCode = 0, shouldKillElectron = false) {
  if (devShutdownPromise) {
    return devShutdownPromise
  }

  devShutdownPromise = (async () => {
    if (closeLauncherWatcher) {
      closeLauncherWatcher()
      closeLauncherWatcher = null
    }

    if (closeElectronWatcher) {
      closeElectronWatcher()
      closeElectronWatcher = null
    }

    if (shouldKillElectron) {
      await stopElectronProcess()
    }

    if (viteDevServer) {
      await viteDevServer.close().catch((error) => {
        console.error("[template] Failed to close the Vite dev server.", error)
      })
      viteDevServer = null
    }

    process.exit(exitCode)
  })()

  return devShutdownPromise
}

async function restartDevLauncher(reason: string) {
  if (isRestartingLauncher) {
    return
  }

  isRestartingLauncher = true
  console.log(`[template] ${reason}. Restarting dev launcher...`)

  if (closeLauncherWatcher) {
    closeLauncherWatcher()
    closeLauncherWatcher = null
  }

  if (closeElectronWatcher) {
    closeElectronWatcher()
    closeElectronWatcher = null
  }

  await stopElectronProcess()

  if (viteDevServer) {
    await viteDevServer.close().catch((error) => {
      console.error("[template] Failed to close the Vite dev server.", error)
    })
    viteDevServer = null
  }

  const launcherProcess = spawn(process.execPath, process.argv.slice(1), {
    cwd: rootDir,
    stdio: "inherit",
    env: childEnv,
  })

  launcherProcess.once("error", (error) => {
    console.error("[template] Failed to restart the dev launcher.", error)
    process.exit(1)
  })

  process.exit(0)
}

function parseJsonFile<T>(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

function normalizeQuotedValue(value: string) {
  return value
    .replace(/^(["'`])/, "")
    .replace(/(["'`])$/, "")
    .trim()
}

function normalizeClientHost(host: string | null | undefined) {
  const normalizedHost = normalizeQuotedValue(host ?? "").replace(
    /^\[|\]$/g,
    ""
  )

  if (
    !normalizedHost ||
    normalizedHost === "0.0.0.0" ||
    normalizedHost === "::" ||
    normalizedHost === "::0" ||
    normalizedHost.toLowerCase() === "true"
  ) {
    return "localhost"
  }

  return normalizedHost
}

function formatUrlHost(host: string) {
  return host.includes(":") ? `[${host}]` : host
}

function inferEnvHost() {
  return process.env.HOST ? normalizeClientHost(process.env.HOST) : null
}

function parsePortValue(value: string | null | undefined) {
  if (!value) return null

  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
}

function getPackageScripts(packageJsonPath: string) {
  const packageJson = parseJsonFile<PackageJson>(packageJsonPath)
  const scripts = packageJson?.scripts ?? {}
  const commands: string[] = []

  if (typeof scripts.app === "string") commands.push(scripts.app)
  if (typeof scripts.dev === "string") commands.push(scripts.dev)

  return commands
}

function inferCommandPort(command: string) {
  const patterns = [
    /(?:^|[\s"'`])PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])set\s+PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])--port(?:\s+|=)(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])-p(?:\s+|=)?(\d{1,5})(?=$|[\s"'`&])/i,
  ]

  for (const pattern of patterns) {
    const match = command.match(pattern)
    const port = parsePortValue(match?.[1])

    if (port !== null) {
      return port
    }
  }

  return null
}

function inferCommandHost(command: string) {
  const patterns = [
    /(?:^|[\s"'`])HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])set\s+HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--hostname(?:\s+|=)([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--host(?:\s+|=)([^\s"'`&]+)/i,
  ]

  for (const pattern of patterns) {
    const match = command.match(pattern)
    const host = match?.[1]

    if (host) {
      return normalizeClientHost(host)
    }
  }

  return null
}

function getViteServerBlock(configPath: string) {
  try {
    if (!fs.existsSync(configPath)) {
      return null
    }

    const configContent = fs.readFileSync(configPath, "utf-8")
    return configContent.match(/server\s*:\s*\{([\s\S]*?)\}/)?.[1] ?? null
  } catch {
    return null
  }
}

function inferVitePort(configPath: string) {
  const serverBlock = getViteServerBlock(configPath)
  return parsePortValue(serverBlock?.match(/port\s*:\s*(\d{1,5})/)?.[1])
}

function inferViteHost(configPath: string) {
  const serverBlock = getViteServerBlock(configPath)
  const match = serverBlock?.match(
    /host\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_.:-]+))/
  )
  const host = match?.slice(1).find(Boolean)

  return host ? normalizeClientHost(host) : null
}

function normalizeResolvedViteHost(host: boolean | string | undefined) {
  if (typeof host === "string") {
    return normalizeClientHost(host)
  }

  if (host === true) {
    return "localhost"
  }

  return null
}

async function resolveViteDevServerOptions(
  configPath: string,
  portOverride: number | null,
  hostOverride: string | null
) {
  try {
    const { resolveConfig } = await import("vite")
    const resolvedConfig = await resolveConfig(
      {
        configFile: configPath,
        mode: "development",
        server: {
          host: hostOverride ?? undefined,
          port: portOverride ?? undefined,
        },
      },
      "serve"
    )

    return {
      host: normalizeResolvedViteHost(resolvedConfig.server.host),
      port: resolvedConfig.server.port ?? null,
    } satisfies ViteDevServerOptions
  } catch {
    return null
  }
}

function isUrlReady(urlString: string, timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    const url = new URL(urlString)
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        timeout: timeoutMs,
        headers: {
          Accept: "text/html",
        },
      },
      (response) => {
        response.resume()
        const statusCode = response.statusCode ?? 0
        resolve(statusCode >= 200 && statusCode < 400)
      }
    )

    request.once("timeout", () => {
      request.destroy()
      resolve(false)
    })

    request.once("error", () => {
      resolve(false)
    })

    request.end()
  })
}

function sendResponse(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8"
) {
  response.writeHead(statusCode, { "Content-Type": contentType })
  response.end(body)
}

function resolveRequestPath(distPath: string, requestPath: string) {
  const normalizedPath = path.posix.normalize(requestPath)
  const relativePath =
    normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^\/+/, "")
  const resolvedPath = path.resolve(distPath, relativePath)
  const isInsideDist =
    resolvedPath === distPath ||
    resolvedPath.startsWith(`${distPath}${path.sep}`)

  if (!isInsideDist) {
    return null
  }

  return resolvedPath
}

function getContentType(filePath: string) {
  const fileExtension = path.extname(filePath).toLowerCase()
  return mimeTypes.get(fileExtension) ?? "application/octet-stream"
}

function serveFile(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  filePath: string
) {
  response.writeHead(200, { "Content-Type": getContentType(filePath) })

  if (request.method === "HEAD") {
    response.end()
    return
  }

  fs.createReadStream(filePath).pipe(response)
}

function handleRendererRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  distPath: string,
  indexPath: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendResponse(response, 405, "Method Not Allowed")
    return
  }

  let pathname: string

  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? "/", `http://${loopbackHost}`).pathname
    )
  } catch {
    sendResponse(response, 400, "Bad Request")
    return
  }

  const resolvedPath = resolveRequestPath(distPath, pathname)

  if (!resolvedPath) {
    sendResponse(response, 403, "Forbidden")
    return
  }

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    serveFile(request, response, resolvedPath)
    return
  }

  if (path.extname(pathname)) {
    sendResponse(response, 404, "Not Found")
    return
  }

  serveFile(request, response, indexPath)
}

export async function waitForUrlReady(
  urlString: string,
  timeoutMs = 30_000,
  intervalMs = 250
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isUrlReady(urlString)) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for dev server on ${urlString}`)
}

export async function inferDevUrl() {
  const explicitUrl = process.env.ELECTRON_RENDERER_URL?.trim()

  if (explicitUrl) {
    return explicitUrl
  }

  const packageJsonPath = path.join(runtimeDir, "../../package.json")
  const viteConfigPath = path.join(runtimeDir, "../../vite.config.ts")
  const commands = getPackageScripts(packageJsonPath)
  const commandPort =
    parsePortValue(process.env.PORT) ??
    commands.map(inferCommandPort).find((value) => value !== null) ??
    null
  const commandHost =
    inferEnvHost() ??
    commands.map(inferCommandHost).find((value) => value !== null) ??
    null
  const viteServerOptions = await resolveViteDevServerOptions(
    viteConfigPath,
    commandPort,
    commandHost
  )
  const port =
    commandPort ??
    viteServerOptions?.port ??
    inferVitePort(viteConfigPath) ??
    5173
  const host =
    commandHost ??
    viteServerOptions?.host ??
    inferViteHost(viteConfigPath) ??
    "localhost"

  return `http://${formatUrlHost(host)}:${port}`
}

function watchLauncherSources() {
  const runtimeFiles = new Set(["serve.ts"])
  const rootFiles = new Set([
    "package.json",
    "tsconfig.electron.json",
    "vite.config.ts",
  ])

  const scheduleRestart = (reason: string) => {
    if (isRestartingLauncher || isLauncherRestartScheduled) {
      return
    }

    isLauncherRestartScheduled = true

    if (launcherRestartTimeout) {
      clearTimeout(launcherRestartTimeout)
    }

    launcherRestartTimeout = setTimeout(() => {
      launcherRestartTimeout = null
      isLauncherRestartScheduled = false
      void restartDevLauncher(reason)
    }, 100)
  }

  const runtimeWatcher = fs.watch(runtimeDir, (_eventType, fileName) => {
    const normalizedFileName = fileName?.toString()

    if (!normalizedFileName || !runtimeFiles.has(normalizedFileName)) {
      return
    }

    scheduleRestart(
      `Detected launcher change in src/electron/${normalizedFileName}`
    )
  })

  const rootWatcher = fs.watch(rootDir, (_eventType, fileName) => {
    const normalizedFileName = fileName?.toString()

    if (!normalizedFileName || !rootFiles.has(normalizedFileName)) {
      return
    }

    scheduleRestart(
      `Detected launcher dependency change in ${normalizedFileName}`
    )
  })

  closeLauncherWatcher = () => {
    if (launcherRestartTimeout) {
      clearTimeout(launcherRestartTimeout)
      launcherRestartTimeout = null
    }

    runtimeWatcher.close()
    rootWatcher.close()
  }
}

async function watchElectronSources(rendererUrl: string) {
  const ts = await import("typescript")
  const configPath = path.join(rootDir, "tsconfig.electron.json")
  const formatHost = {
    getCanonicalFileName: (fileName: string) => fileName,
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
  }
  const reportDiagnostic = (diagnostic: import("typescript").Diagnostic) => {
    console.error(ts.formatDiagnostic(diagnostic, formatHost))
  }
  const reportWatchStatusChanged = (
    diagnostic: import("typescript").Diagnostic
  ) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      ts.sys.newLine
    )

    if (message.includes("Found 0 errors")) {
      return
    }

    console.log(`[template] ${message}`)
  }

  const host = ts.createWatchCompilerHost(
    configPath,
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    reportDiagnostic,
    reportWatchStatusChanged
  )
  const originalAfterProgramCreate = host.afterProgramCreate

  host.afterProgramCreate = (builderProgram) => {
    originalAfterProgramCreate?.(builderProgram)

    const diagnostics = ts.getPreEmitDiagnostics(builderProgram.getProgram())

    if (diagnostics.length > 0) {
      return
    }

    void restartElectronProcess(rendererUrl)
  }

  const watcher = ts.createWatchProgram(host)
  closeElectronWatcher = () => watcher.close()
}

export async function runDevApp() {
  if (!fs.existsSync(electronExecutablePath)) {
    throw new Error(
      `Electron executable not found at ${electronExecutablePath}.`
    )
  }

  const { createServer: createViteServer } = await import("vite")

  viteDevServer = await createViteServer({
    root: rootDir,
    configFile: path.join(rootDir, "vite.config.ts"),
    clearScreen: false,
  })

  await viteDevServer.listen()
  viteDevServer.printUrls()

  const rendererUrl = resolveDevRendererUrl(viteDevServer)
  watchLauncherSources()
  await watchElectronSources(rendererUrl)
}

export async function startRendererServer() {
  if (rendererServer) {
    const address = rendererServer.address()
    const port =
      typeof address === "object" && address !== null ? address.port : null

    if (typeof port === "number" && port > 0) {
      return `http://${loopbackHost}:${port}`
    }
  }

  const distPath = path.resolve(runtimeDir, "../../dist")
  const indexPath = path.join(distPath, "index.html")

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Renderer entry not found at ${indexPath}.`)
  }

  rendererServer = createServer((request, response) => {
    handleRendererRequest(request, response, distPath, indexPath)
  })

  return new Promise<string>((resolve, reject) => {
    const server = rendererServer

    if (!server) {
      reject(new Error("Renderer server failed to initialize."))
      return
    }

    const handleError = (error: Error) => {
      rendererServer = null
      reject(error)
    }

    server.once("error", handleError)
    server.listen(0, loopbackHost, () => {
      server.off("error", handleError)

      const address = server.address()
      const port =
        typeof address === "object" && address !== null ? address.port : null

      if (typeof port !== "number" || port <= 0) {
        rendererServer = null
        reject(new Error("Renderer server failed to bind to a valid port."))
        return
      }

      resolve(`http://${loopbackHost}:${port}`)
    })
  })
}

export async function stopRendererServer() {
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

if (process.argv.includes("--dev-app")) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await shutdownDevLauncher(0, true)
    })
  }

  void runDevApp().catch(async (error) => {
    console.error("[template] Failed to start the development app.", error)
    await shutdownDevLauncher(1, true)
  })
}
