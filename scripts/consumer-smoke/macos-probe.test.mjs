import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { test } from 'node:test'
import { assertMacProbe, installMacProbe, macRendererProbe } from './macos-probe.mjs'

function temporary(action) {
  const root = mkdtempSync(join(tmpdir(), 'frontron-macos-probe-unit-'))
  try { action(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

function writeFixture(root, initializer = 'initializeApp') {
  mkdirSync(join(root, 'electron'))
  const main = `import path from "node:path"\nlet rendererUrl = null\nfunction openMainWindow() {\n  if (!rendererUrl) return\n  createWindow(rendererUrl, setupIpcHandlers)\n}\n\nasync function ${initializer}() {}\n`
  const preload = 'const {contextBridge} = require("electron")\ncontextBridge.exposeInMainWorld("electron", {})\n'
  writeFileSync(join(root, 'electron/main.ts'), main)
  writeFileSync(join(root, 'electron/preload.ts'), preload)
  writeFileSync(join(root, 'electron/window.ts'), 'nodeIntegration: false; sandbox: true; contextIsolation: true;\n')
  return { main, preload }
}

test('macOS renderer probe is valid JavaScript', () => {
  new Script(macRendererProbe)
})

test('temporary instrumentation preserves security and restores both source files', () => temporary(root => {
  const before = writeFixture(root)
  const restore = installMacProbe(root, 'electron')
  const main = readFileSync(join(root, 'electron/main.ts'), 'utf8')
  assert.match(main, /window\.close\(\)/)
  assert.match(main, /app\.emit\("activate"\)/)
  assert.match(main, /app\.quit\(\)/)
  assert.doesNotMatch(main, /app\.exit\(/)
  assert.match(main, /async function initializeApp\(\)/)
  assert.doesNotMatch(main, /no-sandbox|sandbox:\s*false|webSecurity:\s*false/)
  restore()
  assert.equal(readFileSync(join(root, 'electron/main.ts'), 'utf8'), before.main)
  assert.equal(readFileSync(join(root, 'electron/preload.ts'), 'utf8'), before.preload)
}))

test('unexpected main layout is rejected and partial instrumentation is restored', () => temporary(root => {
  const before = writeFixture(root, 'renamedInitializer')
  assert.throws(() => installMacProbe(root, 'electron'), /lifecycle contract changed/)
  assert.equal(readFileSync(join(root, 'electron/main.ts'), 'utf8'), before.main)
  assert.equal(readFileSync(join(root, 'electron/preload.ts'), 'utf8'), before.preload)
}))

function reports() {
  const shared = {
    ok: true, isPackaged: true, protocol: 'frontron:', heading: 'Desktop app ready',
    appInfo: { name: 'native-consumer', platform: 'darwin', arch: 'arm64' },
    security: { sandbox: true, contextIsolation: true }, requireType: 'undefined',
    processType: 'undefined', clipboardRoundtrip: true, counterWorked: true,
    untrustedEventHandlerBlocked: true,
  }
  return [
    { ...structuredClone(shared), cycle: 1, windowId: 1, firstWindowId: null, windowRecreated: false, storageBefore: null },
    { ...structuredClone(shared), cycle: 2, windowId: 2, firstWindowId: 1, windowRecreated: true, storageBefore: 'native-consumer' },
  ]
}

function writeReports(root, values) {
  const file = join(root, 'probe.json')
  writeFileSync(file + '.first.json', JSON.stringify(values[0]))
  writeFileSync(file, JSON.stringify(values[1]))
  return file
}

test('accepts complete two-window production evidence', () => temporary(root => {
  assertMacProbe(writeReports(root, reports()), { packaged: true, counter: true })
}))

for (const [name, mutate] of [
  ['disabled sandbox', value => { value.security.sandbox = false }],
  ['missing isolation', value => { value.security.contextIsolation = false }],
  ['exposed Node', value => { value.requireType = 'function' }],
  ['failed clipboard', value => { value.clipboardRoundtrip = false }],
  ['failed CSP', value => { value.untrustedEventHandlerBlocked = false }],
  ['wrong architecture', value => { value.appInfo.arch = 'x64' }],
  ['same window reused', value => { value.windowId = 1 }],
  ['missing reopen evidence', value => { value.windowRecreated = false }],
  ['lost storage', value => { value.storageBefore = null }],
  ['failed React click', value => { value.counterWorked = false }],
]) {
  test(`rejects ${name}`, () => temporary(root => {
    const values = reports()
    mutate(values[1])
    assert.throws(() => assertMacProbe(writeReports(root, values), { packaged: true, counter: true }))
  }))
}
