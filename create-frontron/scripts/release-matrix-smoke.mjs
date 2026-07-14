import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const frontronPackageRoot = join(repoRoot, 'frontron')
const nodeRuntimeProbePath = join(packageRoot, 'scripts', 'release-matrix-node-runtime.mjs')
const tempRoot = join(tmpdir(), 'frontron-release-matrix-smoke')
const defaultDevLifecycleTimeoutMs = 120_000
const devLifecycleShutdownTimeoutMs = 15_000
const knownCases = new Set([
  'all',
  'core',
  'frameworks',
  'starter',
  'vite',
  'vitepress',
  'generic-node-server',
  'next-export',
  'next-standalone',
  'nuxt',
  'remix',
  'sveltekit-static',
  'sveltekit-node',
])

export const FIXTURE_MARKERS = Object.freeze({
  starter: 'frontron-smoke-starter',
  vite: 'frontron-smoke-vite',
  vitepress: 'frontron-smoke-vitepress',
  'generic-node-server': 'frontron-smoke-generic-node-server',
  'next-export': 'frontron-smoke-next-export',
  'next-standalone': 'frontron-smoke-next-standalone',
  nuxt: 'frontron-smoke-nuxt',
  remix: 'frontron-smoke-remix',
  'sveltekit-static': 'frontron-smoke-sveltekit-static',
  'sveltekit-node': 'frontron-smoke-sveltekit-node',
})

let scratchRoot = null
const tempRoots = []
const activeChildren = new Set()
const activeDevProcessReports = new Map()
let createTarballForRetrofit = null

// parseDevLifecycleTimeout 함수는 lifecycle timeout 옵션을 CI에서 실수하기 어려운 범위로 제한한다.
function parseDevLifecycleTimeout(value) {
  const timeoutMs = Number(value)

  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    throw new Error('Dev lifecycle timeout must be an integer between 10000 and 600000 ms.')
  }

  return timeoutMs
}

// parseArgs 함수는 case 선택과 기본 활성 dev lifecycle의 명시적 timeout 및 제외 옵션을 해석한다.
export function parseArgs(argv) {
  let selectedCase = 'all'
  let selectedCaseSeen = false
  let devLifecycle = true
  let devLifecycleTimeoutMs = defaultDevLifecycleTimeoutMs
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--skip-dev-lifecycle') {
      devLifecycle = false
    } else if (argument === '--dev-lifecycle') {
      devLifecycle = true
    } else if (argument === '--dev-lifecycle-timeout') {
      const value = argv[index + 1]

      if (value === undefined) {
        throw new Error('--dev-lifecycle-timeout requires a millisecond value.')
      }

      devLifecycleTimeoutMs = parseDevLifecycleTimeout(value)
      index += 1
    } else if (argument.startsWith('--dev-lifecycle-timeout=')) {
      devLifecycleTimeoutMs = parseDevLifecycleTimeout(argument.slice(argument.indexOf('=') + 1))
    } else if (argument === '--help' || argument === '-h') {
      help = true
    } else if (!argument.startsWith('-') && !selectedCaseSeen) {
      selectedCase = argument
      selectedCaseSeen = true
    } else {
      throw new Error(`Unknown matrix argument: ${argument}`)
    }
  }

  if (!knownCases.has(selectedCase)) {
    throw new Error(`Unknown matrix case: ${selectedCase}`)
  }

  return { selectedCase, devLifecycle, devLifecycleTimeoutMs, help }
}

// printHelp 함수는 릴리스 기본 동작과 비용 제어용 명시 옵션을 함께 안내한다.
function printHelp() {
  console.log(`Usage: node release-matrix-smoke.mjs [case] [options]

Options:
  --dev-lifecycle                 Run public framework frontron:dev smoke (default).
  --skip-dev-lifecycle            Skip only the frontron:dev lifecycle smoke.
  --dev-lifecycle-timeout <ms>    Per-fixture timeout (10000-600000, default 120000).
  -h, --help                      Show this help.`)
}

function getNpmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    }
  }

  return {
    command: 'npm',
    args,
  }
}

function logStep(message) {
  console.log(`[matrix] ${message}`)
}

function getChildEnv() {
  const nodeOptions = process.env.NODE_OPTIONS?.trim()
  return {
    ...process.env,
    CI: '1',
    NO_COLOR: '1',
    NODE_OPTIONS:
      nodeOptions?.includes('--trace-deprecation') || nodeOptions?.includes('--no-deprecation')
        ? nodeOptions
        : nodeOptions
          ? `${nodeOptions} --no-deprecation`
          : '--no-deprecation',
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: getChildEnv(),
    stdio: 'pipe',
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`)
  }
}

function runNpm(args, cwd) {
  const invocation = getNpmInvocation(args)
  run(invocation.command, invocation.args, cwd)
}

// verifyNpmDependencyTree 함수는 성공 시 긴 트리를 숨기고 실패할 때만 진단 출력을 보여 준다.
function verifyNpmDependencyTree(cwd) {
  const invocation = getNpmInvocation(['ls', '--all', '--json'])
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    env: getChildEnv(),
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`npm dependency tree validation failed in ${cwd}`)
  }
}

function installNpm(args, cwd) {
  runNpm(['install', '--fund=false', '--audit=false', '--loglevel=error', ...args], cwd)
}

// ensureScratchRoot 함수는 실제 실행이 시작될 때만 격리된 임시 루트를 만든다.
function ensureScratchRoot() {
  if (scratchRoot) return scratchRoot

  mkdirSync(tempRoot, { recursive: true })
  scratchRoot = mkdtempSync(join(tempRoot, 'run-'))
  return scratchRoot
}

function createScratchDir(prefix) {
  const root = ensureScratchRoot()
  const directory = mkdtempSync(join(root, `${prefix}-`))
  tempRoots.push(directory)
  return directory
}

function ensureBuildOutput(root) {
  runNpm(['run', 'build'], root)
}

function packPackageForReal(root, prefix) {
  ensureBuildOutput(root)

  const outputDir = createScratchDir(prefix)
  const invocation = getNpmInvocation([
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    outputDir,
  ])
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'npm pack failed')
  }

  const packResult = JSON.parse(result.stdout)
  const filename = packResult[0]?.filename

  if (!filename) {
    throw new Error('npm pack did not report an output filename')
  }

  return join(outputDir, filename)
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

// readJson 함수는 생성된 프로젝트의 계약 파일을 검증 가능한 객체로 읽는다.
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertFileExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} was not created at ${path}`)
  }
}

// addHtmlBodyMarker 함수는 정적 HTML fixture의 body에 고유 DOM 식별자를 추가한다.
function addHtmlBodyMarker(indexPath, marker) {
  const source = readFileSync(indexPath, 'utf8')

  if (source.includes('data-frontron-smoke=')) {
    throw new Error(`Renderer fixture already has a smoke marker: ${indexPath}`)
  }

  const updatedSource = source.replace(
    /<body([^>]*)>/iu,
    (_match, attributes) => `<body${attributes} data-frontron-smoke="${marker}">`,
  )

  if (updatedSource === source) {
    throw new Error(`Renderer fixture body was not found: ${indexPath}`)
  }

  writeFileSync(indexPath, updatedSource, 'utf8')
}

// findGeneratedElectronSource 함수는 starter와 retrofit의 서로 다른 Electron 소스 위치를 찾는다.
function findGeneratedElectronSource(appRoot, fileName) {
  for (const relativePath of [`src/electron/${fileName}`, `electron/${fileName}`]) {
    const sourcePath = join(appRoot, relativePath)

    if (existsSync(sourcePath)) return sourcePath
  }

  throw new Error(`Generated Electron source was not found: ${fileName}`)
}

// instrumentRendererProbe 함수는 scratch 앱의 probe에 HTTP 상태와 실제 DOM marker 수집을 추가한다.
export function instrumentRendererProbe(appRoot) {
  const mainSourcePath = findGeneratedElectronSource(appRoot, 'main.ts')
  let source = readFileSync(mainSourcePath, 'utf8')
  const originalProbeExpression = `\`({
          protocol: window.location.protocol,
          origin: window.location.origin,
          title: document.title,
          bodyText: document.body?.innerText ?? "",
          bridgeType: typeof window.electron,
        })\``
  const instrumentedProbeExpression = `\`(async () => {
          const response = await fetch(window.location.href, { cache: "no-store" })
          await response.body?.cancel()

          return {
            httpStatus: response.status,
            href: window.location.href,
            protocol: window.location.protocol,
            origin: window.location.origin,
            title: document.title,
            bodyText: document.body?.innerText ?? "",
            domMarker:
              document.querySelector("[data-frontron-smoke]")?.getAttribute(
                "data-frontron-smoke"
              ) ?? null,
            bridgeType: typeof window.electron,
          }
        })()\``
  const successfulExitNeedle = '      app.exit(0)\n'

  if (!source.includes(originalProbeExpression) || !source.includes(successfulExitNeedle)) {
    throw new Error(`Renderer probe contract was not found in ${mainSourcePath}`)
  }

  source = source.replace(originalProbeExpression, instrumentedProbeExpression)
  source = source.replace(
    successfulExitNeedle,
    `      if (process.env.FRONTRON_RENDERER_PROBE_KEEP_ALIVE !== "1") {
        app.exit(0)
      }
`,
  )
  writeFileSync(mainSourcePath, source, 'utf8')
}

// instrumentDevLifecycleProcessTracking 함수는 scratch serve.ts가 직접 띄운 두 프로세스 PID를 기록하게 한다.
export function instrumentDevLifecycleProcessTracking(appRoot) {
  const serveSourcePath = findGeneratedElectronSource(appRoot, 'serve.ts')
  let source = readFileSync(serveSourcePath, 'utf8')
  const exportsNeedle = `export const startRendererServer = startRendererRuntime
export const stopRendererServer = stopRendererRuntime
`
  const processReporter = `${exportsNeedle}
// writeDevLifecycleProcessReport 함수는 release smoke가 종료 여부를 확인할 자식 PID를 기록한다.
function writeDevLifecycleProcessReport(
  webDevProcess: ChildProcess,
  electronProcess: ChildProcess | null,
) {
  const outputPath = process.env.FRONTRON_DEV_LIFECYCLE_PROCESS_PATH?.trim()

  if (!outputPath) return

  writeFileSync(
    outputPath,
    JSON.stringify({
      webDevProcessId: webDevProcess.pid ?? null,
      electronProcessId: electronProcess?.pid ?? null,
    }) + '\\n',
    'utf8',
  )
}
`
  const webProcessNeedle = '  const webDevProcess = spawnWebDevServer()\n'
  const electronProcessNeedle = "    electronProcess.once('error', (error) => {\n"

  if (
    !source.includes(exportsNeedle) ||
    !source.includes(webProcessNeedle) ||
    !source.includes(electronProcessNeedle)
  ) {
    throw new Error(`Dev lifecycle process contract was not found in ${serveSourcePath}`)
  }

  source = source.replace(exportsNeedle, processReporter)
  source = source.replace(
    webProcessNeedle,
    `${webProcessNeedle}  writeDevLifecycleProcessReport(webDevProcess, null)\n`,
  )
  source = source.replace(
    electronProcessNeedle,
    `    writeDevLifecycleProcessReport(webDevProcess, electronProcess)\n\n${electronProcessNeedle}`,
  )
  writeFileSync(serveSourcePath, source, 'utf8')
}

// hasExpectedRendererLocation 함수는 href와 보고 origin이 같은 허용 origin을 가리키는지 검사한다.
function hasExpectedRendererLocation(report, expectedOrigins) {
  if (
    typeof report?.href !== 'string' ||
    typeof report.origin !== 'string' ||
    !expectedOrigins.includes(report.origin)
  ) {
    return false
  }

  try {
    const hrefUrl = new URL(report.href)

    return expectedOrigins.some((expectedOrigin) => {
      const expectedUrl = new URL(expectedOrigin)
      return (
        report.origin === expectedOrigin &&
        hrefUrl.protocol === expectedUrl.protocol &&
        hrefUrl.host === expectedUrl.host
      )
    })
  } catch {
    return false
  }
}

// assertRendererReport 함수는 2xx 응답, 허용 URL, 고유 DOM marker와 preload 계약을 한 번에 검증한다.
export function assertRendererReport(
  report,
  { label, expectedMarker, expectedProtocol, expectedOrigins, expectedBridgeType },
) {
  const validStatus =
    Number.isInteger(report?.httpStatus) && report.httpStatus >= 200 && report.httpStatus < 300
  const validReport =
    report?.ok === true &&
    validStatus &&
    report.protocol === expectedProtocol &&
    Array.isArray(expectedOrigins) &&
    expectedOrigins.length > 0 &&
    hasExpectedRendererLocation(report, expectedOrigins) &&
    typeof report.bodyText === 'string' &&
    report.bodyText.trim().length > 0 &&
    report.domMarker === expectedMarker &&
    report.bridgeType === expectedBridgeType

  if (!validReport) {
    throw new Error(`${label} returned an invalid report: ${JSON.stringify(report)}`)
  }
}

// findArtifactByExtension 함수는 패키징 출력에서 플랫폼별 설치 파일을 재귀적으로 찾는다.
function findArtifactByExtension(root, extension) {
  if (!existsSync(root)) return null

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)

    if (entry.isDirectory()) {
      const nestedArtifact = findArtifactByExtension(entryPath, extension)

      if (nestedArtifact) return nestedArtifact
    } else if (entry.name.toLowerCase().endsWith(extension.toLowerCase())) {
      return entryPath
    }
  }

  return null
}

// assertPackageArtifact 함수는 네이티브 패키징이 실제 배포 형식 파일을 만들었는지 확인한다.
function assertPackageArtifact(outputRoot, extension, label) {
  const artifactPath = findArtifactByExtension(outputRoot, extension)

  if (!artifactPath) {
    throw new Error(`${label} was not created under ${outputRoot}`)
  }
}

// assertDetectedAdapter 함수는 실제 프로젝트가 의도한 어댑터로 감지되었는지 확인한다.
function assertDetectedAdapter(appRoot, expectedAdapter) {
  const manifestPath = join(appRoot, '.frontron', 'manifest.json')
  assertFileExists(manifestPath, 'frontron manifest')

  const manifest = readJson(manifestPath)

  if (manifest.adapter !== expectedAdapter) {
    throw new Error(
      `Expected adapter ${expectedAdapter}, but Frontron selected ${String(manifest.adapter)}`,
    )
  }
}

// findPathBySuffix 함수는 패키징 결과처럼 플랫폼마다 상위 경로가 다른 파일을 뒤에서부터 찾는다.
function findPathBySuffix(root, suffix) {
  const normalizedSuffix = suffix.replaceAll('\\', '/')
  const entry = readdirSync(root, { recursive: true }).find((candidate) =>
    String(candidate).replaceAll('\\', '/').endsWith(normalizedSuffix),
  )

  return entry ? join(root, String(entry)) : null
}

// assertRootNodeModulesExcluded 함수는 최종 ASAR에 웹 빌드용 루트 의존성이 섞이지 않았는지 확인한다.
function assertRootNodeModulesExcluded(appRoot, outputDirectory = 'release') {
  const releaseRoot = join(appRoot, outputDirectory)
  const asarPath = findPathBySuffix(releaseRoot, 'resources/app.asar')
  const asarCliPath = findPathBySuffix(join(appRoot, 'node_modules'), '@electron/asar/bin/asar.js')

  if (!asarPath || !asarCliPath) {
    throw new Error('Packaged app.asar or the @electron/asar CLI could not be located.')
  }

  const result = spawnSync(process.execPath, [asarCliPath, 'list', asarPath], {
    cwd: appRoot,
    encoding: 'utf8',
    env: getChildEnv(),
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    throw new Error(`Failed to inspect packaged ASAR: ${result.stderr || result.stdout}`)
  }

  const rootNodeModuleEntry = result.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll('\\', '/'))
    .find((entry) => /^\/?node_modules\//u.test(entry))

  if (rootNodeModuleEntry) {
    throw new Error(`Packaged ASAR contains an unnecessary root dependency: ${rootNodeModuleEntry}`)
  }
}

// findPackagedExecutable 함수는 app.asar 위치를 기준으로 현재 OS의 실제 앱 실행 파일을 찾는다.
function findPackagedExecutable(appRoot, outputDirectory) {
  const outputRoot = join(appRoot, outputDirectory)
  const asarPath = findPathBySuffix(outputRoot, 'resources/app.asar')

  if (!asarPath) {
    throw new Error(`Packaged app.asar was not found under ${outputRoot}.`)
  }

  if (process.platform === 'darwin') {
    const contentsRoot = dirname(dirname(asarPath))
    const macOsRoot = join(contentsRoot, 'MacOS')
    const executable = readdirSync(macOsRoot)
      .map((entryName) => join(macOsRoot, entryName))
      .find((candidate) => statSync(candidate).isFile())

    if (executable) return executable
  } else {
    const appOutRoot = dirname(dirname(asarPath))
    const candidates = readdirSync(appOutRoot)
      .map((entryName) => join(appOutRoot, entryName))
      .filter((candidate) => {
        const stat = statSync(candidate)
        return (
          stat.isFile() &&
          (process.platform === 'win32'
            ? candidate.toLowerCase().endsWith('.exe')
            : (stat.mode & 0o111) !== 0)
        )
      })
      .sort((left, right) => statSync(right).size - statSync(left).size)

    if (candidates[0]) return candidates[0]
  }

  throw new Error(`Packaged Electron executable was not found under ${outputRoot}.`)
}

// assertPackagedRenderer 함수는 실제 Electron 바이너리로 HTTP 상태, custom protocol, DOM과 preload를 확인한다.
function assertPackagedRenderer(appRoot, outputDirectory, expectedMarker, expectedBridgeType) {
  const executablePath = findPackagedExecutable(appRoot, outputDirectory)
  const reportPath = join(appRoot, '.frontron-renderer-probe.json')
  const command = process.platform === 'linux' ? 'xvfb-run' : executablePath
  const args = process.platform === 'linux' ? ['-a', executablePath] : []
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...getChildEnv(),
      NODE_ENV: 'production',
      FRONTRON_RENDERER_PROBE_PATH: reportPath,
    },
    stdio: 'pipe',
    timeout: 60_000,
    windowsHide: true,
  })

  if (result.error || result.status !== 0 || !existsSync(reportPath)) {
    throw new Error(
      `Packaged renderer probe failed (${String(result.error ?? result.status)}).\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }

  const report = readJson(reportPath)
  rmSync(reportPath, { force: true })
  assertRendererReport(report, {
    label: 'Packaged renderer probe',
    expectedMarker,
    expectedProtocol: 'frontron:',
    expectedOrigins: ['frontron://app'],
    expectedBridgeType,
  })

  logStep(
    `Electron renderer probe passed: HTTP ${report.httpStatus}, ${report.origin}, ${report.domMarker}`,
  )
}

// getAvailableLoopbackPort 함수는 병렬 CI와 로컬 서비스가 충돌하지 않을 loopback 포트를 고른다.
function getAvailableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()

    server.unref()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Failed to allocate a loopback port for dev lifecycle smoke.'))
        return
      }

      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(address.port)
      })
    })
  })
}

// configureFrameworkDevServer 함수는 공식 CLI script에 고정 host와 격리 port를 명시한다.
async function configureFrameworkDevServer(appRoot, framework, enabled) {
  if (!enabled) return null

  const packageJsonPath = join(appRoot, 'package.json')
  const packageJson = readJson(packageJsonPath)
  const devCommand = packageJson.scripts?.dev

  if (typeof devCommand !== 'string' || devCommand.trim().length === 0) {
    throw new Error(`${framework} fixture does not expose a dev script.`)
  }

  const port = await getAvailableLoopbackPort()
  const host = '127.0.0.1'
  const frameworkArgs = {
    vite: `--host ${host} --port ${port} --strictPort`,
    next: `--hostname ${host} --port ${port}`,
    nuxt: `--host ${host} --port ${port}`,
    remix: `--host ${host} --port ${port} --strictPort`,
    sveltekit: `--host ${host} --port ${port} --strictPort`,
  }[framework]

  if (!frameworkArgs) {
    throw new Error(`Unsupported dev lifecycle framework: ${framework}`)
  }

  packageJson.scripts.dev = `${devCommand} ${frameworkArgs}`
  writeJson(packageJsonPath, packageJson)
  return `http://${host}:${port}`
}

// assertGeneratedDevUrl 함수는 frontron init이 수정한 dev script의 host와 port를 정확히 내장했는지 확인한다.
function assertGeneratedDevUrl(appRoot, expectedDevUrl) {
  const serveSourcePath = findGeneratedElectronSource(appRoot, 'serve.ts')
  const serveSource = readFileSync(serveSourcePath, 'utf8')
  const embeddedValue = JSON.stringify(JSON.stringify(expectedDevUrl))
  const expectedSource = `const DEV_URL = readEmbeddedJson<string>(${embeddedValue})`

  if (!serveSource.includes(expectedSource)) {
    throw new Error(`Generated frontron:dev URL does not match ${expectedDevUrl}.`)
  }
}

// createExpectedDevOrigins 함수는 같은 port의 안전한 loopback 별칭만 dev renderer에 허용한다.
function createExpectedDevOrigins(expectedDevUrl) {
  const expectedUrl = new URL(expectedDevUrl)
  const origins = new Set([expectedUrl.origin])

  if (['127.0.0.1', 'localhost', '[::1]'].includes(expectedUrl.hostname)) {
    for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) {
      const candidate = new URL(expectedUrl)
      candidate.hostname = hostname
      origins.add(candidate.origin)
    }
  }

  return [...origins]
}

// getDevLifecycleInvocation 함수는 Linux에서 Electron을 가상 display와 함께 실행한다.
function getDevLifecycleInvocation() {
  const npmInvocation = getNpmInvocation(['run', 'frontron:dev'])

  if (process.platform !== 'linux') return npmInvocation

  return {
    command: 'xvfb-run',
    args: ['-a', npmInvocation.command, ...npmInvocation.args],
  }
}

// isChildProcessRunning 함수는 종료 이벤트 전인 상위 lifecycle 명령을 판별한다.
function isChildProcessRunning(child) {
  return Boolean(child?.pid) && child.exitCode === null && child.signalCode === null
}

// terminateProcessTreeById 함수는 플랫폼별 도구로 기록된 PID의 전체 프로세스 트리를 강제 종료한다.
function terminateProcessTreeById(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(processId), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  try {
    process.kill(-processId, 'SIGKILL')
  } catch {
    try {
      process.kill(processId, 'SIGKILL')
    } catch {
      return
    }
  }
}

// terminateProcessTree 함수는 timeout이나 인터럽트 때 최상위 npm 명령 아래 프로세스를 정리한다.
function terminateProcessTree(child) {
  if (!isChildProcessRunning(child)) return
  terminateProcessTreeById(child.pid)
}

// isProcessTreeRunning 함수는 POSIX process group 또는 Windows root PID가 아직 남았는지 확인한다.
function isProcessTreeRunning(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false

  try {
    process.kill(process.platform === 'win32' ? processId : -processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// readDevLifecycleProcessReport 함수는 계측된 serve.ts가 기록한 웹 서버와 Electron PID를 읽는다.
function readDevLifecycleProcessReport(reportPath) {
  if (typeof reportPath !== 'string' || !existsSync(reportPath)) return null

  try {
    const report = readJson(reportPath)
    return {
      webDevProcessId: Number.isInteger(report.webDevProcessId) ? report.webDevProcessId : null,
      electronProcessId: Number.isInteger(report.electronProcessId)
        ? report.electronProcessId
        : null,
    }
  } catch {
    return null
  }
}

// terminateRecordedDevProcesses 함수는 상위 명령과 분리된 웹 서버 및 Electron process group도 정리한다.
function terminateRecordedDevProcesses(reportPath) {
  const report = readDevLifecycleProcessReport(reportPath)

  if (!report) return

  terminateProcessTreeById(report.electronProcessId)
  terminateProcessTreeById(report.webDevProcessId)
}

// isHttpUrlReachable 함수는 상태 코드와 무관하게 dev server listener가 아직 살아 있는지 확인한다.
async function isHttpUrlReachable(urlString) {
  try {
    const response = await fetch(urlString, {
      redirect: 'manual',
      signal: AbortSignal.timeout(750),
    })
    await response.body?.cancel()
    return true
  } catch {
    return false
  }
}

// waitForDevLifecycleShutdown 함수는 명령, 직접 자식 process group과 dev port가 모두 닫힐 때까지 기다린다.
async function waitForDevLifecycleShutdown(child, processReportPath, devUrl) {
  const deadline = Date.now() + devLifecycleShutdownTimeoutMs

  while (Date.now() < deadline) {
    const processReport = readDevLifecycleProcessReport(processReportPath)
    const childStopped = !isChildProcessRunning(child)
    const webStopped = !isProcessTreeRunning(processReport?.webDevProcessId)
    const electronStopped = !isProcessTreeRunning(processReport?.electronProcessId)
    const urlStopped = !(await isHttpUrlReachable(devUrl))

    if (childStopped && webStopped && electronStopped && urlStopped) return

    await delay(250)
  }

  terminateProcessTree(child)
  terminateRecordedDevProcesses(processReportPath)
  await delay(1_000)

  const processReport = readDevLifecycleProcessReport(processReportPath)
  const leftovers = [
    isChildProcessRunning(child) ? `command:${child.pid}` : null,
    isProcessTreeRunning(processReport?.webDevProcessId)
      ? `web:${processReport.webDevProcessId}`
      : null,
    isProcessTreeRunning(processReport?.electronProcessId)
      ? `electron:${processReport.electronProcessId}`
      : null,
    (await isHttpUrlReachable(devUrl)) ? `url:${devUrl}` : null,
  ].filter(Boolean)

  if (leftovers.length > 0) {
    throw new Error(`Dev lifecycle left running resources: ${leftovers.join(', ')}`)
  }

  throw new Error('Dev lifecycle required forced process-tree cleanup.')
}

// waitForDevLifecycleProbe 함수는 timeout 안에 renderer 결과와 두 직접 자식 PID가 모두 기록되길 기다린다.
async function waitForDevLifecycleProbe(child, rendererReportPath, processReportPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let spawnError = null
  child.once('error', (error) => {
    spawnError = error
  })

  while (Date.now() < deadline) {
    const processReport = readDevLifecycleProcessReport(processReportPath)

    if (
      existsSync(rendererReportPath) &&
      processReport?.webDevProcessId &&
      processReport.electronProcessId
    ) {
      return
    }

    if (spawnError) throw spawnError

    if (!isChildProcessRunning(child)) {
      throw new Error('frontron:dev exited before renderer readiness was reported.')
    }

    await delay(50)
  }

  throw new Error(`frontron:dev timed out after ${timeoutMs}ms before renderer readiness.`)
}

// runDevLifecycleSmoke 함수는 실제 frontron:dev의 readiness, URL, DOM과 종료 전파를 검증한다.
async function runDevLifecycleSmoke({ appRoot, expectedDevUrl, expectedMarker, timeoutMs }) {
  assertGeneratedDevUrl(appRoot, expectedDevUrl)

  const rendererReportPath = join(appRoot, '.frontron-dev-renderer-probe.json')
  const processReportPath = join(appRoot, '.frontron-dev-process-probe.json')
  const invocation = getDevLifecycleInvocation()
  let child = null
  let rendererReport = null

  rmSync(rendererReportPath, { force: true })
  rmSync(processReportPath, { force: true })

  if (await isHttpUrlReachable(expectedDevUrl)) {
    throw new Error(`Dev lifecycle URL is already occupied: ${expectedDevUrl}`)
  }

  logStep(`frontron:dev lifecycle: ${expectedDevUrl} (${expectedMarker})`)

  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: appRoot,
      detached: process.platform !== 'win32',
      env: {
        ...getChildEnv(),
        FRONTRON_RENDERER_PROBE_KEEP_ALIVE: '1',
        FRONTRON_RENDERER_PROBE_PATH: rendererReportPath,
        FRONTRON_DEV_LIFECYCLE_PROCESS_PATH: processReportPath,
      },
      stdio: 'inherit',
      windowsHide: true,
    })
    activeChildren.add(child)
    activeDevProcessReports.set(child, processReportPath)
    child.once('close', () => activeChildren.delete(child))

    await waitForDevLifecycleProbe(child, rendererReportPath, processReportPath, timeoutMs)

    assertFileExists(rendererReportPath, 'dev renderer probe report')
    assertFileExists(processReportPath, 'dev process probe report')
    rendererReport = readJson(rendererReportPath)
    const processReport = readDevLifecycleProcessReport(processReportPath)

    if (!processReport?.webDevProcessId || !processReport.electronProcessId) {
      throw new Error(
        `Dev lifecycle did not report both child PIDs: ${JSON.stringify(processReport)}`,
      )
    }

    assertRendererReport(rendererReport, {
      label: 'Dev renderer probe',
      expectedMarker,
      expectedProtocol: 'http:',
      expectedOrigins: createExpectedDevOrigins(expectedDevUrl),
      expectedBridgeType: 'object',
    })
  } finally {
    if (child) {
      terminateProcessTree(child)
      terminateRecordedDevProcesses(processReportPath)
      await waitForDevLifecycleShutdown(child, processReportPath, expectedDevUrl)
      activeChildren.delete(child)
      activeDevProcessReports.delete(child)
    }

    rmSync(rendererReportPath, { force: true })
    rmSync(processReportPath, { force: true })
  }

  logStep(
    `frontron:dev lifecycle passed: HTTP ${rendererReport.httpStatus}, ${rendererReport.origin}, processes stopped`,
  )
}

// logFrameworkVersions 함수는 최신 생성기 변화로 실패했을 때 재현할 버전을 출력한다.
function logFrameworkVersions(appRoot, dependencyNames) {
  const packageJson = readJson(join(appRoot, 'package.json'))
  const versions = dependencyNames
    .map(
      (name) =>
        `${name}@${packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? 'missing'}`,
    )
    .join(', ')

  logStep(`resolved framework versions: ${versions}`)
}

// runRetrofitLifecycle 함수는 실제 앱에서 dev lifecycle부터 패키징 직전 정리 검증까지 수행한다.
async function runRetrofitLifecycle({
  appRoot,
  frontronTarball,
  expectedAdapter,
  expectedMarker,
  initArgs = [],
  frameworkDependencies = [],
  expectedRuntimePaths = [],
  nodeRuntimeProbe = null,
  expectRootNodeModulesExcluded = false,
  devLifecycle = null,
}) {
  installNpm([], appRoot)
  installNpm(
    [
      '--save-dev',
      '--ignore-scripts',
      ...(createTarballForRetrofit ? [createTarballForRetrofit] : []),
      frontronTarball,
    ],
    appRoot,
  )
  runNpm(['exec', '--', 'frontron', 'init', '--yes', ...initArgs], appRoot)
  installNpm([], appRoot)
  verifyNpmDependencyTree(appRoot)

  assertDetectedAdapter(appRoot, expectedAdapter)
  logFrameworkVersions(appRoot, frameworkDependencies)
  runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)
  runNpm(['exec', '--', 'frontron', 'update', '--yes'], appRoot)
  runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)
  instrumentRendererProbe(appRoot)

  if (devLifecycle) {
    instrumentDevLifecycleProcessTracking(appRoot)
    await runDevLifecycleSmoke({
      appRoot,
      expectedDevUrl: devLifecycle.url,
      expectedMarker,
      timeoutMs: devLifecycle.timeoutMs,
    })
  }

  runNpm(['run', 'frontron:build'], appRoot)

  for (const runtimePath of expectedRuntimePaths) {
    assertFileExists(join(appRoot, runtimePath), `prepared runtime path ${runtimePath}`)
  }

  if (nodeRuntimeProbe) {
    run(
      process.execPath,
      [nodeRuntimeProbePath, '--root', nodeRuntimeProbe.root, '--entry', nodeRuntimeProbe.entry],
      appRoot,
    )
  }

  runNpm(['run', 'frontron:package', '--', '--dir'], appRoot)
  assertFileExists(join(appRoot, 'release'), 'Electron package directory')

  if (nodeRuntimeProbe) {
    const packagedRuntimeRoot = findPathBySuffix(
      join(appRoot, 'release'),
      `resources/app.asar.unpacked/${nodeRuntimeProbe.root}`,
    )

    if (!packagedRuntimeRoot) {
      throw new Error(`Packaged node runtime was not found: ${nodeRuntimeProbe.root}`)
    }

    run(
      process.execPath,
      [nodeRuntimeProbePath, '--root', packagedRuntimeRoot, '--entry', nodeRuntimeProbe.entry],
      appRoot,
    )
  }

  assertPackagedRenderer(appRoot, 'release', expectedMarker, 'object')

  if (expectRootNodeModulesExcluded) {
    assertRootNodeModulesExcluded(appRoot)
  }

  runNpm(['exec', '--', 'frontron', 'clean', '--dry-run'], appRoot)
}

// writeNextFixtureMarker 함수는 App Router 첫 route가 fixture 고유 DOM marker를 직접 렌더링하게 한다.
function writeNextFixtureMarker(appRoot, marker) {
  writeFileSync(
    join(appRoot, 'src', 'app', 'page.tsx'),
    `export default function Page() {
  return <main data-frontron-smoke="${marker}">${marker}</main>
}
`,
    'utf8',
  )
}

// writeNuxtFixtureMarker 함수는 Nuxt v4 공식 app entry를 최소 marker 화면으로 바꾼다.
function writeNuxtFixtureMarker(appRoot, marker) {
  const candidates = [join(appRoot, 'app', 'app.vue'), join(appRoot, 'app.vue')]
  const appSourcePath = candidates.find((candidate) => existsSync(candidate))

  if (!appSourcePath) {
    throw new Error('Nuxt fixture app entry was not found.')
  }

  writeFileSync(
    appSourcePath,
    `<template>
  <main data-frontron-smoke="${marker}">${marker}</main>
</template>
`,
    'utf8',
  )
}

// writeRemixFixtureMarker 함수는 공식 Remix index route가 고유 marker를 직접 렌더링하게 한다.
function writeRemixFixtureMarker(appRoot, marker) {
  writeFileSync(
    join(appRoot, 'app', 'routes', '_index.tsx'),
    `export default function Index() {
  return <main data-frontron-smoke="${marker}">${marker}</main>
}
`,
    'utf8',
  )
}

// writeSvelteKitFixtureMarker 함수는 공식 SvelteKit 첫 route에 고유 marker를 렌더링한다.
function writeSvelteKitFixtureMarker(appRoot, marker) {
  const routesRoot = join(appRoot, 'src', 'routes')
  mkdirSync(routesRoot, { recursive: true })
  writeFileSync(
    join(routesRoot, '+page.svelte'),
    `<main data-frontron-smoke="${marker}">${marker}</main>\n`,
    'utf8',
  )
}

// createVitePressProject 함수는 패키징 marker가 포함된 최소 VitePress fixture를 만든다.
function createVitePressProject(appRoot, marker) {
  const docsRoot = join(appRoot, 'docs')
  const vitepressRoot = join(docsRoot, '.vitepress')

  mkdirSync(vitepressRoot, { recursive: true })

  writeJson(join(appRoot, 'package.json'), {
    name: 'matrix-vitepress-app',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      'docs:dev': 'vitepress dev docs',
      'docs:build': 'vitepress build docs',
    },
  })

  writeFileSync(
    join(docsRoot, 'index.md'),
    `# Matrix VitePress App\n\n<div data-frontron-smoke="${marker}">${marker}</div>\n`,
  )

  writeFileSync(
    join(vitepressRoot, 'config.mts'),
    `import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Matrix VitePress App',
  description: 'Release matrix smoke fixture',
})
`,
  )
}

function runStarterCase(createTarball) {
  logStep('starter case: packed create-frontron -> typecheck -> native installers')

  const root = createScratchDir('starter')
  const appName = 'matrix-starter-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS.starter

  runNpm(['init', '-y'], root)
  installNpm(['--ignore-scripts', createTarball], root)

  runNpm(['exec', '--', 'create-frontron', appName, '--overwrite', 'yes'], root)
  addHtmlBodyMarker(join(appRoot, 'index.html'), marker)
  instrumentRendererProbe(appRoot)
  installNpm([], appRoot)
  runNpm(['run', 'typecheck'], appRoot)
  const buildArgs =
    process.platform === 'win32'
      ? ['run', 'build']
      : process.platform === 'darwin'
        ? ['run', 'build', '--', '--mac', 'dmg', 'zip', '--publish', 'never']
        : ['run', 'build', '--', '--linux', 'AppImage', 'deb', '--publish', 'never']

  runNpm(buildArgs, appRoot)
  assertPackagedRenderer(appRoot, 'output', marker, 'object')
  assertRootNodeModulesExcluded(appRoot, 'output')

  if (process.platform === 'win32') {
    assertFileExists(join(appRoot, 'output', `${appName}-0.0.0-x64.msi`), 'starter MSI package')
    assertFileExists(join(appRoot, 'output', `${appName}.exe`), 'starter portable package')
  } else if (process.platform === 'darwin') {
    assertPackageArtifact(join(appRoot, 'output'), '.dmg', 'starter DMG package')
    assertPackageArtifact(join(appRoot, 'output'), '.zip', 'starter macOS ZIP package')
  } else {
    assertPackageArtifact(join(appRoot, 'output'), '.AppImage', 'starter AppImage package')
    assertPackageArtifact(join(appRoot, 'output'), '.deb', 'starter Debian package')
  }
}

async function runViteCase(frontronTarball, options) {
  logStep('vite case: existing Vite app -> init -> frontron:build -> package directory')

  const root = createScratchDir('vite')
  const appName = 'matrix-vite-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS.vite

  runNpm(['create', 'vite@latest', appName, '--', '--template', 'react-ts'], root)
  addHtmlBodyMarker(join(appRoot, 'index.html'), marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'vite', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-static',
    expectedMarker: marker,
    frameworkDependencies: ['vite', 'react'],
    expectedRuntimePaths: ['dist/index.html'],
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

async function runVitePressCase(frontronTarball) {
  logStep('vitepress case: existing docs app -> init -> frontron:build -> package directory')

  const appRoot = createScratchDir('vitepress')
  const marker = FIXTURE_MARKERS.vitepress

  createVitePressProject(appRoot, marker)
  installNpm(['--save-dev', 'vitepress'], appRoot)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-static',
    expectedMarker: marker,
    initArgs: [
      '--web-dev',
      'docs:dev',
      '--web-build',
      'docs:build',
      '--out-dir',
      'docs/.vitepress/dist',
    ],
    frameworkDependencies: ['vitepress'],
    expectedRuntimePaths: ['docs/.vitepress/dist/index.html'],
    expectRootNodeModulesExcluded: true,
  })
}

async function runGenericNodeServerCase(frontronTarball) {
  logStep('generic-node-server case: custom node runtime -> init -> package directory')

  const appRoot = createScratchDir('generic-node-server')
  const scriptsRoot = join(appRoot, 'scripts')
  const marker = FIXTURE_MARKERS['generic-node-server']
  mkdirSync(scriptsRoot, { recursive: true })

  writeJson(join(appRoot, 'package.json'), {
    name: 'matrix-generic-node-server-app',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'node scripts/dev-server.mjs',
      build: 'node scripts/build.mjs',
    },
  })

  writeFileSync(
    join(scriptsRoot, 'dev-server.mjs'),
    `import { createServer } from 'node:http'

const server = createServer((_request, response) => {
  response.end('ok')
})

server.listen(4217, '127.0.0.1')
`,
  )

  writeFileSync(
    join(scriptsRoot, 'build.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const serverRoot = join(process.cwd(), '.output', 'server')
mkdirSync(serverRoot, { recursive: true })
writeFileSync(
  join(serverRoot, 'index.mjs'),
  \`import { createServer } from 'node:http'

const port = Number(process.env.PORT)
const host = process.env.HOST || '127.0.0.1'

if (!Number.isInteger(port) || port < 1) {
  throw new Error('PORT must be a positive integer')
}

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(${JSON.stringify(
    `<!doctype html><html><body><main data-frontron-smoke="${marker}">${marker}</main></body></html>`,
  )})
})

server.listen(port, host)
\`,
)
`,
  )

  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-node-server',
    expectedMarker: marker,
    initArgs: [
      '--adapter',
      'generic-node-server',
      '--server-root',
      '.output',
      '--server-entry',
      'server/index.mjs',
    ],
  })
}

// createNextProject 함수는 공식 create-next-app으로 재현 가능한 최신 App Router 앱을 만든다.
function createNextProject(root, appName, output) {
  runNpm(
    [
      'exec',
      '--yes',
      'create-next-app@latest',
      '--',
      appName,
      '--ts',
      '--eslint',
      '--app',
      '--src-dir',
      '--use-npm',
      '--empty',
      '--disable-git',
      '--skip-install',
      '--yes',
    ],
    root,
  )

  writeFileSync(
    join(root, appName, 'next.config.ts'),
    `import type { NextConfig } from 'next'\n\nconst nextConfig: NextConfig = {\n  output: '${output}',\n}\n\nexport default nextConfig\n`,
  )
}

// runNextExportCase 함수는 Next 정적 export를 실제 패키지 디렉터리까지 검증한다.
async function runNextExportCase(frontronTarball, options) {
  logStep('next-export case: official create-next-app -> static export -> package directory')

  const root = createScratchDir('next-export')
  const appName = 'matrix-next-export-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS['next-export']

  createNextProject(root, appName, 'export')
  writeNextFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'next', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'next-export',
    expectedMarker: marker,
    frameworkDependencies: ['next', 'react'],
    expectedRuntimePaths: ['out/index.html'],
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

// runNextStandaloneCase 함수는 Next standalone Node 런타임 복사와 패키징을 검증한다.
async function runNextStandaloneCase(frontronTarball, options) {
  logStep(
    'next-standalone case: official create-next-app -> standalone server -> package directory',
  )

  const root = createScratchDir('next-standalone')
  const appName = 'matrix-next-standalone-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS['next-standalone']

  createNextProject(root, appName, 'standalone')
  writeNextFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'next', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'next-standalone',
    expectedMarker: marker,
    frameworkDependencies: ['next', 'react'],
    expectedRuntimePaths: [
      '.frontron/runtime/next-standalone/server.js',
      '.frontron/runtime/next-standalone/.next/static',
    ],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/next-standalone',
      entry: 'server.js',
    },
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

// runNuxtCase 함수는 공식 create-nuxt의 최신 Node 서버 출력을 패키징한다.
async function runNuxtCase(frontronTarball, options) {
  logStep('nuxt case: official create-nuxt -> Nitro node server -> package directory')

  const root = createScratchDir('nuxt')
  const appName = 'matrix-nuxt-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS.nuxt

  runNpm(
    [
      'exec',
      '--yes',
      'create-nuxt@latest',
      '--',
      appName,
      '--template',
      'v4',
      '--packageManager',
      'npm',
      '--gitInit=false',
      '--no-install',
    ],
    root,
  )

  writeNuxtFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'nuxt', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'nuxt-node-server',
    expectedMarker: marker,
    frameworkDependencies: ['nuxt', 'vue'],
    expectedRuntimePaths: ['.frontron/runtime/nuxt-node-server/server/index.mjs'],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/nuxt-node-server',
      entry: 'server/index.mjs',
    },
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

// runRemixCase 함수는 유지보수 중인 Remix v2 공식 기본 템플릿을 고정 버전으로 검증한다.
async function runRemixCase(frontronTarball, options) {
  logStep('remix case: official Remix v2 template -> Remix App Server -> package directory')

  const root = createScratchDir('remix')
  const appName = 'matrix-remix-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS.remix

  runNpm(
    [
      'exec',
      '--yes',
      'create-remix@2.16.8',
      '--',
      appName,
      '--template',
      'https://github.com/remix-run/remix/tree/remix%402.16.8/templates/remix',
      '--no-install',
      '--no-git-init',
      '--yes',
    ],
    root,
  )

  writeRemixFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'remix', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'remix-node-server',
    expectedMarker: marker,
    frameworkDependencies: ['@remix-run/dev', '@remix-run/node'],
    expectedRuntimePaths: [
      '.frontron/runtime/remix-node-server/server.cjs',
      '.frontron/runtime/remix-node-server/server-build.mjs',
      '.frontron/runtime/remix-node-server/THIRD_PARTY_LICENSES.json',
      '.frontron/runtime/remix-node-server/build/server/index.js',
    ],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/remix-node-server',
      entry: 'server.cjs',
    },
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })

  const licenseManifest = readJson(
    join(appRoot, '.frontron/runtime/remix-node-server/THIRD_PARTY_LICENSES.json'),
  )

  if (
    !Array.isArray(licenseManifest.packages) ||
    !licenseManifest.packages.some((entry) => entry?.name === '@remix-run/serve')
  ) {
    throw new Error('Remix bundle license manifest does not include @remix-run/serve.')
  }
}

// createSvelteKitProject 함수는 공식 sv CLI와 adapter add-on으로 앱을 만든다.
function createSvelteKitProject(root, appName, adapter) {
  runNpm(
    [
      'exec',
      '--yes',
      'sv@latest',
      '--',
      'create',
      appName,
      '--template',
      'minimal',
      '--types',
      'ts',
      '--add',
      `sveltekit-adapter=adapter:${adapter}`,
      '--no-install',
      '--no-download-check',
    ],
    root,
  )

  if (adapter === 'static') {
    const routesRoot = join(root, appName, 'src', 'routes')
    mkdirSync(routesRoot, { recursive: true })
    writeFileSync(join(routesRoot, '+layout.ts'), 'export const prerender = true\n', 'utf8')
  }
}

// runSvelteKitStaticCase 함수는 SvelteKit prerender 출력을 정적 런타임으로 검증한다.
async function runSvelteKitStaticCase(frontronTarball, options) {
  logStep('sveltekit-static case: official sv template -> static adapter -> package directory')

  const root = createScratchDir('sveltekit-static')
  const appName = 'matrix-sveltekit-static-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS['sveltekit-static']

  createSvelteKitProject(root, appName, 'static')
  writeSvelteKitFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'sveltekit', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'sveltekit-static',
    expectedMarker: marker,
    frameworkDependencies: ['@sveltejs/kit', '@sveltejs/adapter-static'],
    expectedRuntimePaths: ['build/index.html'],
    expectRootNodeModulesExcluded: true,
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

// runSvelteKitNodeCase 함수는 SvelteKit adapter-node 서버 출력을 패키징한다.
async function runSvelteKitNodeCase(frontronTarball, options) {
  logStep('sveltekit-node case: official sv template -> node adapter -> package directory')

  const root = createScratchDir('sveltekit-node')
  const appName = 'matrix-sveltekit-node-app'
  const appRoot = join(root, appName)
  const marker = FIXTURE_MARKERS['sveltekit-node']

  createSvelteKitProject(root, appName, 'node')
  writeSvelteKitFixtureMarker(appRoot, marker)
  const devUrl = await configureFrameworkDevServer(appRoot, 'sveltekit', options.devLifecycle)
  await runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'sveltekit-node',
    expectedMarker: marker,
    frameworkDependencies: ['@sveltejs/kit', '@sveltejs/adapter-node'],
    expectedRuntimePaths: ['.frontron/runtime/sveltekit-node/index.js'],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/sveltekit-node',
      entry: 'index.js',
    },
    devLifecycle: devUrl ? { url: devUrl, timeoutMs: options.devLifecycleTimeoutMs } : null,
  })
}

// main 함수는 선택 case를 순차 실행하며 릴리스 기본 경로에서는 dev lifecycle을 유지한다.
async function main(options) {
  const { selectedCase } = options
  logStep(
    options.devLifecycle
      ? `frontron:dev lifecycle enabled (timeout ${options.devLifecycleTimeoutMs}ms)`
      : 'frontron:dev lifecycle skipped by explicit option',
  )
  const createTarball = packPackageForReal(packageRoot, 'create-frontron-matrix-')
  createTarballForRetrofit = createTarball
  const frontronTarball =
    selectedCase === 'starter' ? null : packPackageForReal(frontronPackageRoot, 'frontron-matrix-')
  const cases = [
    {
      name: 'starter',
      group: 'core',
      run: () => runStarterCase(createTarball),
    },
    {
      name: 'vite',
      group: 'core',
      run: () => runViteCase(frontronTarball, options),
    },
    {
      name: 'vitepress',
      group: 'core',
      run: () => runVitePressCase(frontronTarball),
    },
    {
      name: 'generic-node-server',
      group: 'core',
      run: () => runGenericNodeServerCase(frontronTarball),
    },
    {
      name: 'next-export',
      group: 'frameworks',
      run: () => runNextExportCase(frontronTarball, options),
    },
    {
      name: 'next-standalone',
      group: 'frameworks',
      run: () => runNextStandaloneCase(frontronTarball, options),
    },
    {
      name: 'nuxt',
      group: 'frameworks',
      run: () => runNuxtCase(frontronTarball, options),
    },
    {
      name: 'remix',
      group: 'frameworks',
      run: () => runRemixCase(frontronTarball, options),
    },
    {
      name: 'sveltekit-static',
      group: 'frameworks',
      run: () => runSvelteKitStaticCase(frontronTarball, options),
    },
    {
      name: 'sveltekit-node',
      group: 'frameworks',
      run: () => runSvelteKitNodeCase(frontronTarball, options),
    },
  ]

  for (const matrixCase of cases) {
    if (
      selectedCase === 'all' ||
      selectedCase === matrixCase.group ||
      selectedCase === matrixCase.name
    ) {
      await matrixCase.run()
    }
  }

  logStep(`${selectedCase} matrix cases passed`)
}

// cleanupTemporaryDirectories 함수는 현재 실행이 만든 scratch 경로만 재시도와 함께 제거한다.
function cleanupTemporaryDirectories() {
  for (const tempDir of tempRoots.splice(0)) {
    rmSync(resolve(tempDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }

  if (scratchRoot) {
    rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    scratchRoot = null
  }

  if (existsSync(tempRoot) && readdirSync(tempRoot).length === 0) {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

// handleInterruption 함수는 종료 신호가 와도 실행 중인 Electron과 분리된 자식 트리를 남기지 않는다.
function handleInterruption(signal) {
  console.error(`[matrix] ${signal} received; terminating active dev lifecycle processes.`)

  for (const child of activeChildren) {
    terminateProcessTree(child)
    terminateRecordedDevProcesses(activeDevProcessReports.get(child))
  }
}

// handleSigint 함수는 Ctrl+C를 공통 프로세스 트리 정리로 전달한다.
function handleSigint() {
  handleInterruption('SIGINT')
}

// handleSigterm 함수는 CI 취소 신호를 공통 프로세스 트리 정리로 전달한다.
function handleSigterm() {
  handleInterruption('SIGTERM')
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isDirectExecution) {
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    const options = parseArgs(process.argv.slice(2))

    if (options.help) printHelp()
    else await main(options)
  } finally {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    cleanupTemporaryDirectories()
  }
}
