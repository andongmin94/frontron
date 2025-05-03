// renderStaticServerSource 함수는 생성되는 serve.ts의 안전한 정적 파일 HTTP 서버를 만든다.
export function renderStaticServerSource() {
  return `const forbiddenStaticPath = Symbol('forbidden-static-path')
const invalidByteRange = Symbol('invalid-byte-range')

// isFileSystemError 함수는 오류 객체에서 Node 파일 시스템 오류 코드를 읽을 수 있는지 확인한다.
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

// sendResponse 함수는 정적 서버 HTTP 응답을 상태 코드와 본문으로 마무리한다.
function sendResponse(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  headers: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

// getContentType 함수는 파일 확장자에 맞는 HTTP Content-Type을 돌려준다.
function getContentType(filePath: string) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

// isPathInside 함수는 후보 경로가 지정한 루트 안에 있는지 확인한다.
function isPathInside(rootPath: string, candidatePath: string) {
  const relativePath = path.relative(rootPath, candidatePath)

  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(\`..\${path.sep}\`))
  )
}

// decodeRequestPath 함수는 query를 제외한 원본 요청 경로를 한 번만 디코딩한다.
function decodeRequestPath(requestUrl: string) {
  const queryIndex = requestUrl.indexOf('?')
  const rawPath = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex)

  if (!rawPath.startsWith('/')) {
    throw new Error('Static requests must use an origin-form path.')
  }

  return decodeURIComponent(rawPath)
}

// resolveRequestPath 함수는 traversal과 루트 밖 symlink를 차단하며 실제 정적 파일을 찾는다.
async function resolveRequestPath(distPath: string, requestPath: string) {
  if (
    !requestPath.startsWith('/') ||
    requestPath.includes('\\0') ||
    requestPath.includes('\\\\') ||
    requestPath.split('/').some((segment) => segment === '..')
  ) {
    return forbiddenStaticPath
  }

  const normalizedPath = path.posix.normalize(requestPath)
  const relativePath =
    normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\\/+/, '')
  const resolvedPath = path.resolve(distPath, relativePath)

  if (!isPathInside(distPath, resolvedPath)) {
    return forbiddenStaticPath
  }

  let realPath: string

  try {
    realPath = await realpath(resolvedPath)
  } catch (error) {
    if (isFileSystemError(error)) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
      if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'ELOOP') {
        return forbiddenStaticPath
      }
    }

    throw error
  }

  if (!isPathInside(distPath, realPath)) {
    return forbiddenStaticPath
  }

  try {
    return (await stat(realPath)).isFile() ? realPath : null
  } catch (error) {
    if (
      isFileSystemError(error) &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null
    }

    throw error
  }
}

// parseByteRange 함수는 단일 HTTP bytes range를 파일 시작·끝 위치로 바꾼다.
function parseByteRange(rangeHeader: string | undefined, fileSize: number) {
  if (!rangeHeader) return null

  const match = /^bytes=(\\d*)-(\\d*)$/.exec(rangeHeader.trim())

  if (!match || (!match[1] && !match[2]) || fileSize === 0) {
    return invalidByteRange
  }

  if (!match[1]) {
    const suffixLength = Number(match[2])

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return invalidByteRange
    }

    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    }
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

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  }
}

// sendFileError 함수는 파일 열기·스트림 오류를 안전한 HTTP 응답으로 바꾼다.
function sendFileError(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  error: unknown,
) {
  if (response.destroyed) return

  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined)
    return
  }

  if (isFileSystemError(error)) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
      sendResponse(request, response, 404, 'Not Found')
      return
    }

    if (error.code === 'EACCES' || error.code === 'EPERM') {
      sendResponse(request, response, 403, 'Forbidden')
      return
    }
  }

  console.error('[frontron:init] Failed to serve a renderer file.', error)
  sendResponse(request, response, 500, 'Internal Server Error')
}

// serveFile 함수는 HEAD와 byte range를 포함해 정적 파일을 스트리밍한다.
async function serveFile(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  filePath: string,
) {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  let fileSize: number

  try {
    fileHandle = await open(filePath, 'r')
    const fileStats = await fileHandle.stat()

    if (!fileStats.isFile()) {
      await fileHandle.close()
      sendResponse(request, response, 404, 'Not Found')
      return
    }

    fileSize = fileStats.size
  } catch (error) {
    await fileHandle?.close().catch(() => {})
    sendFileError(request, response, error)
    return
  }

  if (!fileHandle) return

  const byteRange = parseByteRange(request.headers.range, fileSize)

  if (byteRange === invalidByteRange) {
    await fileHandle.close().catch(() => {})
    sendResponse(request, response, 416, 'Range Not Satisfiable', undefined, {
      'Accept-Ranges': 'bytes',
      'Content-Range': \`bytes */\${fileSize}\`,
    })
    return
  }

  const statusCode = byteRange ? 206 : 200
  const contentLength = byteRange ? byteRange.end - byteRange.start + 1 : fileSize
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(contentLength),
    'Content-Type': getContentType(filePath),
  }

  if (byteRange) {
    headers['Content-Range'] = \`bytes \${byteRange.start}-\${byteRange.end}/\${fileSize}\`
  }

  if (request.method === 'HEAD') {
    try {
      await fileHandle.close()
      response.writeHead(statusCode, headers)
      response.end()
    } catch (error) {
      sendFileError(request, response, error)
    }
    return
  }

  try {
    const stream = fileHandle.createReadStream(
      byteRange ? { start: byteRange.start, end: byteRange.end } : {},
    )

    stream.once('error', (error) => {
      sendFileError(request, response, error)
    })
    response.once('close', () => {
      if (!response.writableEnded) stream.destroy()
    })

    response.writeHead(statusCode, headers)
    stream.pipe(response)
  } catch (error) {
    await fileHandle.close().catch(() => {})
    sendFileError(request, response, error)
  }
}

// handleRendererRequest 함수는 정적 렌더러 서버의 HTTP 요청을 파일 응답으로 처리한다.
async function handleRendererRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  distPath: string,
  indexPath: string,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendResponse(request, response, 405, 'Method Not Allowed', undefined, {
      Allow: 'GET, HEAD',
    })
    return
  }

  let pathname: string

  try {
    pathname = decodeRequestPath(request.url ?? '/')
  } catch {
    sendResponse(request, response, 400, 'Bad Request')
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
    sendResponse(request, response, 403, 'Forbidden')
    return
  }

  if (resolvedPath) {
    await serveFile(request, response, resolvedPath)
    return
  }

  if (path.extname(pathname)) {
    sendResponse(request, response, 404, 'Not Found')
    return
  }

  await serveFile(request, response, indexPath)
}

// startStaticServer 함수는 정적 빌드 결과물을 제공하는 로컬 HTTP 서버를 시작한다.
async function startStaticServer() {
  if (rendererServer) {
    const address = rendererServer.address()
    const port = typeof address === 'object' && address !== null ? address.port : null

    if (typeof port === 'number' && port > 0) {
      return \`http://\${LOOPBACK_HOST}:\${port}\`
    }
  }

  const configuredDistPath = getRendererRuntimeRootDir()
  const configuredIndexPath = path.join(configuredDistPath, 'index.html')

  if (!existsSync(configuredIndexPath)) {
    throw new Error(
      \`Renderer entry not found at \${configuredIndexPath}. Run the frontend build first.\`,
    )
  }

  const distPath = await realpath(configuredDistPath)
  const indexPath = await resolveRequestPath(distPath, '/')

  if (typeof indexPath !== 'string') {
    throw new Error(\`Renderer entry at \${configuredIndexPath} is not a safe regular file.\`)
  }

  rendererServer = createServer((request, response) => {
    void handleRendererRequest(request, response, distPath, indexPath).catch((error) => {
      sendFileError(request, response, error)
    })
  })

  return new Promise<string>((resolve, reject) => {
    const server = rendererServer

    if (!server) {
      reject(new Error('Renderer server failed to initialize.'))
      return
    }

    // handleError 함수는 시작에 실패한 서버 상태를 비우고 호출자에게 오류를 전달한다.
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

// stopStaticServer 함수는 정적 렌더러 HTTP 서버를 종료한다.
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
}`
}
