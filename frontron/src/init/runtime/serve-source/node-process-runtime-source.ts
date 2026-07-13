// renderChildProcessRuntimeSource 함수는 개발 서버와 Electron이 공유하는 프로세스 종료 코드를 만든다.
export function renderChildProcessRuntimeSource() {
  return `// isChildProcessRunning 함수는 자식 프로세스가 아직 종료되지 않았는지 확인한다.
function isChildProcessRunning(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null
}

// waitForChildExit 함수는 제한 시간 동안 자식 프로세스 exit 이벤트를 기다린다.
function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (!isChildProcessRunning(child)) {
    return Promise.resolve(true)
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    const timer = setTimeout(() => finish(false), timeoutMs)

    // handleExit 함수는 자식 프로세스의 exit 이벤트를 성공 대기로 마무리한다.
    function handleExit() {
      finish(true)
    }

    // finish 함수는 타이머와 이벤트를 한 번만 정리하고 종료 여부를 반환한다.
    function finish(exited: boolean) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', handleExit)
      resolve(exited)
    }

    child.once('exit', handleExit)

    if (!isChildProcessRunning(child)) {
      finish(true)
    }
  })
}

// runWindowsTaskkill 함수는 Windows에서 PID 아래의 전체 프로세스 트리를 종료한다.
function runWindowsTaskkill(processId: number, force: boolean) {
  return new Promise<boolean>((resolve) => {
    const args = ['/pid', String(processId), '/t']

    if (force) args.push('/f')

    const taskkillProcess = spawn('taskkill', args, {
      stdio: 'ignore',
      windowsHide: true,
    })
    let settled = false

    // finish 함수는 taskkill 결과를 한 번만 확정한다.
    const finish = (succeeded: boolean) => {
      if (settled) return
      settled = true
      resolve(succeeded)
    }

    taskkillProcess.once('error', () => finish(false))
    taskkillProcess.once('exit', (code) => finish(code === 0))
  })
}

// signalChildProcessTree 함수는 플랫폼에 맞게 자식 프로세스 트리에 종료 신호를 보낸다.
async function signalChildProcessTree(child: ChildProcess, force: boolean) {
  if (!isChildProcessRunning(child)) return

  const signal = force ? 'SIGKILL' : 'SIGTERM'

  if (process.platform === 'win32' && child.pid) {
    const killedTree = await runWindowsTaskkill(child.pid, force)

    if (killedTree) return
  }

  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (isFileSystemError(error) && error.code === 'ESRCH') return
    }
  }

  try {
    child.kill(signal)
  } catch (error) {
    if (!isFileSystemError(error) || error.code !== 'ESRCH') {
      throw error
    }
  }
}

// terminateChildProcessTree 함수는 정상 종료를 기다린 뒤 필요하면 전체 트리를 강제 종료한다.
async function terminateChildProcessTree(child: ChildProcess, timeoutMs = 5_000) {
  if (!isChildProcessRunning(child)) return

  await signalChildProcessTree(child, false)

  if (await waitForChildExit(child, timeoutMs)) return

  await signalChildProcessTree(child, true)
  await waitForChildExit(child, 1_000)
}
`
}

// renderNodeServerRuntimeSource 함수는 Node 서버 전략에만 필요한 실행 코드를 만든다.
export function renderNodeServerRuntimeSource() {
  return `// startNodeServerRuntime 함수는 패키징된 node-server 렌더러 런타임을 시작한다.
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
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: LOOPBACK_HOST,
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

    if (activeProcess) {
      await terminateChildProcessTree(activeProcess)
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

  await terminateChildProcessTree(activeProcess)
}

// startRendererRuntime 함수는 패키징된 Node 서버를 시작하고 접속 URL을 반환한다.
export async function startRendererRuntime() {
  return startNodeServerRuntime()
}

// stopRendererRuntime 함수는 실행 중인 Node 서버 프로세스를 종료한다.
export async function stopRendererRuntime() {
  await stopNodeServerRuntime()
}
`
}
