import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const tempDirs: string[] = []
const testElectronRuntime = process.env.FRONTRON_TEST_ELECTRON_RUNTIME === '1'

function getNpmInvocation(args: string[]) {
  return process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] }
    : { command: 'npm', args }
}

function runNpm(args: string[], cwd: string) {
  const invocation = getNpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${args.join(' ')}: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`)
  }
  return result.stdout
}

function packPackageForReal(packageRoot: string, prefix: string) {
  runNpm(['run', 'build'], packageRoot)
  const outputDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(outputDir)
  const packed = JSON.parse(runNpm(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir], packageRoot,
  )) as Array<{ filename?: string }>
  if (!packed[0]?.filename) throw new Error('npm pack did not report an output filename')
  return join(outputDir, packed[0].filename)
}

// Runs inside the actual renderer; DOM checks wait for React, not only did-finish-load.
const rendererProbe = `(async () => {
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Renderer timeout: ' + label);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  await waitFor(() => document.querySelector('h1')?.textContent === 'Desktop app ready', 'React mount');
  const appInfo = await window.electron.getAppInfo();
  const status = document.querySelector('.status');
  if (status) await waitFor(() => status.textContent.includes(appInfo.name), 'React IPC effect');
  const counter = document.querySelector('#counter');
  if (counter) {
    counter.click();
    await waitFor(() => counter.dataset.value === '1', 'React click state update');
  }
  return {
    protocol: location.protocol,
    origin: location.origin,
    heading: document.querySelector('h1').textContent,
    bridgeType: typeof window.electron,
    requireType: typeof window.require,
    processType: typeof window.process,
    appInfo,
    counterWorked: counter ? counter.dataset.value === '1' : null,
  };
})()`

function installRendererProbe(appRoot: string, electronDir = 'src/electron') {
  const mainPath = join(appRoot, electronDir, 'main.ts')
  const original = readFileSync(mainPath, 'utf8')
  const pathImport = 'import path from "node:path"\n'
  const openWindowSource = `function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
}
`
  if (!original.includes(pathImport) || !original.includes(openWindowSource)) {
    throw new Error('Generated Electron main source no longer matches the renderer probe contract.')
  }
  const instrumented = original.replace(pathImport, `import fs from "node:fs"\n${pathImport}`).replace(
    openWindowSource,
    `function runRendererProbe() {
  const outputPath = process.env.FRONTRON_RENDERER_PROBE_PATH?.trim()
  if (!outputPath || !mainWindow) return
  const capture = async () => {
    let exitCode = 0
    let payload: unknown
    try {
      const result = await mainWindow?.webContents.executeJavaScript(${JSON.stringify(rendererProbe)}, true)
      payload = { ok: true, isPackaged: app.isPackaged, ...result }
    } catch (error) {
      exitCode = 1
      payload = { ok: false, error: String(error) }
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\\n", "utf8")
    await stopRendererServer()
    app.exit(exitCode)
  }
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => void capture())
  } else {
    void capture()
  }
}

function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
  runRendererProbe()
}
`,
  )
  writeFileSync(mainPath, instrumented, 'utf8')
  return () => writeFileSync(mainPath, original, 'utf8')
}

function expectHealthyRendererProbe(probePath: string, packaged: boolean, counter = false) {
  const probe = JSON.parse(readFileSync(probePath, 'utf8'))
  expect(probe).toMatchObject({
    ok: true, isPackaged: packaged,
    protocol: packaged ? 'frontron:' : 'http:',
    heading: 'Desktop app ready', bridgeType: 'object',
    requireType: 'undefined', processType: 'undefined',
  })
  expect(probe.appInfo?.name).toBeTruthy()
  if (counter) expect(probe.counterWorked).toBe(true)
  console.log(`[desktop-probe] ${JSON.stringify(probe)}`)
}

function runDevelopmentAppProbe(appRoot: string, probePath: string, script = 'app', counter = false) {
  const npm = getNpmInvocation(['run', script])
  const invocation = process.platform === 'linux'
    ? { command: 'xvfb-run', args: ['-a', npm.command, ...npm.args] }
    : npm
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: appRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env, CI: '1', FRONTRON_RENDERER_PROBE_PATH: probePath,
      ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
    },
  })
  expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0)
  expectHealthyRendererProbe(probePath, false, counter)
}

function runPackagedAppProbe(appRoot: string, appName: string, probePath: string, counter = false) {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    throw new Error('Desktop runtime checks currently support Windows and Linux only.')
  }
  const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const outputDir = packageJson.build?.directories?.output
  expect(typeof outputDir).toBe('string')
  const executable = process.platform === 'win32'
    ? join(appRoot, outputDir, 'win-unpacked', `${appName}.exe`)
    : join(appRoot, outputDir, 'linux-unpacked', appName)
  const invocation = process.platform === 'linux'
    ? { command: 'xvfb-run', args: ['-a', executable, '--no-sandbox'] }
    : { command: executable, args: [] }
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: appRoot, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, FRONTRON_RENDERER_PROBE_PATH: probePath },
  })
  expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0)
  expectHealthyRendererProbe(probePath, true, counter)
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}, 60_000)

test('packed create-frontron builds and runs its real Electron starter', () => {
  const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-release-')
  const rehearsalRoot = mkdtempSync(join(tmpdir(), 'frontron-starter-rehearsal-'))
  tempDirs.push(rehearsalRoot)
  const appName = 'release-smoke-app'
  const appRoot = join(rehearsalRoot, appName)
  runNpm(['init', '-y'], rehearsalRoot)
  runNpm(['exec', '--package', createTarball, '--', 'create-frontron', appName], rehearsalRoot)
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  for (const script of ['app', 'typecheck', 'build', 'lint']) {
    expect(pkg.scripts[script]).toBe(`node scripts/tasks.mjs ${script}`)
  }
  expect(pkg.dependencies).not.toHaveProperty('frontron')
  expect(pkg.devDependencies).toHaveProperty('electron')
  expect(pkg.devDependencies).toHaveProperty('electron-builder')
  expect(pkg.trustedDependencies).toBeUndefined()
  expect(pkg.main).toBe('dist/electron/main.js')
  expect(pkg.build?.productName).toBe(appName)
  expect(pkg.build?.appId).toContain(appName)
  expect(pkg.build?.icon).toBe('public/logo.svg')
  expect(pkg).not.toHaveProperty('author')
  for (const file of ['src/electron/main.ts', 'src/electron/preload.ts', 'src/types/electron.d.ts', 'tsconfig.electron.json']) {
    expect(existsSync(join(appRoot, file))).toBe(true)
  }
  for (const file of ['frontron.config.ts', 'dist', '.npmignore']) {
    expect(existsSync(join(appRoot, file))).toBe(false)
  }
  installRendererProbe(appRoot)
  runNpm(['install', '--fund=false'], appRoot)
  runNpm(['audit', '--audit-level=moderate'], appRoot)
  runNpm(['run', 'typecheck'], appRoot)
  if (testElectronRuntime) runDevelopmentAppProbe(appRoot, join(rehearsalRoot, 'dev.json'))
  runNpm(['run', 'build', '--', '--dir'], appRoot)
  if (testElectronRuntime) runPackagedAppProbe(appRoot, appName, join(rehearsalRoot, 'packaged.json'))
}, 600_000)

test('packed frontron retrofits, updates, runs and removes a real Vite app without altering its source', () => {
  const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-retrofit-')
  const frontronTarball = packPackageForReal(join(dirname(createPackageRoot), 'frontron'), 'frontron-retrofit-')
  const root = mkdtempSync(join(tmpdir(), 'frontron-real-vite-'))
  tempDirs.push(root)
  const appName = 'retrofit-smoke-app'
  const appRoot = join(root, appName)
  mkdirSync(join(appRoot, 'src'), { recursive: true })
  const template = JSON.parse(readFileSync(join(createPackageRoot, 'template/package.json'), 'utf8'))
  const pkg = {
    name: appName, version: '0.0.1', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' },
    dependencies: { react: template.dependencies.react, 'react-dom': template.dependencies['react-dom'] },
    devDependencies: { vite: template.devDependencies.vite },
  }
  writeFileSync(join(appRoot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  const sourceFiles = {
    'vite.config.js': 'export default {}\n',
    'index.html': '<!doctype html><html><head><title>Real Vite consumer</title></head><body><div id="root"></div><script type="module" src="/src/main.js"></script></body></html>\n',
    'src/main.js': `import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
function App() {
  const [count, setCount] = useState(0);
  return h('main', null, h('h1', null, 'Desktop app ready'),
    h('button', { id: 'counter', 'data-value': String(count), onClick: () => setCount(count + 1) }, 'Count: ' + count));
}
createRoot(document.getElementById('root')).render(h(App));
`,
  }
  for (const [name, content] of Object.entries(sourceFiles)) writeFileSync(join(appRoot, name), content)
  runNpm(['install', '-D', createTarball, frontronTarball, '--fund=false'], appRoot)
  runNpm(['run', 'build'], appRoot)
  runNpm(['exec', '--', 'frontron', 'init', '--yes'], appRoot)
  runNpm(['install', '--fund=false'], appRoot)
  runNpm(['audit', '--audit-level=moderate'], appRoot)
  expect(runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)).toContain('No blockers found.')
  const manifestPath = join(appRoot, '.frontron/manifest.json')
  const manifestBefore = readFileSync(manifestPath)
  runNpm(['exec', '--', 'frontron', 'update', '--dry-run'], appRoot)
  expect(readFileSync(manifestPath)).toEqual(manifestBefore)
  runNpm(['exec', '--', 'frontron', 'update', '--yes'], appRoot)
  const restoreProbe = installRendererProbe(appRoot, 'electron')
  try {
    if (testElectronRuntime) runDevelopmentAppProbe(appRoot, join(root, 'dev.json'), 'frontron:dev', true)
    runNpm(['run', 'frontron:build', '--', '--dir'], appRoot)
    if (testElectronRuntime) runPackagedAppProbe(appRoot, appName, join(root, 'packaged.json'), true)
  } finally {
    restoreProbe()
  }
  runNpm(['exec', '--', 'frontron', 'clean', '--yes'], appRoot)
  expect(existsSync(manifestPath)).toBe(false)
  expect(existsSync(join(appRoot, 'electron/main.ts'))).toBe(false)
  const cleaned = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  expect(cleaned.scripts).toEqual(pkg.scripts)
  for (const [name, content] of Object.entries(sourceFiles)) {
    expect(readFileSync(join(appRoot, name), 'utf8')).toBe(content)
  }
  runNpm(['run', 'build'], appRoot)
  console.log('[desktop-probe] real Vite init/update/clean and final web build passed')
}, 600_000)
