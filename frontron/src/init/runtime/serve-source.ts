import type { InitConfig } from '../shared'
import { resolveDevServerUrl } from './dev-server-url'
import { renderServeDevAndBuildSource } from './serve-source/dev-build-source'

// embedJson 함수는 생성 소스 안에 안전하게 넣을 JSON 문자열을 만든다.
function embedJson(value: unknown) {
  return JSON.stringify(JSON.stringify(value))
}

// renderServeSource 함수는 Electron 렌더러 런타임을 준비하고 실행하는 serve.ts 소스를 만든다.
export function renderServeSource(config: InitConfig) {
  const devUrl = resolveDevServerUrl(config)

  // This template becomes the user's generated electron/serve.ts file. Keep the
  // generated runtime self-contained so retrofit projects do not import frontron.
  return `import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PACKAGE_MANAGER = readEmbeddedJson<'npm' | 'pnpm' | 'yarn' | 'bun'>(${embedJson(config.packageManager)})
const ADAPTER = readEmbeddedJson<string>(${embedJson(config.adapter)})
const RUNTIME_STRATEGY = readEmbeddedJson<'static-export' | 'node-server'>(${embedJson(config.runtimeStrategy)})
const WEB_DEV_SCRIPT = readEmbeddedJson<string>(${embedJson(config.webDevScript)})
const WEB_OUT_DIR = readEmbeddedJson<string>(${embedJson(config.outDir)})
const NODE_SERVER_SOURCE_ROOT = readEmbeddedJson<string | null>(${embedJson(config.nodeServerSourceRoot)})
const NODE_SERVER_ENTRY = readEmbeddedJson<string | null>(${embedJson(config.nodeServerEntry)})
const NODE_SERVER_COPY_TARGETS = readEmbeddedJson<Array<{ from: string; to: string }>>(${embedJson(config.nodeServerCopyTargets)})
const DEV_URL = readEmbeddedJson<string>(${embedJson(devUrl)})
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

// readEmbeddedJson 함수는 생성된 serve.ts에 박힌 JSON 상수 값을 읽는다.
function readEmbeddedJson<T>(value: string) {
  return JSON.parse(value) as T
}

// getPackageManagerCommand 함수는 현재 프로젝트에서 사용할 패키지 매니저 실행 명령을 고른다.
function getPackageManagerCommand() {
  if (process.platform !== 'win32') return PACKAGE_MANAGER
  if (PACKAGE_MANAGER === 'npm') return 'npm.cmd'
  if (PACKAGE_MANAGER === 'pnpm') return 'pnpm.cmd'
  if (PACKAGE_MANAGER === 'yarn') return 'yarn.cmd'
  if (PACKAGE_MANAGER === 'bun') return 'bun.cmd'
  return PACKAGE_MANAGER
}

// getRunnerCommand 함수는 script 실행에 사용할 러너 명령을 고른다.
function getRunnerCommand() {
  return process.platform === 'win32'
    ? process.env.ComSpec ?? 'cmd.exe'
    : getPackageManagerCommand()
}

// getRunnerArgs 함수는 패키지 매니저별 script 실행 인자 목록을 만든다.
function getRunnerArgs(scriptName: string) {
  const args = PACKAGE_MANAGER === 'yarn' ? [scriptName] : ['run', scriptName]

  return process.platform === 'win32'
    ? ['/d', '/s', '/c', getPackageManagerCommand(), ...args]
    : args
}

// getElectronExecutablePath 함수는 설치된 Electron 실행 파일 경로를 찾는다.
function getElectronExecutablePath() {
  const require = createRequire(import.meta.url)
  return require('electron') as unknown as string
}

// ensureRuntimePackage 함수는 dist-electron 런타임 폴더에 ESM package.json을 보장한다.
function ensureRuntimePackage() {
  writeFileSync(RUNTIME_PACKAGE_PATH, JSON.stringify({ type: 'module' }, null, 2))
}

// getPackagedRootDir 함수는 패키징된 앱에서 리소스 루트 경로를 계산한다.
function getPackagedRootDir() {
  const appAsarSegment = \`\${path.sep}app.asar\`

  return ROOT_DIR.includes(appAsarSegment)
    ? ROOT_DIR.replace(appAsarSegment, \`\${path.sep}app.asar.unpacked\`)
    : ROOT_DIR
}

// getRendererRuntimeRootDir 함수는 렌더러 런타임 파일을 찾을 기준 디렉터리를 계산한다.
function getRendererRuntimeRootDir() {
  return path.resolve(
    RUNTIME_STRATEGY === 'node-server' ? getPackagedRootDir() : ROOT_DIR,
    WEB_OUT_DIR,
  )
}

// isUrlReady 함수는 지정한 URL이 HTTP 응답 가능한 상태인지 확인한다.
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

// createLoopbackUrlCandidates 함수는 다음 단계에서 사용할 객체나 계획을 만든다.
function createLoopbackUrlCandidates(urlString: string) {
  try {
    const url = new URL(urlString)
    const candidates = [urlString]

    if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost'
      candidates.push(url.toString())
    } else if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
      candidates.push(url.toString())
    }

    return Array.from(new Set(candidates))
  } catch {
    return [urlString]
  }
}

// waitForUrlReady 함수는 지정한 URL이 준비될 때까지 반복해서 확인한다.
export async function waitForUrlReady(urlString: string, timeoutMs = 30_000, intervalMs = 250) {
  const startedAt = Date.now()
  const candidates = createLoopbackUrlCandidates(urlString)

  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates) {
      if (await isUrlReady(candidate)) return candidate
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(\`Timed out waiting for \${candidates.join(' or ')}\`)
}

// getAvailablePort 함수는 로컬 서버가 사용할 수 있는 빈 포트를 찾는다.
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

// sendResponse 함수는 정적 서버 HTTP 응답을 상태 코드와 본문으로 마무리한다.
function sendResponse(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
) {
  response.writeHead(statusCode, { 'Content-Type': contentType })
  response.end(body)
}

// getContentType 함수는 필요한 값이나 경로를 계산해 돌려준다.
function getContentType(filePath: string) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

// resolveRequestPath 함수는 HTTP 요청 경로를 정적 파일 경로로 안전하게 변환한다.
function resolveRequestPath(distPath: string, requestPath: string) {
  const normalizedPath = path.posix.normalize(requestPath)
  const relativePath =
    normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\\/+/, '')
  const resolvedPath = path.resolve(distPath, relativePath)
  const isInsideDist =
    resolvedPath === distPath || resolvedPath.startsWith(\`\${distPath}\${path.sep}\`)

  return isInsideDist ? resolvedPath : null
}

// serveFile 함수는 정적 파일을 읽어 HTTP 응답으로 내려준다.
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

// handleRendererRequest 함수는 정적 렌더러 서버의 HTTP 요청을 파일 응답으로 처리한다.
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

// startStaticServer 함수는 정적 빌드 결과물을 제공하는 로컬 HTTP 서버를 시작한다.
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
}

// startNodeServerRuntime 함수는 패키징된 node-server 렌더러 런타임을 시작한다.
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

// stopNodeServerRuntime 함수는 실행 중인 node-server 렌더러 런타임을 종료한다.
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

// startRendererRuntime 함수는 현재 전략에 맞는 렌더러 런타임을 시작하고 URL을 반환한다.
export async function startRendererRuntime() {
  return RUNTIME_STRATEGY === 'node-server'
    ? startNodeServerRuntime()
    : startStaticServer()
}

// stopRendererRuntime 함수는 현재 전략에 맞게 렌더러 런타임을 종료한다.
export async function stopRendererRuntime() {
  if (RUNTIME_STRATEGY === 'node-server') {
    await stopNodeServerRuntime()
    return
  }

  await stopStaticServer()
}

// inferDevUrl 함수는 개발 모드에서 Electron이 접속할 렌더러 URL을 추론한다.
export async function inferDevUrl() {
  return DEV_URL
}

${renderServeDevAndBuildSource()}
`
}
