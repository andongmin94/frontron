import { open, realpath, stat } from "node:fs/promises"
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
    const forceCloseTimer = setTimeout(() => {
      server.closeAllConnections()
    }, 2_000)

    server.closeIdleConnections()
    server.close((error) => {
      clearTimeout(forceCloseTimer)
      if (error) reject(error)
      else resolve()
    })
  })
}
