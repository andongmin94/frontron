import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { runCreateFrontron } from '../src/index'

const initialCwd = process.cwd()
const tempDirs: string[] = []

afterEach(() => {
  process.chdir(initialCwd)
  vi.restoreAllMocks()

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('starter template exposes the supported Electron and React contract', async () => {
  const workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-frontron-template-')))
  const projectName = 'template-smoke-app'
  const projectRoot = join(workspace, projectName)
  tempDirs.push(workspace)
  process.chdir(workspace)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)

  await runCreateFrontron([projectName])

  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    private: boolean
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    trustedDependencies?: string[]
    main: string
    build: { appId: string; files: string[]; npmRebuild: boolean; productName: string }
  }
  const electronMain = readFileSync(join(projectRoot, 'src/electron/main.ts'), 'utf8')
  const electronWindow = readFileSync(join(projectRoot, 'src/electron/window.ts'), 'utf8')
  const electronPreload = readFileSync(join(projectRoot, 'src/electron/preload.ts'), 'utf8')
  const electronIpc = readFileSync(join(projectRoot, 'src/electron/ipc.ts'), 'utf8')
  const electronServe = readFileSync(join(projectRoot, 'src/electron/serve.ts'), 'utf8')
  const rendererMain = readFileSync(join(projectRoot, 'src/main.tsx'), 'utf8')
  const rendererApp = readFileSync(join(projectRoot, 'src/App.tsx'), 'utf8')
  const taskRunner = readFileSync(join(projectRoot, 'scripts/tasks.mjs'), 'utf8')

  expect(packageJson.private).toBe(true)
  expect(packageJson.scripts).toMatchObject({
    app: 'node scripts/tasks.mjs app',
    build: 'node scripts/tasks.mjs build',
    dev: 'node scripts/tasks.mjs dev',
    lint: 'node scripts/tasks.mjs lint',
    format: 'node scripts/tasks.mjs format',
    'format:check': 'node scripts/tasks.mjs format:check',
    typecheck: 'node scripts/tasks.mjs typecheck',
  })
  expect(packageJson.dependencies).toEqual({
    react: '^19.2.4',
    'react-dom': '^19.2.4',
  })
  expect(packageJson.devDependencies).toHaveProperty('electron')
  expect(packageJson.devDependencies).toHaveProperty('electron-builder')
  expect(packageJson.devDependencies).not.toHaveProperty('tailwindcss')
  expect(packageJson.devDependencies).not.toHaveProperty('@tailwindcss/vite')
  expect(packageJson.trustedDependencies).toEqual(['electron', 'electron-winstaller'])
  expect(packageJson.main).toBe('dist/electron/main.js')
  expect(packageJson.build.productName).toBe(projectName)
  expect(packageJson.build.appId).toBe(`com.example.${projectName}`)
  expect(packageJson.build.npmRebuild).toBe(false)
  expect(packageJson.build.files).toContain('!node_modules{,/**/*}')

  expect(taskRunner).toContain('runBin("tsc", ["-p", "tsconfig.electron.json"])')
  expect(taskRunner).toContain('"dist/electron/serve.js"')
  expect(taskRunner).not.toContain('"src/electron/serve.ts"')
  expect(electronMain).toContain('protocol.registerSchemesAsPrivileged')
  expect(electronMain).toContain('ensureRendererCsp(responseHeaders)')
  expect(electronMain).toContain('createWindow(rendererUrl, setupIpcHandlers)')
  expect(electronMain).not.toContain('FRONTRON_RENDERER_PROBE_PATH')
  expect(electronMain).not.toContain('inferDevUrl')
  expect(electronMain).not.toContain('waitForUrlReady')
  expect(electronWindow).toContain('contextIsolation: true')
  expect(electronWindow).toContain('nodeIntegration: false')
  expect(electronWindow).toContain('sandbox: true')
  expect(electronWindow).toContain('setWindowOpenHandler')
  expect(electronWindow).not.toContain('frame: false')
  expect(electronWindow).not.toContain('resizable: isDev')
  expect(electronWindow).not.toContain('FRONTRON_RENDERER_PROBE_PATH')
  expect(electronPreload).toContain('getAppInfo')
  expect(electronPreload).toContain('openTextFile')
  expect(electronPreload).toContain('saveTextFile')
  expect(electronPreload).toContain('readClipboardText')
  expect(electronPreload).toContain('writeClipboardText')
  expect(electronPreload).toContain('showNotification')
  expect(electronIpc).toContain('assertTrustedSender')
  expect(electronIpc).toContain('event.senderFrame !== window.webContents.mainFrame')
  expect(electronIpc).toContain('dialog.showOpenDialog')
  expect(electronIpc).toContain('dialog.showSaveDialog')
  expect(electronIpc).toContain('clipboard.writeText')
  expect(electronIpc).toContain('Notification.isSupported')
  expect(electronServe).toContain('createWatchCompilerHost')
  expect(electronServe).toContain('queueElectronRestart')
  expect(electronServe).not.toContain('inferDevUrl')
  expect(electronServe).not.toContain('waitForUrlReady')
  expect(electronServe).not.toContain('watchLauncherSources')
  expect(electronServe).not.toContain('restartDevLauncher')
  expect(rendererMain).not.toContain('ThemeProvider')
  expect(rendererApp).toContain('window.electron')

  expect(existsSync(join(projectRoot, 'src/components'))).toBe(false)
  expect(existsSync(join(projectRoot, 'src/assets'))).toBe(false)
  expect(existsSync(join(projectRoot, 'src/lib'))).toBe(false)
  expect(existsSync(join(projectRoot, 'components.json'))).toBe(false)
  expect(existsSync(join(projectRoot, 'public/vite.svg'))).toBe(false)
  expect(existsSync(join(projectRoot, 'src/electron/static-server.ts'))).toBe(true)
  expect(existsSync(join(projectRoot, 'src/electron/tray.ts'))).toBe(false)
  expect(existsSync(join(projectRoot, 'src/electron/splash.ts'))).toBe(false)
  expect(existsSync(join(projectRoot, 'src/types/electron.d.ts'))).toBe(true)
  expect(existsSync(join(projectRoot, 'tsconfig.electron.json'))).toBe(true)
  expect(existsSync(join(projectRoot, 'scripts/tasks.mjs'))).toBe(true)
  expect(existsSync(join(projectRoot, 'frontron.config.ts'))).toBe(false)
  expect(existsSync(join(projectRoot, 'dist'))).toBe(false)
  expect(existsSync(join(projectRoot, '.npmignore'))).toBe(false)
})
