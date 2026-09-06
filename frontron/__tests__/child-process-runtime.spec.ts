import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import * as ts from 'typescript'
import { expect, test, vi } from 'vitest'

import { renderChildProcessRuntimeSource } from '../src/init/runtime/serve-source/node-process-runtime-source'

type Terminate = (child: ChildProcess, timeoutMs?: number) => Promise<void>

function loadTermination(spawnProcess: unknown = spawn, hostProcess: unknown = process): Terminate {
  const source = ts.transpileModule(renderChildProcessRuntimeSource(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function('spawn', 'process', `
    function isFileSystemError(error) { return error instanceof Error && 'code' in error }
    ${source}
    return terminateChildProcessTree
  `)(spawnProcess, hostProcess) as Terminate
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(),
  })
}

test('Windows terminates the owned tree with /f in the first taskkill invocation', async () => {
  const child = fakeChild()
  const taskkill = new EventEmitter()
  const spawnProcess = vi.fn(() => {
    queueMicrotask(() => {
      child.exitCode = 0
      child.emit('exit', 0)
      taskkill.emit('exit', 0)
    })
    return taskkill
  })
  await loadTermination(spawnProcess, { platform: 'win32' })(child as unknown as ChildProcess)
  expect(spawnProcess).toHaveBeenCalledTimes(1)
  expect(spawnProcess).toHaveBeenCalledWith(
    'taskkill', ['/pid', '12345', '/t', '/f'],
    { stdio: 'ignore', windowsHide: true, timeout: 5_000 },
  )
  expect(child.kill).not.toHaveBeenCalled()
})

test('failed Windows tree termination is not hidden by killing only its parent', async () => {
  const child = fakeChild()
  const spawnProcess = () => {
    const taskkill = new EventEmitter()
    queueMicrotask(() => taskkill.emit('exit', 1))
    return taskkill
  }
  await expect(loadTermination(spawnProcess, { platform: 'win32' })(
    child as unknown as ChildProcess,
  )).rejects.toThrow('Failed to terminate the Windows process tree')
  expect(child.kill).not.toHaveBeenCalled()
})

test('real child and grandchild release inherited pipes without stopping an unrelated process', async () => {
  const grandchildSource = `process.send({ pid: process.pid }); setInterval(() => {}, 1000)`
  const parentSource = `
    const { spawn } = require('node:child_process')
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    grandchild.once('message', message => process.send(message))
    setInterval(() => {}, 1000)
  `
  const child = spawn(process.execPath, ['-e', parentSource], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  const unrelatedClosed = once(unrelated, 'close')
  let grandchildPid: number | undefined
  let pipesClosed = false
  const closed = once(child, 'close', { signal: AbortSignal.timeout(10_000) })
    .then(() => true, () => false)
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5_000) })
    grandchildPid = (message as { pid: number }).pid
    expect(grandchildPid).toBeGreaterThan(0)
    await loadTermination()(child)
    // close (not just exit) proves that the grandchild released the pipes too.
    pipesClosed = await closed
    expect(pipesClosed).toBe(true)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(unrelated.exitCode).toBeNull()
    expect(unrelated.signalCode).toBeNull()
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore', timeout: 5_000,
        })
      } else {
        try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already exited */ }
      }
    }
    if (!pipesClosed && grandchildPid) {
      try { process.kill(grandchildPid, 'SIGKILL') } catch { /* already exited */ }
    }
    unrelated.kill('SIGKILL')
    await unrelatedClosed
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
}, 20_000)
