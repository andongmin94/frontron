import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { request as requestHttps } from 'node:https'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const frontronPackageRoot = join(repoRoot, 'frontron')
const tempParent = join(tmpdir(), 'frontron-package-manager-matrix-smoke')
const commandTimeoutMs = Number(process.env.FRONTRON_PM_MATRIX_TIMEOUT_MS ?? 15 * 60 * 1000)
const registryProxyTimeoutMs = 60 * 1000
const maxBufferBytes = 32 * 1024 * 1024
const nodePackageSpec = process.env.FRONTRON_PM_MATRIX_NODE ?? 'node@22.23.1'
const activeChildren = new Set()
let interruptedSignal = null
const managerDefinitions = {
  // pnpm 11.11.0은 Windows에서 electron-builder 해석이 멈추므로 검증된 11.4.0을 재현 가능하게 고정한다.
  pnpm: {
    name: 'pnpm',
    packageSpec: process.env.FRONTRON_PM_MATRIX_PNPM ?? 'pnpm@11.4.0',
    binary: 'pnpm',
    installArgs: ['install', '--no-frozen-lockfile', '--reporter=append-only'],
  },
  yarn: {
    name: 'yarn',
    packageSpec: process.env.FRONTRON_PM_MATRIX_YARN ?? '@yarnpkg/cli-dist@4.17.1',
    binary: 'yarn',
    installArgs: ['install', '--no-immutable'],
  },
  bun: {
    name: 'bun',
    packageSpec: process.env.FRONTRON_PM_MATRIX_BUN ?? 'bun@1.3.14',
    binary: 'bun',
    installArgs: ['install'],
  },
}

// logStep 함수는 긴 매트릭스 실행에서 현재 단계와 대상을 한눈에 구분해 출력한다.
function logStep(message) {
  console.log(`[pm-matrix] ${message}`)
}

// isEnabled 함수는 CI 환경 변수와 명령행 기본값에 쓰는 참 값을 일관되게 판별한다.
function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
}

// parseArgs 함수는 실행 case와 비용이 큰 패키징 및 임시 파일 보존 옵션을 검증한다.
function parseArgs(argv) {
  let selectedCase = 'all'
  let selectedCaseSeen = false
  let packageDirectory = isEnabled(process.env.FRONTRON_PM_MATRIX_PACKAGE)
  let keepTemporary = isEnabled(process.env.FRONTRON_PM_MATRIX_KEEP)
  let help = false

  for (const argument of argv) {
    if (argument === '--package' || argument === '--package-dir') {
      packageDirectory = true
    } else if (argument === '--no-package') {
      packageDirectory = false
    } else if (argument === '--keep') {
      keepTemporary = true
    } else if (argument === '--help' || argument === '-h') {
      help = true
    } else if (!argument.startsWith('-') && !selectedCaseSeen) {
      selectedCase = argument
      selectedCaseSeen = true
    } else {
      throw new Error(`알 수 없는 인자: ${argument}`)
    }
  }

  if (!['all', 'pnpm', 'yarn', 'bun'].includes(selectedCase)) {
    throw new Error(`알 수 없는 case: ${selectedCase} (all, pnpm, yarn, bun 중 하나를 사용하세요.)`)
  }

  return { selectedCase, packageDirectory, keepTemporary, help }
}

// printHelp 함수는 기본 CI 범위와 선택 가능한 고비용 패키징 동작을 명확히 안내한다.
function printHelp() {
  console.log(`Usage: node scripts/package-manager-matrix-smoke.mjs [all|pnpm|yarn|bun] [options]

Options:
  --package, --package-dir  frontron:package --dir까지 실행한다.
  --no-package             환경 변수로 켠 패키징을 끈다.
  --keep                   디버깅을 위해 임시 디렉터리를 보존한다.
  -h, --help               도움말을 출력한다.

기본 로컬/CI 범위는 install -> frontron init --yes -> install -> doctor ->
frontron:build이다. electron-builder --dir는 --package 또는
FRONTRON_PM_MATRIX_PACKAGE=1로 명시한 경우에만 실행한다.

릴리스 필수 매트릭스의 정확 버전:
  FRONTRON_PM_MATRIX_NODE=node@22.23.1
  FRONTRON_PM_MATRIX_PNPM=pnpm@11.4.0
  FRONTRON_PM_MATRIX_YARN=@yarnpkg/cli-dist@4.17.1
  FRONTRON_PM_MATRIX_BUN=bun@1.3.14

위 환경 변수 override로 최신 major를 관찰하는 실행은 예정된 호환성 lane에서만 사용한다.

Other environment options:
  FRONTRON_PM_MATRIX_PACKAGE=1
  FRONTRON_PM_MATRIX_KEEP=1
  FRONTRON_PM_MATRIX_TIMEOUT_MS=900000
`)
}

// findNpmCliPath 함수는 셸을 거치지 않고 npm exec를 호출할 수 있는 npm CLI 파일을 찾는다.
function findNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]

  for (const candidate of candidates) {
    if (candidate && basename(candidate).toLowerCase() === 'npm-cli.js' && existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

// getNpmInvocation 함수는 Windows에서도 한글과 공백 인자를 잃지 않는 npm 호출 정보를 만든다.
function getNpmInvocation(args) {
  const npmCliPath = findNpmCliPath()

  if (npmCliPath) {
    return {
      command: process.execPath,
      args: [npmCliPath, ...args],
      displayArgs: ['npm', ...args],
    }
  }

  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
      displayArgs: ['npm', ...args],
    }
  }

  return {
    command: 'npm',
    args,
    displayArgs: ['npm', ...args],
  }
}

// getManagerInvocation 함수는 전역 설치 없이 명시한 npm 패키지의 매니저 binary를 실행한다.
function getManagerInvocation(manager, args) {
  if (manager.runtime) {
    return {
      command: manager.runtime.nodePath,
      args: [manager.runtime.cliPath, ...args],
      displayArgs: [manager.binary, ...args],
    }
  }

  return getNpmInvocation([
    'exec',
    '--yes',
    '--package',
    nodePackageSpec,
    '--package',
    manager.packageSpec,
    '--',
    manager.binary,
    ...args,
  ])
}

// resolveYarnRuntime 함수는 npm exec shim을 반복하지 않도록 격리 설치된 Node와 Yarn CLI를 찾는다.
async function resolveYarnRuntime(manager) {
  // npm exec는 Windows에서 여러 줄짜리 -e 인자를 cmd.exe에 전달할 때 내용을 잃을 수 있다.
  const probeSource = [
    "const { existsSync } = require('node:fs')",
    "const { delimiter, dirname, resolve } = require('node:path')",
    "const names = process.platform === 'win32' ? ['yarn.cmd', 'yarn.exe', 'yarn'] : ['yarn']",
    'let shimPath = null',
    "for (const directory of (process.env.PATH || '').split(delimiter)) {",
    'for (const name of names) {',
    'const candidate = resolve(directory, name)',
    'if (existsSync(candidate)) { shimPath = candidate; break }',
    '}',
    'if (shimPath) break',
    '}',
    "if (!shimPath) throw new Error('npm exec PATH does not contain Yarn')",
    "const cliPath = resolve(dirname(shimPath), '..', '@yarnpkg', 'cli-dist', 'bin', 'yarn.js')",
    "if (!existsSync(cliPath)) throw new Error('Yarn CLI package entry is missing')",
    'console.log(JSON.stringify({ nodePath: process.execPath, cliPath }))',
  ].join(';')
  const invocation = getNpmInvocation([
    'exec',
    '--yes',
    '--package',
    nodePackageSpec,
    '--package',
    manager.packageSpec,
    '--',
    'node',
    '-e',
    probeSource,
  ])
  const result = await runCommand(invocation, repoRoot, 'Yarn runtime 경로 확인')
  const runtimeSource = result.stdout.trim().split(/\r?\n/).at(-1)
  let runtime

  try {
    runtime = JSON.parse(runtimeSource)
  } catch {
    throw new Error(`Yarn runtime 경로를 해석하지 못했습니다: ${result.stdout.trim()}`)
  }

  if (
    typeof runtime?.nodePath !== 'string' ||
    typeof runtime?.cliPath !== 'string' ||
    !existsSync(runtime.nodePath) ||
    !existsSync(runtime.cliPath)
  ) {
    throw new Error('Yarn runtime 경로가 유효한 파일을 가리키지 않습니다.')
  }

  return runtime
}

// getChildEnv 함수는 대화형 출력과 CI별 immutable 기본값을 제거해 실행을 재현 가능하게 한다.
function getChildEnv() {
  const nodeOptions = process.env.NODE_OPTIONS?.trim()
  const env = {
    ...process.env,
    CI: process.env.CI?.trim() || '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    NODE_OPTIONS:
      nodeOptions?.includes('--trace-deprecation') || nodeOptions?.includes('--no-deprecation')
        ? nodeOptions
        : nodeOptions
          ? `${nodeOptions} --no-deprecation`
          : '--no-deprecation',
  }

  delete env.FRONTRON_CREATE_TEMPLATE_DIR
  return env
}

// formatArgument 함수는 실패 로그에서 공백과 특수 문자가 있는 인자를 복사 가능한 형태로 표시한다.
function formatArgument(argument) {
  return /^[A-Za-z0-9_@./:=+,-]+$/.test(argument) ? argument : JSON.stringify(argument)
}

// formatCommand 함수는 내부 실행 경로 대신 사용자가 이해할 수 있는 명령 문자열을 만든다.
function formatCommand(invocation) {
  return invocation.displayArgs.map(formatArgument).join(' ')
}

// terminateProcessTree 함수는 timeout 시 현재 명령의 하위 프로세스까지 모두 종료한다.
function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })

    if (result.error || result.status !== 0) {
      child.kill('SIGKILL')
    }

    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

// handleInterruption 함수는 종료 신호를 기록하고 현재 실행 중인 모든 하위 트리를 정리한다.
function handleInterruption(signal) {
  if (interruptedSignal) {
    return
  }

  interruptedSignal = signal
  console.error(`[pm-matrix] ${signal} 수신: 실행 중인 명령을 종료합니다.`)

  for (const child of activeChildren) {
    terminateProcessTree(child)
  }
}

// handleSigint 함수는 Ctrl+C를 공통 종료 처리로 전달한다.
function handleSigint() {
  handleInterruption('SIGINT')
}

// handleSigterm 함수는 CI의 종료 요청을 공통 종료 처리로 전달한다.
function handleSigterm() {
  handleInterruption('SIGTERM')
}

// runCommand 함수는 출력을 실시간 보존하고 실패 위치, 종료 코드, 명령을 함께 보고한다.
async function runCommand(invocation, cwd, label) {
  if (interruptedSignal) {
    throw new Error(`${interruptedSignal} 신호로 실행이 중단되었습니다.`)
  }

  const commandLine = formatCommand(invocation)
  logStep(`${label}: ${commandLine}`)

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      detached: process.platform !== 'win32',
      env: getChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows의 숨김 콘솔과 pipe 조합은 Yarn binary shim의 한글 cwd를 손상시킬 수 있다.
      windowsHide: process.platform !== 'win32',
    })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let capturedBytes = 0
    let spawnError = null
    let failureReason = null
    let settled = false
    const timeoutEnabled = Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0
    const timeout = timeoutEnabled
      ? setTimeout(() => {
          failureReason = `timeout after ${commandTimeoutMs}ms`
          terminateProcessTree(child)
        }, commandTimeoutMs)
      : null

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      capturedBytes += Buffer.byteLength(chunk)

      if (capturedBytes <= maxBufferBytes) {
        stdout += chunk
      } else if (!failureReason) {
        failureReason = `captured output exceeded ${maxBufferBytes} bytes`
        terminateProcessTree(child)
      }
    })

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      capturedBytes += Buffer.byteLength(chunk)

      if (capturedBytes <= maxBufferBytes) {
        stderr += chunk
      } else if (!failureReason) {
        failureReason = `captured output exceeded ${maxBufferBytes} bytes`
        terminateProcessTree(child)
      }
    })

    child.on('error', (error) => {
      spawnError = error
    })

    child.on('close', (status, signal) => {
      activeChildren.delete(child)

      if (settled) {
        return
      }

      settled = true

      if (timeout) {
        clearTimeout(timeout)
      }

      if (spawnError || failureReason || status !== 0) {
        const reason = spawnError
          ? `${spawnError.name}: ${spawnError.message}`
          : (failureReason ?? (signal ? `signal ${signal}` : `exit code ${String(status)}`))

        const commandError = new Error(
          `${label} 실패 (${reason})\n  cwd: ${cwd}\n  command: ${commandLine}`,
        )
        commandError.commandStdout = stdout
        commandError.commandStderr = stderr
        rejectPromise(commandError)
        return
      }

      resolvePromise({ stdout, stderr, status, signal })
    })
  })
}

// runNpm 함수는 npm build와 npm pack을 같은 오류 처리 규칙으로 실행한다.
async function runNpm(args, cwd, label) {
  return runCommand(getNpmInvocation(args), cwd, label)
}

// runManager 함수는 pnpm, Yarn, Bun을 모두 npm exec 기반으로 실행한다.
async function runManager(manager, args, cwd, label) {
  return runCommand(getManagerInvocation(manager, args), cwd, label)
}

// runLocalBinary 함수는 각 매니저가 설치한 Frontron binary를 registry 조회 없이 실행한다.
async function runLocalBinary(manager, binary, args, cwd, label) {
  const commandArgs = manager.name === 'pnpm' ? ['exec', binary, ...args] : ['run', binary, ...args]
  return runManager(manager, commandArgs, cwd, label)
}

// runPackageScript 함수는 각 매니저의 run 규칙으로 package.json script를 한 번만 실행한다.
async function runPackageScript(manager, scriptName, extraArgs, cwd, label) {
  const args = ['run', scriptName, ...extraArgs]
  return runManager(manager, args, cwd, label)
}

// writeJson 함수는 fixture 계약 파일을 플랫폼과 무관한 안정적인 JSON 형식으로 기록한다.
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// readJson 함수는 생성된 package.json과 manifest를 검증 가능한 객체로 읽는다.
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// assertPathExists 함수는 누락된 설치 또는 빌드 산출물을 경로와 함께 즉시 보고한다.
function assertPathExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label}이(가) 없습니다: ${path}`)
  }
}

// createScratchRoot 함수는 Windows 경로 처리까지 검증하도록 한글과 공백이 있는 작업 경로를 만든다.
function createScratchRoot() {
  mkdirSync(tempParent, { recursive: true })
  return mkdtempSync(join(tempParent, '실제 한글 공백 경로-'))
}

// cleanupScratchRoot 함수는 생성 위치를 검증한 뒤 Windows 잠금 재시도를 포함해 임시 파일을 지운다.
function cleanupScratchRoot(scratchRoot) {
  const parent = resolve(tempParent)
  const target = resolve(scratchRoot)
  const relativeTarget = relative(parent, target)

  if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`안전하지 않은 임시 디렉터리 정리 경로: ${target}`)
  }

  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })

  if (existsSync(parent) && readdirSync(parent).length === 0) {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

// packLocalPackage 함수는 로컬 패키지를 빌드하고 registry가 제공할 실제 tarball 계약을 만든다.
async function packLocalPackage(packageDirectory, packageName, scratchRoot) {
  await runNpm(['run', 'build'], packageDirectory, `로컬 ${packageName} 빌드`)

  const outputDirectory = join(scratchRoot, `${packageName} npm pack 산출물`)
  mkdirSync(outputDirectory, { recursive: true })
  const result = await runNpm(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDirectory],
    packageDirectory,
    `로컬 ${packageName} npm pack`,
  )

  let packResult

  try {
    packResult = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`npm pack JSON을 읽지 못했습니다: ${String(error)}`)
  }

  const filename = packResult[0]?.filename

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack이 tarball 파일명을 보고하지 않았습니다.')
  }

  const tarballPath = join(outputDirectory, filename)
  assertPathExists(tarballPath, `${packageName} tarball`)
  const manifest = readJson(join(packageDirectory, 'package.json'))
  const tarball = readFileSync(tarballPath)
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  const shasum = createHash('sha1').update(tarball).digest('hex')

  if (manifest.name !== packageName || manifest.version !== packResult[0]?.version) {
    throw new Error(`${packageName} pack metadata와 package.json 이름 또는 버전이 다릅니다.`)
  }

  if (packResult[0]?.integrity !== integrity || packResult[0]?.shasum !== shasum) {
    throw new Error(`${packageName} tarball 무결성 계산값이 npm pack 결과와 다릅니다.`)
  }

  return {
    filename,
    integrity,
    manifest,
    path: tarballPath,
    shasum,
    tarball,
  }
}

// createCandidateRegistryRecords 함수는 두 릴리스 후보의 packument와 tarball 응답을 구성한다.
function createCandidateRegistryRecords(tarballs, origin) {
  const records = new Map()
  const publishedAt = '2025-01-01T00:00:00.000Z'

  for (const candidate of Object.values(tarballs)) {
    const { manifest } = candidate
    const tarballPath = `/${manifest.name}/-/${candidate.filename}`
    const versionManifest = {
      ...manifest,
      _id: `${manifest.name}@${manifest.version}`,
      dist: {
        integrity: candidate.integrity,
        shasum: candidate.shasum,
        tarball: new URL(tarballPath, origin).href,
      },
    }
    const packument = {
      _id: manifest.name,
      name: manifest.name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: versionManifest },
      time: {
        created: publishedAt,
        modified: publishedAt,
        [manifest.version]: publishedAt,
      },
    }

    records.set(`/${manifest.name}`, {
      body: Buffer.from(`${JSON.stringify(packument)}\n`),
      contentType: 'application/json',
    })
    records.set(tarballPath, {
      body: candidate.tarball,
      contentType: 'application/octet-stream',
    })
  }

  return records
}

// sendRegistryBuffer 함수는 GET과 HEAD에 동일한 길이·타입 헤더를 적용해 응답한다.
function sendRegistryBuffer(request, response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': String(body.length),
    'content-type': contentType,
  })

  if (request.method === 'HEAD') {
    response.end()
  } else {
    response.end(body)
  }
}

// sendRegistryError 함수는 proxy 오류를 package manager가 해석할 수 있는 JSON으로 반환한다.
function sendRegistryError(response, statusCode, message) {
  if (response.headersSent) {
    response.destroy()
    return
  }

  const body = Buffer.from(`${JSON.stringify({ error: message })}\n`)
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': String(body.length),
    'content-type': 'application/json',
  })
  response.end(body)
}

// createProxyRequestHeaders 함수는 로컬 또는 사용자 인증 정보가 npm registry로 전달되지 않게 거른다.
function createProxyRequestHeaders(headers) {
  const forwarded = { ...headers, host: 'registry.npmjs.org' }

  for (const name of [
    'authorization',
    'connection',
    'cookie',
    'keep-alive',
    'proxy-authorization',
  ]) {
    delete forwarded[name]
  }

  return forwarded
}

// createProxyResponseHeaders 함수는 hop-by-hop 헤더를 제거해 로컬 응답 연결을 독립적으로 관리한다.
function createProxyResponseHeaders(headers) {
  const forwarded = { ...headers }

  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'transfer-encoding',
    'upgrade',
  ]) {
    delete forwarded[name]
  }

  return forwarded
}

// proxyRegistryRequest 함수는 후보 외 공개 패키지 조회를 공식 npm registry로 그대로 중계한다.
function proxyRegistryRequest(request, response) {
  let completed = false

  // handleProxyResponse 함수는 upstream 상태·헤더·본문 stream을 로컬 client에 전달한다.
  function handleProxyResponse(upstreamResponse) {
    completed = true

    // handleUpstreamStreamError 함수는 응답 도중 연결이 끊기면 불완전한 본문을 폐기한다.
    function handleUpstreamStreamError(error) {
      response.destroy(error)
    }

    // handleClientResponseClosed 함수는 client 조기 종료 시 남은 upstream 다운로드를 중단한다.
    function handleClientResponseClosed() {
      if (!upstreamResponse.complete) {
        upstreamResponse.destroy()
      }
    }

    upstreamResponse.once('error', handleUpstreamStreamError)
    response.once('close', handleClientResponseClosed)
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      createProxyResponseHeaders(upstreamResponse.headers),
    )

    if (request.method === 'HEAD') {
      upstreamResponse.resume()
      response.end()
    } else {
      upstreamResponse.pipe(response)
    }
  }

  // handleProxyError 함수는 연결 단계 오류를 한 번만 안전하게 보고한다.
  function handleProxyError(error) {
    if (!completed) {
      completed = true
      sendRegistryError(response, 502, `npm registry proxy 오류: ${error.message}`)
    }
  }

  // handleProxyTimeout 함수는 registry 연결 지연이 전체 매트릭스를 무한 대기시키지 않게 한다.
  function handleProxyTimeout() {
    upstreamRequest.destroy(
      new Error(`npm registry proxy timeout after ${registryProxyTimeoutMs}ms`),
    )
  }

  // handleClientAborted 함수는 package manager가 요청을 취소하면 upstream 연결도 즉시 닫는다.
  function handleClientAborted() {
    upstreamRequest.destroy()
  }

  const upstreamRequest = requestHttps(
    {
      headers: createProxyRequestHeaders(request.headers),
      hostname: 'registry.npmjs.org',
      method: request.method,
      path: request.url,
      port: 443,
      protocol: 'https:',
    },
    handleProxyResponse,
  )
  upstreamRequest.setTimeout(registryProxyTimeoutMs, handleProxyTimeout)
  upstreamRequest.once('error', handleProxyError)
  request.once('aborted', handleClientAborted)
  request.pipe(upstreamRequest)
}

// createRegistryRequestHandler 함수는 후보 패키지는 로컬에서, 나머지는 npm proxy에서 제공한다.
function createRegistryRequestHandler(state) {
  // handleRegistryRequest 함수는 허용 method와 registry route를 요청마다 검증한다.
  function handleRegistryRequest(request, response) {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      sendRegistryError(response, 405, `지원하지 않는 registry method: ${request.method}`)
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const record = state.records.get(requestUrl.pathname)

    if (record) {
      sendRegistryBuffer(request, response, 200, record.contentType, record.body)
      return
    }

    if (requestUrl.pathname === '/-/ping') {
      sendRegistryBuffer(request, response, 200, 'application/json', Buffer.from('{}\n'))
      return
    }

    proxyRegistryRequest(request, response)
  }

  return handleRegistryRequest
}

// listenRegistryServer 함수는 loopback 임의 port가 실제로 열릴 때까지 기다린다.
async function listenRegistryServer(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    // handleListening 함수는 listen 성공 후 임시 error listener를 제거한다.
    function handleListening() {
      server.off('error', handleError)
      resolvePromise()
    }

    // handleError 함수는 bind 실패를 호출자에게 전달한다.
    function handleError(error) {
      server.off('listening', handleListening)
      rejectPromise(error)
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(0, '127.0.0.1')
  })
}

// closeRegistryServer 함수는 keep-alive 연결까지 끊고 server 종료를 확인한다.
async function closeRegistryServer(server) {
  server.closeAllConnections?.()

  await new Promise((resolvePromise, rejectPromise) => {
    // handleClosed 함수는 close 완료 또는 오류를 Promise 결과로 변환한다.
    function handleClosed(error) {
      if (error) {
        rejectPromise(error)
      } else {
        resolvePromise()
      }
    }

    server.close(handleClosed)
  })
}

// startCandidateRegistry 함수는 실제 tarball 두 개를 제공하는 일회성 loopback registry를 시작한다.
async function startCandidateRegistry(tarballs) {
  const state = { records: new Map() }
  const server = createServer(createRegistryRequestHandler(state))
  await listenRegistryServer(server)
  const address = server.address()

  if (!address || typeof address === 'string') {
    await closeRegistryServer(server)
    throw new Error('로컬 candidate registry 주소를 확인하지 못했습니다.')
  }

  const origin = `http://127.0.0.1:${address.port}/`
  state.records = createCandidateRegistryRecords(tarballs, origin)
  logStep(`candidate registry 시작: ${origin}`)

  return { origin, server }
}

// resolveManagerVersion 함수는 major로 고정한 실행 패키지가 제공한 실제 버전을 fixture에 기록한다.
async function resolveManagerVersion(manager) {
  if (manager.name === 'yarn') {
    manager.runtime = await resolveYarnRuntime(manager)
  }

  const result = await runManager(manager, ['--version'], repoRoot, `${manager.name} 버전 확인`)
  const version = result.stdout.trim().split(/\r?\n/).at(-1)?.trim()

  if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    throw new Error(`${manager.name} 버전을 해석하지 못했습니다: ${result.stdout.trim()}`)
  }

  return version
}

// createViteFixture 함수는 로컬 registry의 릴리스 후보를 설치하는 실제 최소 Vite 앱을 만든다.
function createViteFixture(scratchRoot, manager, managerVersion, tarballs, registryOrigin) {
  const appRoot = join(scratchRoot, `${manager.name}-한글 공백 Vite 프로젝트`)
  const sourceRoot = join(appRoot, 'src')
  const fixtureAssetRoot = join(appRoot, '.matrix')

  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(fixtureAssetRoot, { recursive: true })

  writeJson(join(appRoot, 'package.json'), {
    name: `frontron-${manager.name}-matrix-smoke`,
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: `${manager.name}@${managerVersion}`,
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    devDependencies: {
      'create-frontron': tarballs.create.manifest.version,
      frontron: tarballs.frontron.manifest.version,
      vite: '^7.0.0',
    },
  })

  writeFileSync(
    join(appRoot, '.npmrc'),
    `registry=${registryOrigin}
audit=false
fund=false
update-notifier=false
`,
    'utf8',
  )

  writeFileSync(
    join(appRoot, 'index.html'),
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Frontron Package Manager Smoke</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
    'utf8',
  )

  writeFileSync(
    join(sourceRoot, 'main.js'),
    `document.querySelector('#app').textContent = 'Frontron package manager smoke'
`,
    'utf8',
  )

  if (manager.name === 'pnpm') {
    // pnpm 11의 보안 재검증과 global virtual store는 smoke 변수가 아니므로 정책으로 고정한다.
    writeFileSync(
      join(appRoot, 'pnpm-workspace.yaml'),
      `enableGlobalVirtualStore: false
allowBuilds:
  esbuild: false
`,
      'utf8',
    )
  } else if (manager.name === 'yarn') {
    writeFileSync(
      join(appRoot, '.yarnrc.yml'),
      `nodeLinker: pnp
enableScripts: true
enableGlobalCache: false
enableMirror: false
cacheFolder: .matrix/yarn-cache
globalFolder: .matrix/yarn-global
npmRegistryServer: "${registryOrigin}"
unsafeHttpWhitelist:
  - 127.0.0.1
`,
      'utf8',
    )
  }

  return appRoot
}

// assertInstallLayout 함수는 각 매니저의 lockfile과 Yarn의 init 전후 linker 전환을 확인한다.
function assertInstallLayout(manager, appRoot, stage) {
  if (manager.name === 'pnpm') {
    assertPathExists(join(appRoot, 'pnpm-lock.yaml'), 'pnpm lockfile')
  } else if (manager.name === 'yarn') {
    assertPathExists(join(appRoot, 'yarn.lock'), 'Yarn lockfile')
    const yarnRcSource = readFileSync(join(appRoot, '.yarnrc.yml'), 'utf8')

    if (stage === 'initial') {
      assertPathExists(join(appRoot, '.pnp.cjs'), 'Yarn PnP loader')

      if (existsSync(join(appRoot, 'node_modules'))) {
        throw new Error(`Yarn PnP fixture에 node_modules가 생성되었습니다: ${appRoot}`)
      }

      if (!yarnRcSource.includes('nodeLinker: pnp')) {
        throw new Error('Yarn 최초 install이 PnP 설정을 사용하지 않았습니다.')
      }
    } else {
      assertPathExists(join(appRoot, 'node_modules'), 'Yarn node-modules install')

      if (!yarnRcSource.includes('nodeLinker: node-modules')) {
        throw new Error('Frontron init이 Yarn nodeLinker를 node-modules로 전환하지 않았습니다.')
      }
    }
  } else if (
    manager.name === 'bun' &&
    !existsSync(join(appRoot, 'bun.lock')) &&
    !existsSync(join(appRoot, 'bun.lockb'))
  ) {
    throw new Error(`Bun lockfile이 생성되지 않았습니다: ${appRoot}`)
  }
}

// assertCandidateResolution 함수는 lockfile이 file override가 아닌 후보 버전을 기록했는지 확인한다.
function assertCandidateResolution(manager, appRoot, tarballs) {
  const packageJson = readJson(join(appRoot, 'package.json'))
  const lockfileName =
    manager.name === 'pnpm'
      ? 'pnpm-lock.yaml'
      : manager.name === 'yarn'
        ? 'yarn.lock'
        : existsSync(join(appRoot, 'bun.lock'))
          ? 'bun.lock'
          : 'bun.lockb'
  const lockfile = readFileSync(join(appRoot, lockfileName), 'utf8')

  for (const candidate of Object.values(tarballs)) {
    const { name, version } = candidate.manifest

    if (packageJson.devDependencies?.[name] !== version) {
      throw new Error(`${manager.name} fixture가 ${name}@${version}을 정확히 고정하지 않았습니다.`)
    }

    if (!lockfile.includes(name) || !lockfile.includes(version)) {
      throw new Error(`${manager.name} lockfile에 ${name}@${version} 후보가 없습니다.`)
    }
  }

  if (lockfile.includes('create-frontron.tgz') || lockfile.includes('frontron.tgz')) {
    throw new Error(
      `${manager.name} lockfile이 registry 후보 대신 file tarball override를 기록했습니다.`,
    )
  }
}

// assertInitResult 함수는 init이 Vite adapter와 데스크톱 script 계약을 실제로 기록했는지 확인한다.
function assertInitResult(manager, managerVersion, appRoot) {
  const manifestPath = join(appRoot, '.frontron', 'manifest.json')
  assertPathExists(manifestPath, 'Frontron manifest')

  const manifest = readJson(manifestPath)
  const packageJson = readJson(join(appRoot, 'package.json'))

  if (manifest.adapter !== 'generic-static') {
    throw new Error(
      `${manager.name} case가 generic-static 대신 ${String(manifest.adapter)} adapter를 선택했습니다.`,
    )
  }

  if (packageJson.packageManager !== `${manager.name}@${managerVersion}`) {
    throw new Error(`${manager.name} packageManager 필드가 init 중 예기치 않게 변경되었습니다.`)
  }

  for (const scriptName of ['frontron:dev', 'frontron:build', 'frontron:package']) {
    if (typeof packageJson.scripts?.[scriptName] !== 'string') {
      throw new Error(`${manager.name} init이 scripts.${scriptName}을 생성하지 않았습니다.`)
    }
  }

  if (manager.name === 'pnpm') {
    const workspaceSource = readFileSync(join(appRoot, 'pnpm-workspace.yaml'), 'utf8')

    for (const expectedPolicy of [
      'enableGlobalVirtualStore: false',
      '  esbuild: false',
      '  electron: true',
      '  electron-winstaller: true',
    ]) {
      if (!workspaceSource.includes(expectedPolicy)) {
        throw new Error(`pnpm init이 workspace 정책을 기록하지 않았습니다: ${expectedPolicy}`)
      }
    }
  } else if (manager.name === 'yarn') {
    const yarnRcSource = readFileSync(join(appRoot, '.yarnrc.yml'), 'utf8')

    if (!yarnRcSource.includes('nodeLinker: node-modules')) {
      throw new Error('Yarn init 결과에 nodeLinker: node-modules가 없습니다.')
    }

    if (!Array.isArray(manifest.yarnRcClaims) || manifest.yarnRcClaims.length === 0) {
      throw new Error('Yarn init manifest가 .yarnrc.yml 복구 claim을 기록하지 않았습니다.')
    }
  }
}

// assertDoctorHealthy 함수는 doctor가 실행 성공뿐 아니라 healthy 상태를 보고했는지 확인한다.
function assertDoctorHealthy(manager, result) {
  if (!result.stdout.includes('Status: healthy')) {
    throw new Error(`${manager.name} doctor가 healthy 상태를 보고하지 않았습니다.`)
  }
}

// assertBuildOutput 함수는 Vite와 Electron TypeScript 빌드 산출물이 모두 생겼는지 확인한다.
function assertBuildOutput(appRoot) {
  assertPathExists(join(appRoot, 'dist', 'index.html'), 'Vite build output')
  assertPathExists(join(appRoot, 'dist-electron', 'main.js'), 'Electron main build output')
}

// assertPackagedDirectory 함수는 플랫폼별 unpacked Electron 앱 디렉터리가 실제 생성됐는지 확인한다.
function assertPackagedDirectory(appRoot) {
  const releaseRoot = join(appRoot, 'release')
  assertPathExists(releaseRoot, 'electron-builder directory output')
  const outputDirectories = readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const hasPlatformOutput = outputDirectories.some(
    (name) => name.endsWith('-unpacked') || name === 'mac' || name.startsWith('mac-'),
  )

  if (!hasPlatformOutput) {
    throw new Error(
      `electron-builder가 플랫폼 app 디렉터리를 만들지 않았습니다: ${outputDirectories.join(', ')}`,
    )
  }
}

// runManagerCase 함수는 한 매니저에서 요구한 전체 retrofit lifecycle을 순서대로 실행한다.
async function runManagerCase(manager, tarballs, registryOrigin, packageDirectory, scratchRoot) {
  const startedAt = Date.now()
  const managerVersion = await resolveManagerVersion(manager)
  const appRoot = createViteFixture(scratchRoot, manager, managerVersion, tarballs, registryOrigin)

  logStep(`${manager.name} ${managerVersion} case 시작: ${appRoot}`)
  await runManager(manager, manager.installArgs, appRoot, `${manager.name} 최초 install`)
  assertInstallLayout(manager, appRoot, 'initial')
  assertCandidateResolution(manager, appRoot, tarballs)

  await runLocalBinary(
    manager,
    'frontron',
    ['init', '--yes'],
    appRoot,
    `${manager.name} frontron init --yes`,
  )
  assertInitResult(manager, managerVersion, appRoot)

  await runManager(manager, manager.installArgs, appRoot, `${manager.name} init 후 install`)
  assertInstallLayout(manager, appRoot, 'retrofitted')
  assertCandidateResolution(manager, appRoot, tarballs)

  const doctorResult = await runLocalBinary(
    manager,
    'frontron',
    ['doctor'],
    appRoot,
    `${manager.name} frontron doctor`,
  )
  assertDoctorHealthy(manager, doctorResult)

  await runPackageScript(manager, 'frontron:build', [], appRoot, `${manager.name} frontron:build`)
  assertBuildOutput(appRoot)

  if (packageDirectory) {
    await runPackageScript(
      manager,
      'frontron:package',
      ['--dir'],
      appRoot,
      `${manager.name} electron-builder --dir`,
    )
    assertPackagedDirectory(appRoot)
  }

  return {
    name: manager.name,
    version: managerVersion,
    status: 'passed',
    seconds: (Date.now() - startedAt) / 1000,
  }
}

// formatError 함수는 Error가 아닌 throw 값도 매트릭스 요약에 안전하게 포함한다.
function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

// printSummary 함수는 all 실행에서도 성공과 실패를 매니저별로 빠짐없이 보여준다.
function printSummary(results) {
  logStep('실행 요약')

  for (const result of results) {
    const version = result.version ? ` ${result.version}` : ''
    const duration = Number.isFinite(result.seconds) ? ` (${result.seconds.toFixed(1)}s)` : ''
    console.log(`  - ${result.name}${version}: ${result.status}${duration}`)

    if (result.error) {
      console.error(`    ${result.error.split('\n').join('\n    ')}`)
    }
  }
}

// main 함수는 packed tarball 하나를 선택한 매니저 case들에 순차 적용하고 실패를 모아 보고한다.
async function main(options, scratchRoot) {
  const packageMode = options.packageDirectory
    ? 'enabled by explicit opt-in'
    : `skipped by ${process.env.CI ? 'CI' : 'local'} default (use --package to enable)`
  logStep(`electron-builder --dir: ${packageMode}`)

  const tarballs = {
    create: await packLocalPackage(packageRoot, 'create-frontron', scratchRoot),
    frontron: await packLocalPackage(frontronPackageRoot, 'frontron', scratchRoot),
  }
  const selectedManagers =
    options.selectedCase === 'all'
      ? Object.values(managerDefinitions)
      : [managerDefinitions[options.selectedCase]]
  const results = []
  const registry = await startCandidateRegistry(tarballs)

  try {
    for (const manager of selectedManagers) {
      try {
        results.push(
          await runManagerCase(
            manager,
            tarballs,
            registry.origin,
            options.packageDirectory,
            scratchRoot,
          ),
        )
      } catch (error) {
        if (interruptedSignal) {
          throw error
        }

        results.push({
          name: manager.name,
          status: 'failed',
          error: formatError(error),
        })
      }
    }
  } finally {
    await closeRegistryServer(registry.server)
    logStep('candidate registry 종료')
  }

  printSummary(results)
  const failed = results.filter((result) => result.status === 'failed')

  if (failed.length > 0) {
    throw new Error(`패키지 매니저 smoke 실패: ${failed.map((result) => result.name).join(', ')}`)
  }

  logStep(`${options.selectedCase} case 통과`)
}

let scratchRoot = null
let options = null

process.once('SIGINT', handleSigint)
process.once('SIGTERM', handleSigterm)

try {
  options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
  } else {
    scratchRoot = createScratchRoot()
    await main(options, scratchRoot)
  }
} catch (error) {
  console.error(`[pm-matrix] ${formatError(error)}`)
  process.exitCode = 1
} finally {
  if (scratchRoot && options?.keepTemporary) {
    logStep(`임시 디렉터리 보존: ${scratchRoot}`)
  } else if (scratchRoot) {
    try {
      cleanupScratchRoot(scratchRoot)
    } catch (error) {
      console.error(`[pm-matrix] 임시 디렉터리 정리 실패: ${formatError(error)}`)
      process.exitCode = 1
    }
  }
}
