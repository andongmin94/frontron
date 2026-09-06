import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

export function writeFiles(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    const target = join(root, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
}

// Native consumers run outside the checkout, with per-command logs retained on failure.
export function createHarness(label) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `frontron-${label}-`)))
  const reports = resolve(process.env.FRONTRON_SMOKE_REPORT_DIR || `${root}-reports`)
  mkdirSync(reports, { recursive: true })
  let sequence = 0

  async function run(command, args, cwd = root, { timeout = 300_000, env = {}, codes = [0], windowsVerbatimArguments = false } = {}) {
    const logPath = join(reports, `${String(++sequence).padStart(2, '0')}-${basename(command)}.log`)
    writeFileSync(logPath, `${command} ${args.join(' ')}\ncwd=${cwd}\n`)
    console.log(`[consumer] ${command} ${args.join(' ')}`)
    return new Promise((resolveRun, reject) => {
      let stdout = ''
      let stderr = ''
      let failure
      let settled = false
      let drainTimer
      const childEnv = { ...process.env, ...env }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const child = spawn(command, args, {
        cwd, env: childEnv, shell: false, windowsVerbatimArguments, stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      const finish = (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(drainTimer)
        appendFileSync(logPath, `\nexit=${code}; error=${failure || ''}\n`)
        if (failure || !codes.includes(code)) {
          reject(new Error(`${command} failed: ${failure || `exit ${code}`}\n${stdout.slice(-6000)}\n${stderr.slice(-6000)}\nLog: ${logPath}`))
        } else resolveRun({ stdout, stderr, code })
      }
      child.stdout.on('data', (chunk) => {
        appendFileSync(logPath, chunk)
        stdout = (stdout + chunk.toString()).slice(-8 * 1024 * 1024)
      })
      child.stderr.on('data', (chunk) => {
        appendFileSync(logPath, chunk)
        stderr = (stderr + chunk.toString()).slice(-8 * 1024 * 1024)
      })
      const timer = setTimeout(() => {
        failure = new Error(`Timed out after ${timeout} ms`)
        if (child.pid) {
          if (process.platform === 'win32') {
            const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', timeout: 10_000 })
            appendFileSync(logPath, `\n[cleanup] ${killed.stdout || ''}${killed.stderr || ''}${killed.error || ''}`)
          } else {
            try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
              if (error.code !== 'ESRCH') appendFileSync(logPath, `\n[cleanup] ${error}`)
            }
          }
        }
        drainTimer = setTimeout(() => {
          child.stdout.destroy()
          child.stderr.destroy()
          finish(null)
        }, 5000)
      }, timeout)
      child.once('error', (error) => { failure = error; finish(null) })
      child.once('close', finish)
    })
  }

  // setup-node's Windows installation carries npm beside node.exe. Invoke its
  // JS entry point directly, so paths with spaces never pass through cmd.exe.
  function npm(args, cwd = root) {
    if (process.platform === 'win32') {
      const cli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      assert.ok(existsSync(cli), `npm CLI missing beside Node: ${cli}`)
      return run(process.execPath, [cli, ...args], cwd)
    }
    return run('npm', args, cwd)
  }

  async function pack(name) {
    const packageRoot = join(repoRoot, name)
    await npm(['run', 'build'], packageRoot)
    const { stdout } = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', root], packageRoot)
    const packed = JSON.parse(stdout)
    assert.equal(packed.length, 1)
    assert.equal(typeof packed[0].filename, 'string')
    return join(root, packed[0].filename)
  }

  function cleanup() {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }

  return { root, reports, run, npm, pack, cleanup }
}

export const reactProbe = `(async () => {
  const wait = async (test, name) => {
    const deadline = Date.now() + 15000;
    while (!test()) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + name);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  await wait(() => document.querySelector('h1')?.textContent === 'Desktop app ready', 'React mount');
  const info = await window.electron.getAppInfo();
  const button = document.querySelector('#counter');
  if (button) {
    button.click();
    await wait(() => button.dataset.value === '1', 'React click');
  }
  const script = document.createElement('script');
  script.textContent = 'window.__frontronUntrustedInline = true';
  document.body.appendChild(script);
  await new Promise(resolve => setTimeout(resolve, 100));
  return {
    heading: document.querySelector('h1').textContent,
    protocol: location.protocol,
    requireType: typeof window.require,
    processType: typeof window.process,
    appInfo: info,
    security: window.__frontronSecurityProbe,
    counterWorked: button ? button.dataset.value === '1' : null,
    untrustedInlineBlocked: window.__frontronUntrustedInline !== true,
  };
})()`

// Only temporary consumers are instrumented. Production templates contain no
// environment-triggered test hook, and all security settings remain untouched.
export function installProbe(appRoot, electronDir, rendererScript = reactProbe) {
  const file = join(appRoot, electronDir, 'main.ts')
  const original = readFileSync(file, 'utf8')
  const preloadFile = join(appRoot, electronDir, 'preload.ts')
  const preload = readFileSync(preloadFile, 'utf8')
  const windowSource = readFileSync(join(appRoot, electronDir, 'window.ts'), 'utf8')
  for (const expected of [/nodeIntegration:\s*false/, /sandbox:\s*true/, /contextIsolation:\s*true/]) assert.match(windowSource, expected)
  assert.doesNotMatch(windowSource, /webSecurity:\s*false/)
  assert.ok(preload.includes('contextBridge.exposeInMainWorld'), 'Preload bridge contract changed')
  const anchor = `function openMainWindow() {\n  if (!rendererUrl) return\n  createWindow(rendererUrl, setupIpcHandlers)\n}\n`
  assert.ok(original.includes(anchor), 'Electron window entry changed; update the probe explicitly')
  assert.ok(original.includes('import path from "node:path"\n'))
  const injected = `const smokePath = process.env.FRONTRON_CONSUMER_PROBE
if (!smokePath) throw new Error("Missing smoke report path")
fs.mkdirSync(path.join(path.dirname(smokePath), "profile"), { recursive: true })
app.setPath("userData", path.join(path.dirname(smokePath), "profile"))

function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
  if (!mainWindow) throw new Error("No main window")
  let captured = false
  const capture = async () => {
    if (captured) return
    captured = true
    let payload: unknown
    try {
      const value = await mainWindow!.webContents.executeJavaScript(${JSON.stringify(rendererScript)}, true)
      payload = { ok: true, isPackaged: app.isPackaged, execPath: process.execPath,
        appPath: app.getAppPath(), versions: process.versions, ...value }
    } catch (error) { console.error("[consumer-probe]", error); payload = { ok: false, error: String(error) } }
    fs.writeFileSync(smokePath!, JSON.stringify(payload, null, 2) + "\\n")
    // Exercise the actual before-quit server cleanup, not app.exit().
    app.quit()
  }
  mainWindow.webContents.once("did-finish-load", () => { void capture() })
}
`
  writeFileSync(file, original.replace('import path from "node:path"\n', 'import fs from "node:fs"\nimport path from "node:path"\n').replace(anchor, injected))
  // Read sandbox/isolation from the documented preload process properties.
  // Do not cast to Electron's private getLastWebPreferences method.
  writeFileSync(preloadFile, preload + '\ncontextBridge.exposeInMainWorld("__frontronSecurityProbe", { sandbox: process.sandboxed === true, contextIsolation: process.contextIsolated === true })\n')
  return () => { writeFileSync(file, original); writeFileSync(preloadFile, preload) }
}

export function assertSecureProbe(file, { counter = false, sandbox = true } = {}) {
  const probe = readJson(file)
  assert.equal(probe.ok, true, JSON.stringify(probe))
  assert.equal(probe.isPackaged, true)
  assert.equal(probe.heading, 'Desktop app ready')
  assert.equal(probe.protocol, 'frontron:')
  assert.equal(probe.requireType, 'undefined')
  assert.equal(probe.processType, 'undefined')
  assert.ok(probe.appInfo?.name)
  assert.equal(probe.untrustedInlineBlocked, true)
  assert.equal(probe.security.contextIsolation, true)
  if (sandbox) assert.equal(probe.security.sandbox, true)
  if (counter) assert.equal(probe.counterWorked, true)
  console.log(`[consumer-probe] ${JSON.stringify(probe)}`)
  return probe
}
