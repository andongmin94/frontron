import type { InitConfig } from '../../shared'

// embedJson 함수는 생성 소스 안에 안전하게 넣을 JSON 문자열을 만든다.
function embedJson(value: unknown) {
  return JSON.stringify(JSON.stringify(value))
}

// renderServeHeaderAndConfigSource 함수는 생성되는 serve.ts의 import, 설정, 공통 런타임 도우미를 만든다.
export function renderServeHeaderAndConfigSource(config: InitConfig, devUrl: string) {
  const usesNodeServer = config.runtimeStrategy === 'node-server'
  const usesRemixRuntime = usesNodeServer && config.adapter === 'remix-node-server'
  const fileSystemImports = [
    'existsSync',
    'writeFileSync',
    ...(usesNodeServer ? ['cpSync', 'mkdirSync', 'rmSync'] : []),
    ...(usesRemixRuntime ? ['readFileSync', 'readdirSync'] : []),
  ].sort()
  const staticFileSystemImport = usesNodeServer
    ? ''
    : `\nimport { open, realpath, stat } from 'node:fs/promises'`
  const staticHttpTypes = usesNodeServer ? '' : ', type IncomingMessage, type ServerResponse'
  const nodeServerConstants = usesNodeServer
    ? `
const NODE_SERVER_SOURCE_ROOT = readEmbeddedJson<string | null>(${embedJson(config.nodeServerSourceRoot)})
const NODE_SERVER_SOURCE_ENTRY = readEmbeddedJson<string | null>(${embedJson(config.nodeServerSourceEntry ?? null)})
const NODE_SERVER_ENTRY = readEmbeddedJson<string | null>(${embedJson(config.nodeServerEntry)})
const NODE_SERVER_COPY_TARGETS = readEmbeddedJson<Array<{ from: string; to: string }>>(${embedJson(config.nodeServerCopyTargets)})`
    : ''
  const staticServerState = usesNodeServer
    ? ''
    : `
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

let rendererServer: ReturnType<typeof createServer> | null = null`
  const nodeServerState = usesNodeServer
    ? `
let rendererProcess: ChildProcess | null = null
let rendererRuntimeUrl: string | null = null`
    : ''
  const runtimeRootHelpers = usesNodeServer
    ? `// getPackagedRootDir 함수는 패키징된 앱에서 리소스 루트 경로를 계산한다.
function getPackagedRootDir() {
  const appAsarSegment = path.sep + 'app.asar'

  return ROOT_DIR.includes(appAsarSegment)
    ? ROOT_DIR.replace(appAsarSegment, path.sep + 'app.asar.unpacked')
    : ROOT_DIR
}

// getRendererRuntimeRootDir 함수는 패키징된 Node 서버 파일을 찾을 디렉터리를 계산한다.
function getRendererRuntimeRootDir() {
  return path.resolve(getPackagedRootDir(), WEB_OUT_DIR)
}`
    : `// getRendererRuntimeRootDir 함수는 정적 렌더러 파일을 찾을 디렉터리를 계산한다.
function getRendererRuntimeRootDir() {
  return path.resolve(ROOT_DIR, WEB_OUT_DIR)
}`
  const availablePortHelper = usesNodeServer
    ? `// getAvailablePort 함수는 로컬 Node 서버가 사용할 수 있는 빈 포트를 찾는다.
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
}`
    : ''

  return `import { spawn, type ChildProcess } from 'node:child_process'
import { ${fileSystemImports.join(', ')} } from 'node:fs'${staticFileSystemImport}
import { createServer, request as httpRequest${staticHttpTypes} } from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PACKAGE_MANAGER = readEmbeddedJson<'npm' | 'pnpm' | 'yarn' | 'bun'>(${embedJson(config.packageManager)})
const WEB_DEV_SCRIPT = readEmbeddedJson<string>(${embedJson(config.webDevScript)})
const WEB_OUT_DIR = readEmbeddedJson<string>(${embedJson(config.outDir)})
const DEV_URL = readEmbeddedJson<string>(${embedJson(devUrl)})
${nodeServerConstants}
const LOOPBACK_HOST = '127.0.0.1'
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(runtimeDir, '..')
const DIST_DIR = path.resolve(ROOT_DIR, 'dist-electron')
const MAIN_ENTRY_PATH = path.join(DIST_DIR, 'main.js')
const RUNTIME_PACKAGE_PATH = path.join(DIST_DIR, 'package.json')
${staticServerState}${nodeServerState}

// readEmbeddedJson 함수는 생성된 serve.ts에 박힌 JSON 상수 값을 읽는다.
function readEmbeddedJson<T>(value: string) {
  return JSON.parse(value) as T
}

// isFileSystemError 함수는 Node 파일 시스템 오류 코드가 있는 객체인지 확인한다.
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
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

${runtimeRootHelpers}

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

// createLoopbackUrlCandidates 함수는 localhost 주소가 IPv4나 IPv6로 해석되는 경우까지 점검할 URL 목록을 만든다.
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

${availablePortHelper}`
}
