import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

// readArgument 함수는 이름 뒤에 전달된 필수 명령행 값을 읽는다.
function readArgument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]

  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }

  return value
}

// getAvailablePort 함수는 실제 서버 기동에 사용할 빈 loopback 포트를 예약해 확인한다.
function getAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a loopback port.'))
        return
      }

      server.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

// sleep 함수는 서버 재시도 사이에 짧게 기다린다.
function sleep(timeoutMs) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, timeoutMs))
}

// waitForHealthyResponse 함수는 서버가 성공적인 HTTP 응답을 반환할 때까지 기다린다.
async function waitForHealthyResponse(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Runtime server exited before becoming ready with code ${child.exitCode}.`)
    }

    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000),
      })

      if (response.status >= 200 && response.status < 400) {
        await response.body?.cancel()
        return response.status
      }
    } catch {
      // 서버가 아직 listen 전이면 다음 간격에 다시 확인한다.
    }

    await sleep(200)
  }

  throw new Error(`Runtime server did not respond within ${timeoutMs}ms: ${url}`)
}

// terminateProcessTree 함수는 probe가 만든 서버와 자식 프로세스를 플랫폼에 맞게 정리한다.
async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }

  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), sleep(2_000)])

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGKILL')
    }
  }
}

// main 함수는 준비된 프레임워크 서버를 실제로 시작하고 loopback 응답을 확인한다.
async function main() {
  const runtimeRoot = resolve(readArgument('--root'))
  const runtimeEntry = resolve(runtimeRoot, readArgument('--entry'))
  const port = await getAvailablePort()
  const runtimeUrl = `http://127.0.0.1:${port}/`
  const outputChunks = []
  const child = spawn(process.execPath, [runtimeEntry], {
    cwd: runtimeRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.stdout.on('data', (chunk) => outputChunks.push(chunk))
  child.stderr.on('data', (chunk) => outputChunks.push(chunk))

  try {
    const status = await waitForHealthyResponse(runtimeUrl, child)
    console.log(`[matrix] node runtime responded with HTTP ${status}: ${runtimeEntry}`)
  } catch (error) {
    const output = Buffer.concat(outputChunks).toString('utf8').trim()
    throw new Error(`${error.message}${output ? `\nRuntime output:\n${output}` : ''}`)
  } finally {
    await terminateProcessTree(child)
  }
}

await main()
