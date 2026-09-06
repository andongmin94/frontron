import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSecureProbe, installProbe, readJson, reactProbe } from './harness.mjs'

const developmentProbe = `(async () => {
  const deadline = Date.now() + 15000;
  while (document.querySelector('h1')?.textContent !== 'Desktop app ready') {
    if (Date.now() > deadline) throw new Error('Development React mount timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const appInfo = await window.electron.getAppInfo();
  const counter = document.querySelector('#counter');
  if (counter) {
    counter.click();
    while (counter.dataset.value !== '1') {
      if (Date.now() > deadline) throw new Error('Development React click timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return { heading: document.querySelector('h1').textContent,
    protocol: location.protocol, appInfo, security: window.__frontronSecurityProbe,
    requireType: typeof window.require, processType: typeof window.process,
    counterWorked: counter ? counter.dataset.value === '1' : null };
})()`

export const macRendererProbe = `(async () => {
  const packaged = location.protocol === 'frontron:';
  const value = packaged ? await ${reactProbe} : await ${developmentProbe};
  const oldClipboard = await window.electron.readClipboardText();
  const marker = 'Frontron macOS clipboard 확인';
  let clipboardRoundtrip = false;
  try {
    await window.electron.writeClipboardText(marker);
    clipboardRoundtrip = await window.electron.readClipboardText() === marker;
  } finally { await window.electron.writeClipboardText(oldClipboard); }
  const storageBefore = packaged ? localStorage.getItem('frontron-macos-probe') : null;
  if (packaged) localStorage.setItem('frontron-macos-probe', value.appInfo.name);
  return {...value, clipboardRoundtrip, storageBefore};
})()`

// Instrument temporary consumers only. Close a real BrowserWindow, then emit
// Electron's activate event to exercise the production reopening/IPC lifecycle.
// This is not an automated click on the Dock and does not modify security prefs.
export function installMacProbe(appRoot, electronDir) {
  const restore = installProbe(appRoot, electronDir, macRendererProbe)
  try {
    const file = join(appRoot, electronDir, 'main.ts')
    const original = readFileSync(file, 'utf8')
    const start = original.indexOf('function openMainWindow() {\n')
    const end = original.indexOf('\nasync function initializeApp()', start)
    assert.ok(start >= 0 && end > start, 'Generated main lifecycle contract changed')
    const injected = `let smokeWindowCount = 0
let smokeFirstWindowId: number | null = null
let smokeSawClosed = false
const smokeCurrentWindow = () => mainWindow

function smokeFailure(error: unknown) {
  console.error("[macos-probe]", error)
  fs.writeFileSync(smokePath!, JSON.stringify({ ok: false, error: String(error) }) + "\\n")
  app.quit()
}

function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
  const window = smokeCurrentWindow()
  if (!window) throw new Error("Missing macOS window")
  const cycle = ++smokeWindowCount
  if (cycle > 2) throw new Error("Unexpected extra macOS window")
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      const value = await window.webContents.executeJavaScript(${JSON.stringify(macRendererProbe)}, true)
      const report = { ok: true, isPackaged: app.isPackaged, execPath: process.execPath,
        appPath: app.getAppPath(), versions: process.versions, ...value, cycle,
        windowId: window.id, firstWindowId: smokeFirstWindowId,
        windowRecreated: cycle === 2 && smokeSawClosed && window.id !== smokeFirstWindowId }
      if (cycle === 1) {
        smokeFirstWindowId = window.id
        fs.writeFileSync(smokePath! + ".first.json", JSON.stringify(report, null, 2) + "\\n")
        window.once("closed", () => {
          setImmediate(() => {
            try {
              if (smokeCurrentWindow() !== null || !window.isDestroyed()) {
                throw new Error("Closed macOS window was not released")
              }
              smokeSawClosed = true
              app.emit("activate")
              if (!smokeCurrentWindow()) throw new Error("activate did not recreate the window")
            } catch (error) { smokeFailure(error) }
          })
        })
        window.close()
        return
      }
      if (!report.windowRecreated) throw new Error("Window lifecycle check failed")
      fs.writeFileSync(smokePath!, JSON.stringify(report, null, 2) + "\\n")
      // Run the product's before-quit cleanup instead of forcibly exiting.
      app.quit()
    })().catch(smokeFailure)
  })
}
`
    writeFileSync(file, original.slice(0, start) + injected + original.slice(end))
    return restore
  } catch (error) {
    restore()
    throw error
  }
}

export function assertMacProbe(file, { packaged, counter }) {
  const first = readJson(file + '.first.json')
  const final = readJson(file)
  for (const report of [first, final]) {
    assert.equal(report.ok, true, JSON.stringify(report))
    assert.equal(report.isPackaged, packaged)
    assert.equal(report.protocol, packaged ? 'frontron:' : 'http:')
    assert.equal(report.heading, 'Desktop app ready')
    assert.equal(report.appInfo?.platform, 'darwin')
    assert.equal(report.appInfo?.arch, 'arm64')
    assert.equal(report.security?.sandbox, true)
    assert.equal(report.security?.contextIsolation, true)
    assert.equal(report.requireType, 'undefined')
    assert.equal(report.processType, 'undefined')
    assert.equal(report.clipboardRoundtrip, true)
    if (counter) assert.equal(report.counterWorked, true)
    if (packaged) assert.equal(report.untrustedEventHandlerBlocked, true)
  }
  assert.equal(first.cycle, 1)
  assert.equal(final.cycle, 2)
  assert.equal(final.firstWindowId, first.windowId)
  assert.notEqual(final.windowId, first.windowId)
  assert.equal(final.windowRecreated, true)
  if (packaged) {
    assertSecureProbe(file, { counter })
    assert.equal(final.storageBefore, first.appInfo.name)
  }
  return { first, final }
}
