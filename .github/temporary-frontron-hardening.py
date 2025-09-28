from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:80]!r}")
    write(path, source.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    source = read(path)
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, found {count}: {pattern[:80]!r}")
    write(path, updated)


STATIC_SERVER_SOURCE = r'''import { open, realpath, stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import path from "node:path"

const loopbackHost = "127.0.0.1"
const forbiddenStaticPath = Symbol("forbidden-static-path")
const invalidByteRange = Symbol("invalid-byte-range")
const mimeTypes = new Map<string, string>([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".ogv", "video/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
])

let rendererServer: Server | null = null

function sendResponse(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
  headers: Record<string, string> = {}
) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(request.method === "HEAD" ? undefined : body)
}

function getContentType(filePath: string) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
}

function isPathInside(rootPath: string, candidatePath: string) {
  const relativePath = path.relative(rootPath, candidatePath)
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  )
}

function decodeRequestPath(requestUrl: string) {
  const queryIndex = requestUrl.indexOf("?")
  const rawPath = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex)

  if (!rawPath.startsWith("/")) {
    throw new Error("Static requests must use an origin-form path.")
  }

  return decodeURIComponent(rawPath)
}

async function resolveRequestPath(distPath: string, requestPath: string) {
  if (
    !requestPath.startsWith("/") ||
    requestPath.includes("\0") ||
    requestPath.includes("\\") ||
    requestPath.split("/").some((segment) => segment === "..")
  ) {
    return forbiddenStaticPath
  }

  const normalizedPath = path.posix.normalize(requestPath)
  const relativePath =
    normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^\/+/, "")
  const resolvedPath = path.resolve(distPath, relativePath)

  if (!isPathInside(distPath, resolvedPath)) {
    return forbiddenStaticPath
  }

  let realPath: string

  try {
    realPath = await realpath(resolvedPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return null
    if (code === "EACCES" || code === "EPERM" || code === "ELOOP") {
      return forbiddenStaticPath
    }
    throw error
  }

  if (!isPathInside(distPath, realPath)) {
    return forbiddenStaticPath
  }

  try {
    return (await stat(realPath)).isFile() ? realPath : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return null
    throw error
  }
}

function parseByteRange(rangeHeader: string | undefined, fileSize: number) {
  if (!rangeHeader) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match || (!match[1] && !match[2]) || fileSize === 0) {
    return invalidByteRange
  }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return invalidByteRange
    }
    return { start: Math.max(fileSize - suffixLength, 0), end: fileSize - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return invalidByteRange
  }

  return { start, end: Math.min(requestedEnd, fileSize - 1) }
}

function sendFileError(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  error: unknown
) {
  if (response.destroyed) return
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined)
    return
  }

  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
    sendResponse(request, response, 404, "Not Found")
    return
  }
  if (code === "EACCES" || code === "EPERM") {
    sendResponse(request, response, 403, "Forbidden")
    return
  }

  console.error("[frontron] Failed to serve a renderer file.", error)
  sendResponse(request, response, 500, "Internal Server Error")
}

async function serveFile(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  filePath: string
) {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null

  try {
    fileHandle = await open(filePath, "r")
    const fileStats = await fileHandle.stat()
    if (!fileStats.isFile()) {
      await fileHandle.close()
      sendResponse(request, response, 404, "Not Found")
      return
    }

    const byteRange = parseByteRange(request.headers.range, fileStats.size)
    if (byteRange === invalidByteRange) {
      await fileHandle.close()
      sendResponse(request, response, 416, "Range Not Satisfiable", undefined, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${fileStats.size}`,
      })
      return
    }

    const statusCode = byteRange ? 206 : 200
    const contentLength = byteRange
      ? byteRange.end - byteRange.start + 1
      : fileStats.size
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Length": String(contentLength),
      "Content-Type": getContentType(filePath),
    }
    if (byteRange) {
      headers["Content-Range"] = `bytes ${byteRange.start}-${byteRange.end}/${fileStats.size}`
    }

    if (request.method === "HEAD") {
      await fileHandle.close()
      response.writeHead(statusCode, headers)
      response.end()
      return
    }

    const stream = fileHandle.createReadStream(
      byteRange ? { start: byteRange.start, end: byteRange.end } : {}
    )
    stream.once("error", (error) => sendFileError(request, response, error))
    response.once("close", () => {
      if (!response.writableEnded) stream.destroy()
    })
    response.writeHead(statusCode, headers)
    stream.pipe(response)
  } catch (error) {
    await fileHandle?.close().catch(() => {})
    sendFileError(request, response, error)
  }
}

async function handleRendererRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  distPath: string,
  indexPath: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendResponse(request, response, 405, "Method Not Allowed", undefined, {
      Allow: "GET, HEAD",
    })
    return
  }

  let pathname: string
  try {
    pathname = decodeRequestPath(request.url ?? "/")
  } catch {
    sendResponse(request, response, 400, "Bad Request")
    return
  }

  let resolvedPath: string | null | typeof forbiddenStaticPath
  try {
    resolvedPath = await resolveRequestPath(distPath, pathname)
  } catch (error) {
    sendFileError(request, response, error)
    return
  }

  if (resolvedPath === forbiddenStaticPath) {
    sendResponse(request, response, 403, "Forbidden")
    return
  }
  if (resolvedPath) {
    await serveFile(request, response, resolvedPath)
    return
  }
  if (path.extname(pathname)) {
    sendResponse(request, response, 404, "Not Found")
    return
  }

  await serveFile(request, response, indexPath)
}

export async function startStaticRendererServer(configuredDistPath: string) {
  if (rendererServer) {
    const address = rendererServer.address()
    const port = typeof address === "object" && address !== null ? address.port : null
    if (typeof port === "number" && port > 0) {
      return `http://${loopbackHost}:${port}`
    }
  }

  const configuredIndexPath = path.join(configuredDistPath, "index.html")
  const distPath = await realpath(configuredDistPath)
  const indexPath = await resolveRequestPath(distPath, "/")
  if (typeof indexPath !== "string") {
    throw new Error(`Renderer entry at ${configuredIndexPath} is not a safe regular file.`)
  }

  rendererServer = createServer((request, response) => {
    void handleRendererRequest(request, response, distPath, indexPath).catch((error) => {
      sendFileError(request, response, error)
    })
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
      const port = typeof address === "object" && address !== null ? address.port : null
      if (typeof port !== "number" || port <= 0) {
        rendererServer = null
        reject(new Error("Renderer server failed to bind to a valid port."))
        return
      }
      resolve(`http://${loopbackHost}:${port}`)
    })
  })
}

export async function stopStaticRendererServer() {
  if (!rendererServer) return
  const server = rendererServer
  rendererServer = null
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
'''

TASKS_SOURCE = r'''import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2]
const extraArgs = process.argv.slice(3)
const formatTargets = ["src", "scripts", "vite.config.ts", "package.json"]

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const binPackages = { tsc: "typescript" }

function resolveBin(name) {
  const packageName = binPackages[name] ?? name
  const packageJsonPath = join(root, "node_modules", packageName, "package.json")
  if (!existsSync(packageJsonPath)) {
    console.error(`[tasks] Missing dependency for "${name}". Run install first.`)
    process.exit(1)
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : (packageJson.bin?.[name] ?? packageJson.bin?.[packageName])
  if (!bin) {
    console.error(`[tasks] Package "${packageName}" does not expose a "${name}" binary.`)
    process.exit(1)
  }
  return join(root, "node_modules", packageName, bin)
}

function runNode(args = []) {
  run(process.execPath, args)
}

function runBin(name, args = []) {
  runNode([resolveBin(name), ...args])
}

function getElectronBuilderArgs(args) {
  const hasExplicitPublish = args.some(
    (argument) => argument === "--publish" || argument.startsWith("--publish=")
  )
  return hasExplicitPublish ? args : ["--publish", "never", ...args]
}

switch (command) {
  case "dev":
    runBin("vite", extraArgs)
    break
  case "app":
    runNode([
      "--no-deprecation",
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      "src/electron/serve.ts",
      "--dev-app",
      ...extraArgs,
    ])
    break
  case "typecheck":
    runBin("tsc", ["-b"])
    runBin("tsc", ["-p", "tsconfig.electron.json"])
    break
  case "build":
    runBin("tsc", ["-b"])
    runBin("vite", ["build"])
    runBin("tsc", ["-p", "tsconfig.electron.json"])
    runBin("electron-builder", getElectronBuilderArgs(extraArgs))
    break
  case "lint":
    runBin("oxlint", ["src", "vite.config.ts"])
    break
  case "format":
    runBin("oxfmt", formatTargets)
    break
  case "format:check":
    runBin("oxfmt", ["--check", ...formatTargets])
    break
  default:
    console.error(`[tasks] Unknown command: ${command ?? "(missing)"}`)
    process.exit(1)
}
'''

MAIN_SOURCE = r'''import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { app, Menu, net, protocol } from "electron"

import { setupDevMenu } from "./dev.js"
import { setupIpcHandlers } from "./ipc.js"
import {
  inferDevUrl,
  startRendererServer,
  stopRendererServer,
  waitForUrlReady,
} from "./serve.js"
import { closeSplash, createSplash } from "./splash.js"
import { createWindow, mainWindow } from "./window.js"

export const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const isDev = process.env.NODE_ENV === "development"
const rendererScheme = "frontron"
export const rendererOrigin = `${rendererScheme}://app`
const defaultRendererCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
let rendererUrl: string | null = null

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

function resolveRendererProxyUrl(requestUrl: string, targetOrigin: string) {
  const rendererRequestUrl = new URL(requestUrl)
  if (
    rendererRequestUrl.protocol !== `${rendererScheme}:` ||
    rendererRequestUrl.host !== "app"
  ) {
    return null
  }

  const proxyUrl = new URL(targetOrigin)
  proxyUrl.pathname = rendererRequestUrl.pathname
  proxyUrl.search = rendererRequestUrl.search
  return proxyUrl
}

function rewriteRendererLocation(
  headers: Headers,
  proxyUrl: URL,
  targetOrigin: string
) {
  const location = headers.get("location")
  if (!location) return

  try {
    const redirectUrl = new URL(location, proxyUrl)
    if (redirectUrl.origin === targetOrigin) {
      headers.set(
        "location",
        `${rendererOrigin}${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
      )
    }
  } catch {
    headers.delete("location")
  }
}

function ensureRendererCsp(headers: Headers) {
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", defaultRendererCsp)
  }
}

function rewriteRendererRequestHeaders(request: Request, targetOrigin: string) {
  const headers = new Headers(request.headers)
  if (headers.get("origin") === rendererOrigin) headers.set("origin", targetOrigin)

  const referer = headers.get("referer")
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      if (refererUrl.protocol === `${rendererScheme}:` && refererUrl.host === "app") {
        headers.set(
          "referer",
          `${targetOrigin}${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`
        )
      }
    } catch {
      headers.delete("referer")
    }
  }

  return headers
}

export async function registerRendererProtocol(rendererTargetUrl: string) {
  const targetOrigin = new URL(rendererTargetUrl).origin

  await protocol.handle(rendererScheme, async (request) => {
    const proxyUrl = resolveRendererProxyUrl(request.url, targetOrigin)
    if (!proxyUrl) return new Response("Not Found", { status: 404 })

    try {
      const upstreamResponse = await net.fetch(proxyUrl.toString(), {
        method: request.method,
        headers: rewriteRendererRequestHeaders(request, targetOrigin),
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual",
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
      console.error("Failed to proxy renderer request:", error)
      return new Response("Bad Gateway", { status: 502 })
    }
  })
}

function runRendererProbe() {
  const outputPath = process.env.FRONTRON_RENDERER_PROBE_PATH?.trim()
  if (!outputPath || !mainWindow) return

  const capture = async () => {
    try {
      const result = await mainWindow?.webContents.executeJavaScript(
        `(async () => ({
          protocol: window.location.protocol,
          origin: window.location.origin,
          title: document.title,
          bodyText: document.body?.innerText ?? "",
          bridgeType: typeof window.electron,
          appInfo: typeof window.electron?.getAppInfo === "function"
            ? await window.electron.getAppInfo()
            : null,
        }))()`,
        true
      )
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`,
        "utf8"
      )
      app.exit(0)
    } catch (error) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify({ ok: false, error: String(error) }, null, 2)}\n`,
        "utf8"
      )
      app.exit(1)
    }
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => void capture())
  } else {
    void capture()
  }
}

function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
  runRendererProbe()
}

async function initializeApp() {
  await app.whenReady()
  createSplash()

  if (isDev) {
    rendererUrl =
      process.env.ELECTRON_RENDERER_URL?.trim() || (await inferDevUrl())
    rendererUrl = await waitForUrlReady(rendererUrl)
  } else {
    const rendererTargetUrl = await startRendererServer()
    await registerRendererProtocol(rendererTargetUrl)
    rendererUrl = `${rendererOrigin}/`
  }

  openMainWindow()
  if (isDev) setupDevMenu()
  else Menu.setApplicationMenu(null)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  initializeApp().catch(async (error) => {
    console.error("Failed to initialize app:", error)
    closeSplash()
    await stopRendererServer().catch(() => {})
    const { dialog } = await import("electron")
    dialog.showErrorBox(
      "Error",
      `Failed to initialize app:\n${(error as Error).message}`
    )
    app.quit()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("activate", () => {
    if (mainWindow) mainWindow.show()
    else openMainWindow()
  })

  app.on("before-quit", () => {
    void stopRendererServer().catch((error: unknown) => {
      console.error("Failed to stop renderer server:", error)
    })
  })
}
'''

WINDOW_SOURCE = r'''import { existsSync } from "node:fs"
import path from "path"
import { BrowserWindow, shell } from "electron"

import { __dirname, isDev } from "./main.js"
import { closeSplash } from "./splash.js"

export let mainWindow: BrowserWindow | null = null

function isRendererUrl(urlString: string, rendererUrl: URL) {
  try {
    const url = new URL(urlString)
    return url.protocol === rendererUrl.protocol && url.host === rendererUrl.host
  } catch {
    return false
  }
}

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

export function createWindow(rendererUrl: string, beforeLoad?: () => void) {
  const preloadPath = path.join(__dirname, "preload.js")
  const windowIconPath = path.join(__dirname, "../../public/icon.ico")
  if (!existsSync(preloadPath)) {
    console.error(`Preload script not found at ${preloadPath}.`)
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 480,
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
    if (details.isMainFrame) openExternalHttpUrl(details.url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererUrl(url, rendererBaseUrl)) openExternalHttpUrl(url)
    return { action: "deny" }
  })

  beforeLoad?.()
  void mainWindow.loadURL(rendererUrl)

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash()
    if (!process.env.FRONTRON_RENDERER_PROBE_PATH) mainWindow?.show()

    if (isDev) {
      void mainWindow?.webContents
        .executeJavaScript(
          `Boolean(window.electron && typeof window.electron.getAppInfo === "function")`,
          true
        )
        .then((hasBridge) => {
          if (!hasBridge) {
            console.warn("[template] Preload bridge is unavailable in the renderer.")
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

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}
'''

PACKAGE_MANAGER_SMOKE = r'''import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const createRoot = join(root, "create-frontron")
const frontronRoot = join(root, "frontron")
const temporaryDirectories = []

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", shell: false })
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || `${command} failed`)
  }
  return result.stdout.trim()
}

function npm(args, cwd) {
  return run("npm", args, cwd)
}

function npx(packageName, binary, args, cwd) {
  return run("npx", ["--yes", "--package", packageName, "--", binary, ...args], cwd)
}

function pack(packageRoot, prefix) {
  const output = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(output)
  const result = JSON.parse(
    npm(["pack", "--json", "--ignore-scripts", "--pack-destination", output], packageRoot)
  )
  const filename = result[0]?.filename
  if (!filename) throw new Error("npm pack did not report a filename")
  return join(output, filename)
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

try {
  npm(["run", "build"], createRoot)
  npm(["run", "build"], frontronRoot)
  const createTarball = pack(createRoot, "frontron-create-pack-")
  const frontronTarball = pack(frontronRoot, "frontron-pack-")

  const pnpmRetrofitRoot = mkdtempSync(join(tmpdir(), "frontron-pnpm-retrofit-"))
  temporaryDirectories.push(pnpmRetrofitRoot)
  writeJson(join(pnpmRetrofitRoot, "package.json"), {
    name: "pnpm-retrofit-smoke",
    version: "0.0.0",
    private: true,
    packageManager: "pnpm@11.11.0",
    scripts: { dev: "vite", build: "vite build" },
    devDependencies: {
      "create-frontron": `file:${createTarball}`,
      frontron: `file:${frontronTarball}`,
      vite: "^8.0.1",
    },
    pnpm: { overrides: { "create-frontron": `file:${createTarball}` } },
  })
  npx("pnpm@11.11.0", "pnpm", ["install", "--ignore-scripts"], pnpmRetrofitRoot)
  npx(
    "pnpm@11.11.0",
    "pnpm",
    ["exec", "frontron", "init", "--yes", "--adapter", "generic-static", "--out-dir", "dist"],
    pnpmRetrofitRoot
  )
  npx("pnpm@11.11.0", "pnpm", ["exec", "frontron", "doctor"], pnpmRetrofitRoot)
  npx("pnpm@11.11.0", "pnpm", ["exec", "frontron", "clean", "--yes"], pnpmRetrofitRoot)

  const generatedRoot = mkdtempSync(join(tmpdir(), "frontron-package-manager-"))
  temporaryDirectories.push(generatedRoot)
  const createBin = join(createRoot, "index.js")

  run(process.execPath, [createBin, "pnpm-app"], generatedRoot, {
    ...process.env,
    npm_config_user_agent: "pnpm/11.11.0 npm/? node/v24.0.0 linux x64",
  })
  const pnpmApp = join(generatedRoot, "pnpm-app")
  const pnpmConfig = readFileSync(join(pnpmApp, "pnpm-workspace.yaml"), "utf8")
  if (!pnpmConfig.includes("electron-winstaller: true")) {
    throw new Error("pnpm allowBuilds configuration was not generated")
  }
  npx("pnpm@11.11.0", "pnpm", ["install"], pnpmApp)
  npx("pnpm@11.11.0", "pnpm", ["run", "typecheck"], pnpmApp)

  run(process.execPath, [createBin, "yarn-app"], generatedRoot, {
    ...process.env,
    npm_config_user_agent: "yarn/4.9.2 npm/? node/v24.0.0 linux x64",
  })
  const yarnApp = join(generatedRoot, "yarn-app")
  if (readFileSync(join(yarnApp, ".yarnrc.yml"), "utf8").trim() !== "nodeLinker: node-modules") {
    throw new Error("Yarn node-modules linker configuration was not generated")
  }
  npx("@yarnpkg/cli-dist@4.9.2", "yarn", ["install"], yarnApp)
  npx("@yarnpkg/cli-dist@4.9.2", "yarn", ["typecheck"], yarnApp)
  npx("@yarnpkg/cli-dist@4.9.2", "yarn", ["build", "--dir"], yarnApp)

  if (!existsSync(join(yarnApp, "output", "linux-unpacked"))) {
    throw new Error("Yarn-generated app did not produce a packaged directory")
  }

  console.log("[package-manager-smoke] pnpm and Yarn consumers passed")
} finally {
  for (const directory of temporaryDirectories.reverse()) {
    rmSync(directory, { recursive: true, force: true })
  }
}
'''

# Package-manager-aware scaffolding.
replace_once(
    "create-frontron/src/scaffold.ts",
    "export function scaffoldProject(templateDir: string, root: string, packageJson: unknown) {",
    "export function scaffoldProject(\n  templateDir: string,\n  root: string,\n  packageJson: unknown,\n  additionalFiles: ReadonlyMap<string, string> = new Map(),\n) {",
)
replace_once(
    "create-frontron/src/scaffold.ts",
    "    fs.writeFileSync(\n      path.join(root, 'package.json'),\n      `${JSON.stringify(packageJson, null, 2)}\\n`,\n      'utf8',\n    )",
    "    fs.writeFileSync(\n      path.join(root, 'package.json'),\n      `${JSON.stringify(packageJson, null, 2)}\\n`,\n      'utf8',\n    )\n\n    for (const [relativePath, content] of additionalFiles) {\n      const targetPath = path.resolve(root, relativePath)\n      const relativeTarget = path.relative(root, targetPath)\n\n      if (\n        relativeTarget === '..' ||\n        relativeTarget.startsWith(`..${path.sep}`) ||\n        path.isAbsolute(relativeTarget)\n      ) {\n        throw new Error(`Additional scaffold file must stay inside the project: ${relativePath}`)\n      }\n\n      fs.mkdirSync(path.dirname(targetPath), { recursive: true })\n      fs.writeFileSync(targetPath, content, 'utf8')\n    }",
)

replace_once(
    "create-frontron/src/index.ts",
    "function packageManagerFromUserAgent(userAgent: string | undefined) {\n  return userAgent?.split(' ')[0]?.split('/')[0] || 'npm'\n}",
    "type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'\n\nfunction packageManagerFromUserAgent(userAgent: string | undefined): PackageManager {\n  const name = userAgent?.split(' ')[0]?.split('/')[0]\n  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm'\n}\n\nfunction createPackageManagerFiles(packageManager: PackageManager) {\n  if (packageManager === 'pnpm') {\n    return new Map([\n      [\n        'pnpm-workspace.yaml',\n        'allowBuilds:\\n  electron: true\\n  electron-winstaller: true\\n',\n      ],\n    ])\n  }\n\n  if (packageManager === 'yarn') {\n    return new Map([['.yarnrc.yml', 'nodeLinker: node-modules\\n']])\n  }\n\n  return new Map<string, string>()\n}",
)
replace_once(
    "create-frontron/src/index.ts",
    "  console.log(`\\nScaffolding project in ${root}...`)\n  scaffoldProject(templateDir, root, packageJson)\n  printNextSteps(cwd, root, packageManagerFromUserAgent(process.env.npm_config_user_agent))",
    "  const packageManager = packageManagerFromUserAgent(process.env.npm_config_user_agent)\n\n  console.log(`\\nScaffolding project in ${root}...`)\n  scaffoldProject(templateDir, root, packageJson, createPackageManagerFiles(packageManager))\n  printNextSteps(cwd, root, packageManager)",
)

# Canonical static server and native-window lifecycle.
write("create-frontron/template/src/electron/static-server.ts", STATIC_SERVER_SOURCE)
write("create-frontron/template/src/electron/main.ts", MAIN_SOURCE)
write("create-frontron/template/src/electron/window.ts", WINDOW_SOURCE)
write("create-frontron/template/scripts/tasks.mjs", TASKS_SOURCE)
(ROOT / "create-frontron/template/src/electron/tray.ts").unlink()

serve_path = "create-frontron/template/src/electron/serve.ts"
replace_once(
    serve_path,
    'import {\n  createServer,\n  type IncomingMessage,\n  request as httpRequest,\n  type ServerResponse,\n} from "node:http"',
    'import { request as httpRequest } from "node:http"',
)
replace_once(
    serve_path,
    'import { fileURLToPath } from "url"',
    'import { fileURLToPath } from "url"\n\nimport { startStaticRendererServer, stopStaticRendererServer } from "./static-server.js"',
)
regex_once(
    serve_path,
    r'const mimeTypes = new Map<string, string>\(\[.*?\]\)\n\nlet rendererServer: ReturnType<typeof createServer> \| null = null\n',
    '',
)
regex_once(
    serve_path,
    r'function sendResponse\(.*?\n\}\n\nexport async function waitForUrlReady',
    'export async function waitForUrlReady',
)
regex_once(
    serve_path,
    r'export async function startRendererServer\(\) \{.*?\n\}\n\nexport async function stopRendererServer\(\) \{.*?\n\}\n\nif \(process\.argv',
    'export async function startRendererServer() {\n  return startStaticRendererServer(path.resolve(runtimeDir, "../../dist"))\n}\n\nexport async function stopRendererServer() {\n  await stopStaticRendererServer()\n}\n\nif (process.argv',
)

# CSP and generated metadata.
replace_once(
    "create-frontron/template/index.html",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
)
package_source = read("create-frontron/template/package.json")
package_source = package_source.replace('  "author": "Template Maintainers",\n', '')
package_source = package_source.replace('    "lint"      : "node scripts/tasks.mjs lint"\n', '    "lint"         : "node scripts/tasks.mjs lint",\n    "format"       : "node scripts/tasks.mjs format",\n    "format:check" : "node scripts/tasks.mjs format:check"\n')
package_source = package_source.replace('    "copyright": "Copyright (c) Template Maintainers",\n', '')
write("create-frontron/template/package.json", package_source)

# Secure IPC main-frame validation.
replace_once(
    "create-frontron/template/src/electron/ipc.ts",
    "  if (event.sender !== window.webContents) {\n    throw new Error(\"Rejected IPC request from an untrusted renderer.\")\n  }",
    "  if (\n    event.sender !== window.webContents ||\n    event.senderFrame !== window.webContents.mainFrame\n  ) {\n    throw new Error(\"Rejected IPC request from an untrusted renderer.\")\n  }",
)

# Retrofit now consumes the canonical static server and accepts pnpm hard links.
template_loader = "frontron/src/init/runtime/create-frontron-template.ts"
replace_once(template_loader, "  'src/electron/tray.ts',", "  'src/electron/static-server.ts',")
replace_once(
    template_loader,
    "// inspectSafeRegularFile 함수는 링크를 따라가지 않고 단일 링크 일반 파일인지 검사한다.",
    "// inspectSafeRegularFile 함수는 링크를 따라가지 않고 일반 파일인지 검사한다.",
)
regex_once(
    template_loader,
    r'\n  if \(stats\.nlink !== 1\) \{\n    return `must have exactly one hard link; found \$\{stats\.nlink\}`\n  \}\n',
    '\n',
)
regex_once(
    template_loader,
    r'\n    if \(stats\.nlink !== 1\) \{\n      throw new Error\(\n        `Invalid create-frontron template tree entry at \$\{absolutePath\}: regular files must have exactly one hard link; found \$\{stats\.nlink\}\.`,\n      \)\n    \}\n',
    '\n',
)

header_path = "frontron/src/init/runtime/serve-source/header-config-source.ts"
regex_once(
    header_path,
    r"  const staticFileSystemImport = usesNodeServer.*?  const nodeServerState =",
    "  const staticServerImport = usesNodeServer\n    ? ''\n    : `\\nimport { startStaticRendererServer, stopStaticRendererServer } from './static-server.js'`\n  const httpImports = usesNodeServer\n    ? 'createServer, request as httpRequest'\n    : 'request as httpRequest'\n  const nodeServerState =",
)
replace_once(
    header_path,
    "import { ${fileSystemImports.join(', ')} } from 'node:fs'${staticFileSystemImport}\nimport { createServer, request as httpRequest${staticHttpTypes} } from 'node:http'",
    "import { ${fileSystemImports.join(', ')} } from 'node:fs'\nimport { ${httpImports} } from 'node:http'${staticServerImport}",
)
replace_once(header_path, "${staticServerState}${nodeServerState}", "${nodeServerState}")

write(
    "frontron/src/init/runtime/serve-source/static-server-source.ts",
    """// renderStaticServerSource 함수는 canonical static server를 generated serve.ts에 연결한다.\nexport function renderStaticServerSource() {\n  return `// startRendererRuntime 함수는 정적 렌더러 서버를 시작하고 접속 URL을 반환한다.\nexport async function startRendererRuntime() {\n  return startStaticRendererServer(getRendererRuntimeRootDir())\n}\n\n// stopRendererRuntime 함수는 실행 중인 정적 렌더러 서버를 종료한다.\nexport async function stopRendererRuntime() {\n  await stopStaticRendererServer()\n}`\n}\n""",
)

# CLI-only public package surface.
frontron_package = read("frontron/package.json")
frontron_package = frontron_package.replace('  "main": "./dist/cli.mjs",\n  "types": "./dist/cli.d.ts",\n', '')
frontron_package = re.sub(
    r'  "exports": \{\n    "\.": \{\n      "types": "\./dist/cli\.d\.ts",\n      "import": "\./dist/cli\.mjs"\n    \},\n    "\./package\.json": "\./package\.json"\n  \},',
    '  "exports": {\n    "./package.json": "./package.json"\n  },',
    frontron_package,
)
write("frontron/package.json", frontron_package)

# Full source audit after lock refresh.
replace_once(
    "release.mjs",
    "runNpm(['audit', '--omit=dev', '--audit-level=moderate'], spec.root)",
    "runNpm(['audit', '--audit-level=moderate'], spec.root)",
)

# Tests: package-manager files, canonical server, CLI-only package, and runtime probe.
replace_once(
    "create-frontron/__tests__/scaffold.spec.ts",
    "  scaffoldProject(templateRoot, targetRoot, { name: 'app' })",
    "  scaffoldProject(\n    templateRoot,\n    targetRoot,\n    { name: 'app' },\n    new Map([['.yarnrc.yml', 'nodeLinker: node-modules\\n']]),\n  )",
)
replace_once(
    "create-frontron/__tests__/scaffold.spec.ts",
    "  expect(JSON.parse(readFileSync(join(targetRoot, 'package.json'), 'utf8')).name).toBe('app')",
    "  expect(JSON.parse(readFileSync(join(targetRoot, 'package.json'), 'utf8')).name).toBe('app')\n  expect(readFileSync(join(targetRoot, '.yarnrc.yml'), 'utf8')).toBe(\n    'nodeLinker: node-modules\\n',\n  )",
)

replace_once(
    "create-frontron/__tests__/cli.spec.ts",
    "  expect(console.log).toHaveBeenCalledWith('  yarn')\n  expect(console.log).toHaveBeenCalledWith('  yarn app')",
    "  expect(console.log).toHaveBeenCalledWith('  yarn')\n  expect(console.log).toHaveBeenCalledWith('  yarn app')\n  expect(readFileSync(join(workspace, 'app', '.yarnrc.yml'), 'utf8')).toBe(\n    'nodeLinker: node-modules\\n',\n  )",
)
write(
    "create-frontron/__tests__/cli.spec.ts",
    read("create-frontron/__tests__/cli.spec.ts")
    + """\n\ntest('writes pnpm Electron build approvals only for pnpm consumers', async () => {\n  const workspace = createWorkspace('pnpm-config')\n  process.chdir(workspace)\n  process.env.npm_config_user_agent = 'pnpm/11.11.0 npm/? node/v24.0.0 linux x64'\n\n  await runCreateFrontron(['app'])\n\n  expect(readFileSync(join(workspace, 'app', 'pnpm-workspace.yaml'), 'utf8')).toBe(\n    'allowBuilds:\\n  electron: true\\n  electron-winstaller: true\\n',\n  )\n  expect(existsSync(join(workspace, 'app', '.yarnrc.yml'))).toBe(false)\n})\n""",
)

replace_once(
    "create-frontron/__tests__/template-smoke.spec.ts",
    "    lint: 'node scripts/tasks.mjs lint',\n    typecheck: 'node scripts/tasks.mjs typecheck',",
    "    lint: 'node scripts/tasks.mjs lint',\n    format: 'node scripts/tasks.mjs format',\n    'format:check': 'node scripts/tasks.mjs format:check',\n    typecheck: 'node scripts/tasks.mjs typecheck',",
)
replace_once(
    "create-frontron/__tests__/template-smoke.spec.ts",
    "  expect(electronMain).toContain('ensureRendererCsp(responseHeaders)')",
    "  expect(electronMain).toContain('ensureRendererCsp(responseHeaders)')\n  expect(electronMain).toContain('createWindow(rendererUrl, setupIpcHandlers)')",
)
replace_once(
    "create-frontron/__tests__/template-smoke.spec.ts",
    "  expect(electronIpc).toContain('assertTrustedSender')",
    "  expect(electronIpc).toContain('assertTrustedSender')\n  expect(electronIpc).toContain('event.senderFrame !== window.webContents.mainFrame')",
)
replace_once(
    "create-frontron/__tests__/template-smoke.spec.ts",
    "  expect(existsSync(join(projectRoot, 'src/types/electron.d.ts'))).toBe(true)",
    "  expect(existsSync(join(projectRoot, 'src/electron/static-server.ts'))).toBe(true)\n  expect(existsSync(join(projectRoot, 'src/electron/tray.ts'))).toBe(false)\n  expect(existsSync(join(projectRoot, 'src/types/electron.d.ts'))).toBe(true)",
)

replace_once(
    "create-frontron/__tests__/package-smoke.spec.ts",
    "    expect(packedFiles.has('template/src/electron/window.ts')).toBe(true)",
    "    expect(packedFiles.has('template/src/electron/window.ts')).toBe(true)\n    expect(packedFiles.has('template/src/electron/static-server.ts')).toBe(true)\n    expect(packedFiles.has('template/src/electron/tray.ts')).toBe(false)",
)

release_test = read("create-frontron/__tests__/release-rehearsal.spec.ts")
release_test = release_test.replace(
    "import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'",
    "import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'",
)
replace_once(
    "create-frontron/__tests__/release-rehearsal.spec.ts",
    "  expect(generatedPackage.build?.icon).toBe('public/logo.svg')",
    "  expect(generatedPackage.build?.icon).toBe('public/logo.svg')\n  expect(generatedPackage).not.toHaveProperty('author')",
)
replace_once(
    "create-frontron/__tests__/release-rehearsal.spec.ts",
    "  runNpm(['run', 'build', '--', '--dir'], generatedAppRoot)\n}, 600000)",
    "  runNpm(['run', 'build', '--', '--dir'], generatedAppRoot)\n\n  if (process.env.FRONTRON_TEST_ELECTRON_RUNTIME === '1') {\n    const executablePath = join(\n      generatedAppRoot,\n      'output',\n      'linux-unpacked',\n      generatedAppName,\n    )\n    const probePath = join(rehearsalRoot, 'renderer-probe.json')\n    const result = spawnSync(\n      'xvfb-run',\n      ['-a', executablePath, '--no-sandbox'],\n      {\n        cwd: generatedAppRoot,\n        encoding: 'utf8',\n        timeout: 60_000,\n        env: {\n          ...process.env,\n          FRONTRON_RENDERER_PROBE_PATH: probePath,\n        },\n      },\n    )\n\n    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0)\n    const probe = JSON.parse(readFileSync(probePath, 'utf8')) as {\n      ok: boolean\n      protocol: string\n      bridgeType: string\n      appInfo: { name: string; version: string } | null\n    }\n    expect(probe).toMatchObject({\n      ok: true,\n      protocol: 'frontron:',\n      bridgeType: 'object',\n    })\n    expect(probe.appInfo?.name).toBeTruthy()\n  }\n}, 600000)",
)

# Generated runtime tests load the canonical static-server sibling.
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "import { renderServeSource } from '../src/init/runtime/serve-source'",
    "import { renderCreateFrontronElectronFile } from '../src/init/runtime/create-frontron-template'\nimport { renderServeSource } from '../src/init/runtime/serve-source'",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "  const servePath = join(distElectronDir, 'serve.js')\n  writeFileSync(servePath, transpiled.outputText, 'utf8')",
    "  const servePath = join(distElectronDir, 'serve.js')\n  const staticServerSource = ts.transpileModule(\n    renderCreateFrontronElectronFile('static-server.ts'),\n    {\n      compilerOptions: {\n        module: ts.ModuleKind.ESNext,\n        target: ts.ScriptTarget.ES2022,\n      },\n      fileName: 'static-server.ts',\n    },\n  ).outputText\n  writeFileSync(join(distElectronDir, 'static-server.js'), staticServerSource, 'utf8')\n  writeFileSync(servePath, transpiled.outputText, 'utf8')",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "    expect(source).toContain('function startStaticServer')",
    "    expect(source).toContain('startStaticRendererServer')",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "    expect(source).not.toContain('function startStaticServer')\n    expect(source).not.toContain('function parseByteRange')",
    "    expect(source).not.toContain('startStaticRendererServer')\n    expect(source).not.toContain('static-server.js')",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "    expect(source).not.toContain('function startStaticServer')\n    expect(source).not.toContain(\"ADAPTER === 'remix-node-server'\")",
    "    expect(source).not.toContain('startStaticRendererServer')\n    expect(source).not.toContain(\"ADAPTER === 'remix-node-server'\")",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "  writeFileSync(join(distWebDir, 'asset.txt'), '0123456789', 'utf8')",
    "  writeFileSync(join(distWebDir, 'asset.txt'), '0123456789', 'utf8')\n  writeFileSync(join(distWebDir, 'module.wasm'), 'wasm', 'utf8')",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "    const invalidRangeResponse = await requestRuntime(rendererUrl, '/asset.txt', {\n      headers: { Range: 'bytes=20-30' },\n    })",
    "    const invalidRangeResponse = await requestRuntime(rendererUrl, '/asset.txt', {\n      headers: { Range: 'bytes=20-30' },\n    })\n    const wasmResponse = await requestRuntime(rendererUrl, '/module.wasm')",
)
replace_once(
    "frontron/__tests__/runtime-serve.spec.ts",
    "    expect(invalidRangeResponse.headers['content-range']).toBe('bytes */10')",
    "    expect(invalidRangeResponse.headers['content-range']).toBe('bytes */10')\n    expect(wasmResponse.headers['content-type']).toBe('application/wasm')",
)

RUNTIME_CONTRACT_TEST = r'''import { join } from 'node:path'

import * as ts from 'typescript'
import { describe, expect, test } from 'vitest'

import { renderCreateFrontronElectronFile } from '../src/init/runtime/create-frontron-template'
import { renderServeSource } from '../src/init/runtime/serve-source'
import type { InitConfig } from '../src/init/shared'

type Variant = Pick<
  InitConfig,
  | 'adapter'
  | 'runtimeStrategy'
  | 'outDir'
  | 'nodeServerSourceRoot'
  | 'nodeServerSourceEntry'
  | 'nodeServerEntry'
  | 'nodeServerCopyTargets'
>

const variants: Array<{ name: string; config: Variant }> = [
  {
    name: 'static export',
    config: {
      adapter: 'generic-static',
      runtimeStrategy: 'static-export',
      outDir: 'dist-web',
      nodeServerSourceRoot: null,
      nodeServerSourceEntry: null,
      nodeServerEntry: null,
      nodeServerCopyTargets: [],
    },
  },
  {
    name: 'generic node server',
    config: {
      adapter: 'generic-node-server',
      runtimeStrategy: 'node-server',
      outDir: '.frontron/runtime/node-server',
      nodeServerSourceRoot: 'build',
      nodeServerSourceEntry: null,
      nodeServerEntry: 'server/index.js',
      nodeServerCopyTargets: [{ from: 'public', to: 'public' }],
    },
  },
  {
    name: 'Remix node server',
    config: {
      adapter: 'remix-node-server',
      runtimeStrategy: 'node-server',
      outDir: '.frontron/runtime/remix-node-server',
      nodeServerSourceRoot: 'build',
      nodeServerSourceEntry: 'server/index.js',
      nodeServerEntry: 'server.cjs',
      nodeServerCopyTargets: [],
    },
  },
]

function createConfig(variant: Variant): InitConfig {
  return {
    cwd: process.cwd(),
    packageJson: { name: 'runtime-contract-test' },
    packageManager: 'npm',
    adapter: variant.adapter,
    adapterConfidence: 'high',
    adapterReasons: [],
    runtimeStrategy: variant.runtimeStrategy,
    desktopDir: 'electron',
    appScript: 'frontron:dev',
    buildScript: 'frontron:build',
    webDevScript: 'dev',
    webBuildScript: 'build',
    webBuildCommand: 'npm run build',
    outDir: variant.outDir,
    nodeServerSourceRoot: variant.nodeServerSourceRoot,
    nodeServerSourceEntry: variant.nodeServerSourceEntry,
    nodeServerEntry: variant.nodeServerEntry,
    nodeServerCopyTargets: variant.nodeServerCopyTargets,
    productName: 'Runtime Contract Test',
    appId: 'com.local.runtime-contract-test',
    templateInfo: {
      source: 'create-frontron',
      packageName: 'create-frontron',
      packageVersion: '0.0.0-test',
      resolvedFrom: 'repo',
    },
    allowExtraMetadataMainOverride: false,
  }
}

function normalizePath(fileName: string) {
  const normalized = fileName.replaceAll('\\', '/')
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase()
}

function diagnosticsFor(source: string, includeStaticServer: boolean) {
  const virtualRoot = join(process.cwd(), '.frontron-contract', 'electron')
  const virtualFiles = new Map<string, string>([
    [join(virtualRoot, 'serve.ts'), source],
  ])
  if (includeStaticServer) {
    virtualFiles.set(
      join(virtualRoot, 'static-server.ts'),
      renderCreateFrontronElectronFile('static-server.ts'),
    )
  }
  const normalizedFiles = new Map(
    [...virtualFiles].map(([fileName, content]) => [normalizePath(fileName), content]),
  )
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
    types: ['node'],
    typeRoots: [join(process.cwd(), 'node_modules', '@types')],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
  }
  const host = ts.createCompilerHost(compilerOptions)
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  const virtualContent = (fileName: string) => normalizedFiles.get(normalizePath(fileName))

  host.fileExists = (fileName) => virtualContent(fileName) !== undefined || fileExists(fileName)
  host.readFile = (fileName) => virtualContent(fileName) ?? readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = virtualContent(fileName)
    return content !== undefined
      ? ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }

  return ts.getPreEmitDiagnostics(
    ts.createProgram([...virtualFiles.keys()], compilerOptions, host),
  )
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  })
}

describe('generated serve runtime contract', () => {
  test.each(variants)('$name passes strict semantic type-checking', ({ config }) => {
    const source = renderServeSource(createConfig(config))
    const usesStaticServer = config.runtimeStrategy === 'static-export'

    expect(formatDiagnostics(diagnosticsFor(source, usesStaticServer))).toBe('')
    expect(source).toContain('waitForUrlReady')

    if (usesStaticServer) {
      expect(source).toContain('startStaticRendererServer')
      expect(source).not.toContain('startNodeServerRuntime')
    } else {
      expect(source).toContain('startNodeServerRuntime')
      expect(source).toContain('getAvailablePort')
      expect(source).not.toContain('static-server.js')
    }
  })
})
'''
write("frontron/__tests__/runtime-serve-contract.spec.ts", RUNTIME_CONTRACT_TEST)

# Package smoke verifies that the root import is intentionally unavailable.
package_smoke = read("frontron/__tests__/package-smoke.spec.ts")
package_smoke = package_smoke.replace(
    "    main?: string\n    types?: string\n    dependencies?: Record<string, string>",
    "    main?: string\n    types?: string\n    exports?: Record<string, unknown>\n    dependencies?: Record<string, string>",
)
package_smoke = package_smoke.replace(
    "  expect(packageJson.main).toBe('./dist/cli.mjs')\n  expect(packageJson.types).toBe('./dist/cli.d.ts')",
    "  expect(packageJson.main).toBeUndefined()\n  expect(packageJson.types).toBeUndefined()\n  expect(packageJson.exports).toEqual({ './package.json': './package.json' })",
)
regex_once(
    "frontron/__tests__/package-smoke.spec.ts",
    r"\n    const importResult = runNode\(.*?expect\(importResult\)\.toBe\('function'\)\n",
    "\n    const importResult = spawnSync(\n      process.execPath,\n      ['--input-type=module', '--eval', \"await import('frontron')\"],\n      { cwd: appRoot, encoding: 'utf8' },\n    )\n    expect(importResult.status).not.toBe(0)\n",
)
package_smoke = read("frontron/__tests__/package-smoke.spec.ts")
package_smoke = package_smoke.replace(
    "    expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)",
    "    expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)\n    expect(existsSync(join(appRoot, 'electron', 'static-server.ts'))).toBe(true)\n    expect(existsSync(join(appRoot, 'electron', 'tray.ts'))).toBe(false)",
)
write("frontron/__tests__/package-smoke.spec.ts", package_smoke)

# Security test records IPC-before-load and the tightened fallback CSP.
security_test = read("frontron/__tests__/runtime-security.spec.ts")
security_test = security_test.replace(
    "  loadedUrls: string[]\n}",
    "  loadedUrls: string[]\n  lifecycle: string[]\n}",
)
security_test = security_test.replace(
    "  loadURL(url) {\n    state.loadedUrls.push(url)",
    "  loadURL(url) {\n    state.lifecycle.push('load')\n    state.loadedUrls.push(url)",
)
security_test = security_test.replace(
    "    loadedUrls: [],\n  }",
    "    loadedUrls: [],\n    lifecycle: [],\n  }",
)
security_test = security_test.replace(
    "  createWindow?: (rendererUrl: string) => unknown",
    "  createWindow?: (rendererUrl: string, beforeLoad?: () => void) => unknown",
)
security_test = security_test.replace(
    "    expect(fallbackCspResponse.headers.get('content-security-policy')).toContain(\n      \"default-src 'self'\",\n    )",
    "    expect(fallbackCspResponse.headers.get('content-security-policy')).toContain(\n      \"default-src 'self'\",\n    )\n    expect(fallbackCspResponse.headers.get('content-security-policy')).not.toContain(\n      \"script-src 'self' 'unsafe-inline'\",\n    )",
)
security_test = security_test.replace(
    "    createWindow!('frontron://app/')",
    "    createWindow!('frontron://app/', () => state.lifecycle.push('ipc'))\n    expect(state.lifecycle.slice(0, 2)).toEqual(['ipc', 'load'])",
)
write("frontron/__tests__/runtime-security.spec.ts", security_test)

# Documentation follows the actual generated files and package-manager contract.
root_readme = read("README.md")
root_readme = root_readme.replace(
    "Use `npm run build` to build and package the desktop app.",
    "Use `npm run build` to build and package the desktop app. The generator writes the pnpm Electron build approvals or Yarn node-modules linker setting when invoked through that package manager.",
)
write("README.md", root_readme)

create_readme = read("create-frontron/README.md")
create_readme = create_readme.replace(
    "Equivalent commands work with pnpm, Yarn, and Bun.",
    "Equivalent commands work with pnpm, Yarn, and Bun. pnpm projects receive the Electron `allowBuilds` entries, and Yarn projects receive `nodeLinker: node-modules` because the generated task runner uses normal package binaries.",
)
create_readme = create_readme.replace(
    "npm run lint\nnpm run build",
    "npm run lint\nnpm run format\nnpm run format:check\nnpm run build",
)
create_readme = create_readme.replace("    tray.ts\n", "    static-server.ts\n")
write("create-frontron/README.md", create_readme)

template_readme = read("create-frontron/template/README.md")
template_readme = template_readme.replace(
    "npm run lint\nnpm run build",
    "npm run lint         # check JavaScript and TypeScript\nnpm run format       # apply formatting\nnpm run format:check # verify formatting\nnpm run build",
)
template_readme += "\nThe static renderer server supports SPA fallback, byte ranges, common web media types, and confinement against traversal or escaping symlinks.\n"
write("create-frontron/template/README.md", template_readme)

frontron_readme = read("frontron/README.md")
frontron_readme = frontron_readme.replace("  tray.ts\n", "  static-server.ts\n")
frontron_readme = frontron_readme.replace(
    "npm, pnpm, Yarn, and Bun are supported.",
    "npm, pnpm, Yarn, and Bun are supported. Installed pnpm packages may use their normal content-addressed hard links; Frontron treats those read-only package files as valid templates.",
)
write("frontron/README.md", frontron_readme)

write("scripts/package-manager-smoke.mjs", PACKAGE_MANAGER_SMOKE)

# CI executes one real Electron process and focused package-manager consumers.
ci = read(".github/workflows/frontron-ci.yml")
ci = ci.replace(
    "      - name: Verify repository and packed artifacts\n        run: node release.mjs verify",
    "      - name: Install headless Electron runtime\n        run: |\n          sudo apt-get update\n          sudo apt-get install --yes xvfb\n\n      - name: Refresh audit-fixable lockfile entries\n        run: |\n          npm --prefix create-frontron audit fix --package-lock-only --ignore-scripts\n          npm --prefix frontron audit fix --package-lock-only --ignore-scripts\n\n      - name: Verify repository and packed artifacts\n        run: node release.mjs verify\n        env:\n          FRONTRON_TEST_ELECTRON_RUNTIME: \"1\"\n\n      - name: Verify pnpm and Yarn consumers\n        run: node scripts/package-manager-smoke.mjs",
)
write(".github/workflows/frontron-ci.yml", ci)

release_workflow = read(".github/workflows/frontron-release.yml")
release_workflow = release_workflow.replace(
    "      - name: Verify and publish both packages\n        run: node release.mjs publish",
    "      - name: Install headless Electron runtime\n        run: |\n          sudo apt-get update\n          sudo apt-get install --yes xvfb\n\n      - name: Verify and publish both packages\n        run: node release.mjs publish",
)
release_workflow = release_workflow.replace(
    "          FRONTRON_TRUSTED_PUBLISHING: \"1\"",
    "          FRONTRON_TRUSTED_PUBLISHING: \"1\"\n          FRONTRON_TEST_ELECTRON_RUNTIME: \"1\"",
)
write(".github/workflows/frontron-release.yml", release_workflow)

# Temporary automation removes itself before the resulting commit.
(ROOT / ".github/temporary-frontron-hardening.py").unlink()
(ROOT / ".github/workflows/temporary-frontron-hardening.yml").unlink()
