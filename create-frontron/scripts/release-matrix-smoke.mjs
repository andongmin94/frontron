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
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const frontronPackageRoot = join(repoRoot, 'frontron')
const nodeRuntimeProbePath = join(packageRoot, 'scripts', 'release-matrix-node-runtime.mjs')
const tempRoot = join(tmpdir(), 'frontron-release-matrix-smoke')
mkdirSync(tempRoot, { recursive: true })
const scratchRoot = mkdtempSync(join(tempRoot, 'run-'))
const tempRoots = []
let createTarballForRetrofit = null

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

function createScratchDir(prefix) {
  mkdirSync(scratchRoot, { recursive: true })
  const directory = mkdtempSync(join(scratchRoot, `${prefix}-`))
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

// assertPackagedRenderer 함수는 실제 Electron 바이너리로 custom protocol과 DOM, preload 상태를 확인한다.
function assertPackagedRenderer(appRoot, outputDirectory, expectedBridgeType) {
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

  if (
    report.ok !== true ||
    report.protocol !== 'frontron:' ||
    report.origin !== 'frontron://app' ||
    typeof report.bodyText !== 'string' ||
    report.bodyText.trim().length === 0 ||
    report.bridgeType !== expectedBridgeType
  ) {
    throw new Error(`Packaged renderer probe returned an invalid report: ${JSON.stringify(report)}`)
  }

  logStep(`Electron renderer probe passed: ${report.origin} (${report.bridgeType})`)
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

// runRetrofitLifecycle 함수는 실제 앱에서 설치부터 패키징 직전 정리 검증까지 수행한다.
function runRetrofitLifecycle({
  appRoot,
  frontronTarball,
  expectedAdapter,
  initArgs = [],
  frameworkDependencies = [],
  expectedRuntimePaths = [],
  nodeRuntimeProbe = null,
  expectRootNodeModulesExcluded = false,
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

  assertPackagedRenderer(appRoot, 'release', 'undefined')

  if (expectRootNodeModulesExcluded) {
    assertRootNodeModulesExcluded(appRoot)
  }

  runNpm(['exec', '--', 'frontron', 'clean', '--dry-run'], appRoot)
}

function createVitePressProject(appRoot) {
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
    '# Matrix VitePress App\n\nThis is a minimal VitePress site for Frontron release matrix smoke tests.\n',
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

  runNpm(['init', '-y'], root)
  installNpm(['--ignore-scripts', createTarball], root)

  runNpm(['exec', '--', 'create-frontron', appName, '--overwrite', 'yes'], root)
  installNpm([], appRoot)
  runNpm(['run', 'typecheck'], appRoot)
  const buildArgs =
    process.platform === 'win32'
      ? ['run', 'build']
      : process.platform === 'darwin'
        ? ['run', 'build', '--', '--mac', 'dmg', 'zip', '--publish', 'never']
        : ['run', 'build', '--', '--linux', 'AppImage', 'deb', '--publish', 'never']

  runNpm(buildArgs, appRoot)
  assertPackagedRenderer(appRoot, 'output', 'object')
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

function runViteCase(frontronTarball) {
  logStep('vite case: existing Vite app -> init -> frontron:build -> package directory')

  const root = createScratchDir('vite')
  const appName = 'matrix-vite-app'
  const appRoot = join(root, appName)

  runNpm(['create', 'vite@latest', appName, '--', '--template', 'react-ts'], root)
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-static',
    frameworkDependencies: ['vite', 'react'],
    expectedRuntimePaths: ['dist/index.html'],
    expectRootNodeModulesExcluded: true,
  })
}

function runVitePressCase(frontronTarball) {
  logStep('vitepress case: existing docs app -> init -> frontron:build -> package directory')

  const appRoot = createScratchDir('vitepress')

  createVitePressProject(appRoot)
  installNpm(['--save-dev', 'vitepress'], appRoot)
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-static',
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

function runGenericNodeServerCase(frontronTarball) {
  logStep('generic-node-server case: custom node runtime -> init -> package directory')

  const appRoot = createScratchDir('generic-node-server')
  const scriptsRoot = join(appRoot, 'scripts')
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
writeFileSync(join(serverRoot, 'index.mjs'), "console.log('generic node server')\\n")
`,
  )

  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'generic-node-server',
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
function runNextExportCase(frontronTarball) {
  logStep('next-export case: official create-next-app -> static export -> package directory')

  const root = createScratchDir('next-export')
  const appName = 'matrix-next-export-app'
  const appRoot = join(root, appName)

  createNextProject(root, appName, 'export')
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'next-export',
    frameworkDependencies: ['next', 'react'],
    expectedRuntimePaths: ['out/index.html'],
    expectRootNodeModulesExcluded: true,
  })
}

// runNextStandaloneCase 함수는 Next standalone Node 런타임 복사와 패키징을 검증한다.
function runNextStandaloneCase(frontronTarball) {
  logStep(
    'next-standalone case: official create-next-app -> standalone server -> package directory',
  )

  const root = createScratchDir('next-standalone')
  const appName = 'matrix-next-standalone-app'
  const appRoot = join(root, appName)

  createNextProject(root, appName, 'standalone')
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'next-standalone',
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
  })
}

// runNuxtCase 함수는 공식 create-nuxt의 최신 Node 서버 출력을 패키징한다.
function runNuxtCase(frontronTarball) {
  logStep('nuxt case: official create-nuxt -> Nitro node server -> package directory')

  const root = createScratchDir('nuxt')
  const appName = 'matrix-nuxt-app'
  const appRoot = join(root, appName)

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

  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'nuxt-node-server',
    frameworkDependencies: ['nuxt', 'vue'],
    expectedRuntimePaths: ['.frontron/runtime/nuxt-node-server/server/index.mjs'],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/nuxt-node-server',
      entry: 'server/index.mjs',
    },
    expectRootNodeModulesExcluded: true,
  })
}

// runRemixCase 함수는 유지보수 중인 Remix v2 공식 기본 템플릿을 고정 버전으로 검증한다.
function runRemixCase(frontronTarball) {
  logStep('remix case: official Remix v2 template -> Remix App Server -> package directory')

  const root = createScratchDir('remix')
  const appName = 'matrix-remix-app'
  const appRoot = join(root, appName)

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

  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'remix-node-server',
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
function runSvelteKitStaticCase(frontronTarball) {
  logStep('sveltekit-static case: official sv template -> static adapter -> package directory')

  const root = createScratchDir('sveltekit-static')
  const appName = 'matrix-sveltekit-static-app'
  const appRoot = join(root, appName)

  createSvelteKitProject(root, appName, 'static')
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'sveltekit-static',
    frameworkDependencies: ['@sveltejs/kit', '@sveltejs/adapter-static'],
    expectedRuntimePaths: ['build/index.html'],
    expectRootNodeModulesExcluded: true,
  })
}

// runSvelteKitNodeCase 함수는 SvelteKit adapter-node 서버 출력을 패키징한다.
function runSvelteKitNodeCase(frontronTarball) {
  logStep('sveltekit-node case: official sv template -> node adapter -> package directory')

  const root = createScratchDir('sveltekit-node')
  const appName = 'matrix-sveltekit-node-app'
  const appRoot = join(root, appName)

  createSvelteKitProject(root, appName, 'node')
  runRetrofitLifecycle({
    appRoot,
    frontronTarball,
    expectedAdapter: 'sveltekit-node',
    frameworkDependencies: ['@sveltejs/kit', '@sveltejs/adapter-node'],
    expectedRuntimePaths: ['.frontron/runtime/sveltekit-node/index.js'],
    nodeRuntimeProbe: {
      root: '.frontron/runtime/sveltekit-node',
      entry: 'index.js',
    },
  })
}

function main() {
  const selectedCase = process.argv[2] ?? 'all'
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

  if (!knownCases.has(selectedCase)) {
    throw new Error(`Unknown matrix case: ${selectedCase}`)
  }

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
      run: () => runViteCase(frontronTarball),
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
      run: () => runNextExportCase(frontronTarball),
    },
    {
      name: 'next-standalone',
      group: 'frameworks',
      run: () => runNextStandaloneCase(frontronTarball),
    },
    {
      name: 'nuxt',
      group: 'frameworks',
      run: () => runNuxtCase(frontronTarball),
    },
    {
      name: 'remix',
      group: 'frameworks',
      run: () => runRemixCase(frontronTarball),
    },
    {
      name: 'sveltekit-static',
      group: 'frameworks',
      run: () => runSvelteKitStaticCase(frontronTarball),
    },
    {
      name: 'sveltekit-node',
      group: 'frameworks',
      run: () => runSvelteKitNodeCase(frontronTarball),
    },
  ]

  for (const matrixCase of cases) {
    if (
      selectedCase === 'all' ||
      selectedCase === matrixCase.group ||
      selectedCase === matrixCase.name
    ) {
      matrixCase.run()
    }
  }

  logStep(`${selectedCase} matrix cases passed`)
}

try {
  main()
} finally {
  for (const tempDir of tempRoots.splice(0)) {
    rmSync(resolve(tempDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }

  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })

  if (existsSync(tempRoot) && readdirSync(tempRoot).length === 0) {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}
