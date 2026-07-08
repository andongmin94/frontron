// renderServeDevAndBuildSource 함수는 generated serve.ts의 dev 실행과 build 준비 진입점을 만든다.
export function renderServeDevAndBuildSource() {
  return `
export const startRendererServer = startRendererRuntime
export const stopRendererServer = stopRendererRuntime

// spawnWebDevServer 함수는 프론트엔드 개발 서버 프로세스를 시작한다.
function spawnWebDevServer() {
  return spawn(getRunnerCommand(), getRunnerArgs(WEB_DEV_SCRIPT), {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  })
}

// runDevApp 함수는 개발 서버와 Electron 앱을 함께 실행한다.
async function runDevApp() {
  ensureRuntimePackage()

  const webDevProcess = spawnWebDevServer()
  let electronProcess: ChildProcess | null = null

  const shutdown = (exitCode = 0) => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill('SIGTERM')
    }

    if (!webDevProcess.killed) {
      webDevProcess.kill('SIGTERM')
    }

    process.exit(exitCode)
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => shutdown(0))
  }

  webDevProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start the frontend dev server.', error)
    shutdown(1)
  })

  webDevProcess.once('exit', (code) => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill('SIGTERM')
    }

    if (typeof code === 'number' && code !== 0) {
      process.exit(code)
    }
  })

  const readyDevUrl = await waitForUrlReady(DEV_URL)

  if (readyDevUrl !== DEV_URL) {
    console.info(\`[frontron:init] Frontend dev server responded at \${readyDevUrl}.\`)
  }

  electronProcess = spawn(getElectronExecutablePath(), [MAIN_ENTRY_PATH], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: readyDevUrl,
    },
  })

  electronProcess.once('error', (error) => {
    console.error('[frontron:init] Failed to start Electron.', error)
    shutdown(1)
  })

  electronProcess.once('exit', (code) => {
    if (!webDevProcess.killed) {
      webDevProcess.kill('SIGTERM')
    }

    process.exit(code ?? 0)
  })
}

// prepareStaticBuild 함수는 정적 렌더러 빌드가 패키징 가능한 상태인지 확인한다.
function prepareStaticBuild() {
  const indexPath = path.join(ROOT_DIR, WEB_OUT_DIR, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(\`Renderer entry not found at \${indexPath}. Run the frontend build first.\`)
  }
}

// prepareNodeServerBuild 함수는 node-server 런타임 파일을 패키징 위치로 복사하고 정리한다.
function prepareNodeServerBuild() {
  if (!NODE_SERVER_SOURCE_ROOT || !NODE_SERVER_ENTRY) {
    throw new Error('A node-server adapter must define both a source runtime root and a server entry.')
  }

  const sourceRuntimeDir = path.resolve(ROOT_DIR, NODE_SERVER_SOURCE_ROOT)
  const sourceServerEntryCandidates =
    ADAPTER === 'remix-node-server' ? ['index.js', 'server/index.js'] : [NODE_SERVER_ENTRY]
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
  mkdirSync(path.dirname(stagedRuntimeDir), { recursive: true })
  cpSync(sourceRuntimeDir, stagedRuntimeDir, { recursive: true })

  if (ADAPTER === 'remix-node-server') {
    mkdirSync(path.dirname(stagedServerEntry), { recursive: true })
    writeFileSync(
      stagedServerEntry,
      \`const path = require('node:path')
const { createApp } = require('@remix-run/serve')

const port = process.env.PORT || 3000
const host = process.env.HOSTNAME || '127.0.0.1'
const buildPath = path.join(__dirname, \${JSON.stringify(sourceServerEntryName)})

createApp(buildPath).listen(port, host, () => {
  console.log(\\\`[frontron:init] Remix server listening at http://\\\${host}:\\\${port}\\\`)
})
\`,
      'utf8',
    )
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
}

// prepareBuild 함수는 패키징 전에 렌더러 런타임을 준비한다.
function prepareBuild() {
  ensureRuntimePackage()

  if (RUNTIME_STRATEGY === 'node-server') {
    prepareNodeServerBuild()
    return
  }

  prepareStaticBuild()
}

if (process.argv.includes('--dev-app')) {
  void runDevApp().catch((error) => {
    console.error('[frontron:init] Failed to run the desktop app.', error)
    process.exit(1)
  })
}

if (process.argv.includes('--prepare-build')) {
  try {
    prepareBuild()
  } catch (error) {
    console.error('[frontron:init] Failed to prepare the production build.', error)
    process.exit(1)
  }
}
`
}
