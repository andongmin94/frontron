import type { InitConfig } from '../../shared'

// renderServeDevAndBuildSource 함수는 generated serve.ts의 dev 실행과 build 준비 진입점을 만든다.
export function renderServeDevAndBuildSource(config: InitConfig) {
  const usesNodeServer = config.runtimeStrategy === 'node-server'
  const usesRemixRuntime = usesNodeServer && config.adapter === 'remix-node-server'

  return `
export const startRendererServer = startRendererRuntime
export const stopRendererServer = stopRendererRuntime

// inferDevUrl 함수는 개발 모드에서 Electron이 접속할 렌더러 URL을 반환한다.
export async function inferDevUrl() {
  return DEV_URL
}

// spawnWebDevServer 함수는 프론트엔드 개발 서버 프로세스를 시작한다.
function spawnWebDevServer() {
  return spawn(getRunnerCommand(), getRunnerArgs(WEB_DEV_SCRIPT), {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: process.env,
  })
}

// runDevApp 함수는 개발 서버와 Electron 앱을 함께 실행한다.
async function runDevApp() {
  ensureRuntimePackage()

  const webDevProcess = spawnWebDevServer()
  let electronProcess: ChildProcess | null = null
  let shutdownPromise: Promise<void> | null = null

  // shutdown 함수는 개발용 Electron과 웹 서버의 전체 프로세스 트리를 종료한다.
  const shutdown = (exitCode = 0) => {
    if (shutdownPromise) {
      return shutdownPromise
    }

    shutdownPromise = (async () => {
      const processes = [electronProcess, webDevProcess].filter(
        (child): child is ChildProcess => child !== null,
      )

      await Promise.all(processes.map((child) => terminateChildProcessTree(child)))
      process.exit(exitCode)
    })()

    return shutdownPromise
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void shutdown(0)
    })
  }

  webDevProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start the frontend dev server.', error)
    void shutdown(1)
  })

  webDevProcess.once('exit', (code) => {
    if (!shutdownPromise) void shutdown(code ?? 0)
  })

  try {
    const readyDevUrl = await waitForUrlReady(DEV_URL)

    if (readyDevUrl !== DEV_URL) {
      console.info(\`[frontron:init] Frontend dev server responded at \${readyDevUrl}.\`)
    }

    electronProcess = spawn(getElectronExecutablePath(), [MAIN_ENTRY_PATH], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_RENDERER_URL: readyDevUrl,
      },
    })

    electronProcess.once('error', (error) => {
      console.error('[frontron:init] Failed to start Electron.', error)
      void shutdown(1)
    })

    electronProcess.once('exit', (code) => {
      if (!shutdownPromise) void shutdown(code ?? 0)
    })
  } catch (error) {
    await terminateChildProcessTree(webDevProcess)
    throw error
  }
}

${
  !usesNodeServer
    ? `// prepareStaticBuild 함수는 정적 렌더러 빌드가 패키징 가능한 상태인지 확인한다.
function prepareStaticBuild() {
  const indexPath = path.join(ROOT_DIR, WEB_OUT_DIR, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(\`Renderer entry not found at \${indexPath}. Run the frontend build first.\`)
  }
}`
    : ''
}

${
  usesRemixRuntime
    ? `type RemixBundleMetafile = {
  inputs: Record<string, unknown>
}

type RemixBundlePackage = {
  sourceRoot: string
  name: string
  version: string
  destinationName: string
}

// collectBundlePackageRoots 함수는 esbuild 입력 목록에 포함된 npm 패키지 루트를 찾는다.
function collectBundlePackageRoots(inputPaths: string[]) {
  const packages = new Map<string, RemixBundlePackage>()

  for (const inputPath of inputPaths) {
    const parts = inputPath.replace(/\\\\/g, '/').split('/')

    for (let index = 0; index < parts.length - 1; index += 1) {
      if (parts[index] !== 'node_modules') continue
      if (parts[index + 1] === '.pnpm') continue

      const packageEnd = parts[index + 1]?.startsWith('@') ? index + 3 : index + 2
      if (packageEnd > parts.length) continue

      const sourceRoot = path.resolve(ROOT_DIR, parts.slice(0, packageEnd).join('/'))
      const packageJsonPath = path.join(sourceRoot, 'package.json')

      if (!existsSync(packageJsonPath)) continue

      try {
        const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
          name?: unknown
          version?: unknown
        }

        if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') continue

        const key = \`\${metadata.name}@\${metadata.version}\`
        packages.set(key, {
          sourceRoot,
          name: metadata.name,
          version: metadata.version,
          destinationName: encodeURIComponent(key),
        })
      } catch {
        // 라이선스 메타데이터가 깨진 의존성은 bundle 자체 결과에 영향을 주지 않는다.
      }
    }
  }

  return Array.from(packages.values()).sort((left, right) =>
    left.destinationName.localeCompare(right.destinationName),
  )
}

// copyBundleLicenseFiles 함수는 bundle에 들어간 패키지의 메타데이터와 라이선스를 따로 보존한다.
function copyBundleLicenseFiles(packages: RemixBundlePackage[], stagedRuntimeDir: string) {
  const licenseRoot = path.join(stagedRuntimeDir, 'third-party-licenses')

  for (const packageMetadata of packages) {
    const sourceRoot = packageMetadata.sourceRoot
    const destinationRoot = path.join(licenseRoot, packageMetadata.destinationName)

    if (!existsSync(sourceRoot)) continue

    for (const entryName of readdirSync(sourceRoot)) {
      if (
        entryName !== 'package.json' &&
        !/^(?:licen[cs]e|notice|copying)(?:\\.|$)/i.test(entryName)
      ) {
        continue
      }

      const sourcePath = path.join(sourceRoot, entryName)
      const destinationPath = path.join(destinationRoot, entryName)
      mkdirSync(path.dirname(destinationPath), { recursive: true })
      cpSync(sourcePath, destinationPath, { recursive: true, dereference: true })
    }
  }

  writeFileSync(
    path.join(stagedRuntimeDir, 'THIRD_PARTY_LICENSES.json'),
    JSON.stringify(
      {
        packages: packages.map(({ name, version }) => ({ name, version })),
      },
      null,
      2,
    ) + '\\n',
    'utf8',
  )
}

// stageRemixRuntimeDependencies 함수는 공식 CLI와 서버 빌드를 독립 실행 bundle로 만든다.
async function stageRemixRuntimeDependencies(
  stagedRuntimeDir: string,
  sourceServerEntryName: string,
) {
  const require = createRequire(import.meta.url)
  const servePackagePath = require.resolve('@remix-run/serve/package.json')
  const serveCliPath = path.join(path.dirname(servePackagePath), 'dist', 'cli.js')
  const sourceBuildEntry = path.join(stagedRuntimeDir, 'build', sourceServerEntryName)
  const bundledBuildEntry = path.join(stagedRuntimeDir, 'server-build.mjs')
  const stagedServerEntry = path.join(stagedRuntimeDir, 'server.cjs')
  const temporaryCliEntry = path.join(stagedRuntimeDir, '.frontron-remix-cli.cjs')
  const esbuildPackageName = 'esbuild'
  const { build } = await import(esbuildPackageName)

  const buildResult = await build({
    entryPoints: [sourceBuildEntry],
    outfile: bundledBuildEntry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
      js: "import { createRequire as __frontronCreateRequire } from 'node:module'; const require = __frontronCreateRequire(import.meta.url);",
    },
    legalComments: 'external',
    metafile: true,
    logLevel: 'warning',
  }) as { metafile: RemixBundleMetafile }

  writeFileSync(
    temporaryCliEntry,
    \`const path = require('node:path')
process.argv = [process.execPath, __filename, path.join(__dirname, 'server-build.mjs')]
require(\${JSON.stringify(serveCliPath)})
\`,
    'utf8',
  )

  let cliResult: { metafile: RemixBundleMetafile }

  try {
    cliResult = await build({
      entryPoints: [temporaryCliEntry],
      outfile: stagedServerEntry,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      legalComments: 'external',
      metafile: true,
      logLevel: 'warning',
    }) as { metafile: RemixBundleMetafile }
  } finally {
    rmSync(temporaryCliEntry, { force: true })
  }

  const bundledPackages = collectBundlePackageRoots([
    ...Object.keys(buildResult.metafile.inputs),
    ...Object.keys(cliResult.metafile.inputs),
  ])
  copyBundleLicenseFiles(bundledPackages, stagedRuntimeDir)

  writeFileSync(
    path.join(stagedRuntimeDir, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2) + '\\n',
    'utf8',
  )
}`
    : ''
}

${
  usesNodeServer
    ? `// prepareNodeServerBuild 함수는 node-server 런타임 파일을 패키징 위치로 복사하고 정리한다.
async function prepareNodeServerBuild() {
  if (!NODE_SERVER_SOURCE_ROOT || !NODE_SERVER_ENTRY) {
    throw new Error('A node-server adapter must define both a source runtime root and a server entry.')
  }

  const sourceRuntimeDir = path.resolve(ROOT_DIR, NODE_SERVER_SOURCE_ROOT)
  const sourceServerEntryCandidates = ${usesRemixRuntime ? "['index.js', 'server/index.js']" : '[NODE_SERVER_ENTRY]'}
  const sourceServerEntryName = sourceServerEntryCandidates.find((entry) =>
    existsSync(path.join(sourceRuntimeDir, entry)),
  )
  const stagedRuntimeDir = path.resolve(ROOT_DIR, WEB_OUT_DIR)
  const stagedServerEntry = path.join(stagedRuntimeDir, NODE_SERVER_ENTRY)

  if (!sourceServerEntryName) {
    throw new Error(
      \`Node server entry not found in \${sourceRuntimeDir}. Tried: \${sourceServerEntryCandidates.join(', ')}. Run the frontend build first.\`,
    )
  }

  rmSync(stagedRuntimeDir, { recursive: true, force: true })
  mkdirSync(stagedRuntimeDir, { recursive: true })

${
  usesRemixRuntime
    ? `  cpSync(sourceRuntimeDir, path.join(stagedRuntimeDir, 'build'), { recursive: true })
  await stageRemixRuntimeDependencies(stagedRuntimeDir, sourceServerEntryName)`
    : `  cpSync(sourceRuntimeDir, stagedRuntimeDir, { recursive: true })`
}

  for (const target of NODE_SERVER_COPY_TARGETS) {
    const sourcePath = path.resolve(ROOT_DIR, target.from)
    const destinationPath = path.join(stagedRuntimeDir, target.to)

    if (!existsSync(sourcePath)) {
      continue
    }

    mkdirSync(path.dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { recursive: true })
  }

  if (!existsSync(stagedServerEntry)) {
    throw new Error(\`Node server entry not found at \${stagedServerEntry} after staging.\`)
  }
}`
    : ''
}

// prepareBuild 함수는 패키징 전에 렌더러 런타임을 준비한다.
async function prepareBuild() {
  ensureRuntimePackage()
  ${usesNodeServer ? 'await prepareNodeServerBuild()' : 'prepareStaticBuild()'}
}

if (process.argv.includes('--dev-app')) {
  void runDevApp().catch((error) => {
    console.error('[frontron:init] Failed to run the desktop app.', error)
    process.exit(1)
  })
}

if (process.argv.includes('--prepare-build')) {
  void prepareBuild().catch((error) => {
    console.error('[frontron:init] Failed to prepare the production build.', error)
    process.exit(1)
  })
}
`
}
