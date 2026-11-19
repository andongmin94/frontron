import { spawnSync } from 'node:child_process'
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
    build: {
      appId: string
      files: string[]
      npmRebuild: boolean
      productName: string
      icon: string
      win: { icon: string }
    }
  }
  const electronMain = readFileSync(join(projectRoot, 'src/electron/main.ts'), 'utf8')
  const electronWindow = readFileSync(join(projectRoot, 'src/electron/window.ts'), 'utf8')
  const electronPreload = readFileSync(join(projectRoot, 'src/electron/preload.ts'), 'utf8')
  const electronIpc = readFileSync(join(projectRoot, 'src/electron/ipc.ts'), 'utf8')
  const electronServe = readFileSync(join(projectRoot, 'src/electron/serve.ts'), 'utf8')
  const staticServer = readFileSync(join(projectRoot, 'src/electron/static-server.ts'), 'utf8')
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
  // 스타터는 shadcn/ui 전체 컴포넌트를 Base UI·Tailwind CSS 4 위에서 제공한다.
  for (const dependency of [
    'react',
    'react-dom',
    '@base-ui/react',
    'tailwindcss',
    '@tailwindcss/vite',
    'cn',
    'lucide-react',
  ]) {
    expect(packageJson.dependencies).toHaveProperty(dependency)
  }
  // shadcn CLI는 ts-morph를 통해 취약한 minimatch를 끌어오므로 tailwind.css를 eject해 의존성에서 뺀다.
  expect(packageJson.dependencies).not.toHaveProperty('shadcn')
  expect(packageJson.devDependencies).not.toHaveProperty('shadcn')
  expect(packageJson.devDependencies).toHaveProperty('electron')
  expect(packageJson.devDependencies).toHaveProperty('electron-builder')
  expect(packageJson.trustedDependencies).toBeUndefined()
  expect(packageJson.main).toBe('dist/electron/main.js')
  expect(packageJson.build.productName).toBe(projectName)
  expect(packageJson.build.appId).toBe(`com.example.${projectName}`)
  expect(packageJson.build.npmRebuild).toBe(false)
  expect(packageJson.build.files).toContain('!node_modules{,/**/*}')
  expect(packageJson.build.icon).toBe('public/icon.png')
  expect(packageJson.build.win.icon).toBe('public/icon.ico')
  expect(
    readFileSync(join(projectRoot, packageJson.build.icon)).subarray(0, 8).toString('hex'),
  ).toBe('89504e470d0a1a0a')
  expect(
    readFileSync(join(projectRoot, packageJson.build.win.icon)).subarray(0, 4).toString('hex'),
  ).toBe('00000100')

  expect(taskRunner).toContain('runBin("tsc", ["-p", "tsconfig.electron.json"])')
  expect(taskRunner).toContain('"dist/electron/serve.js"')
  expect(taskRunner).not.toContain('"src/electron/serve.ts"')
  expect(electronMain).toContain('protocol.registerSchemesAsPrivileged')
  expect(electronMain).toContain('ensureRendererCsp(responseHeaders)')
  expect(electronMain).toContain('createWindow(rendererUrl, setupIpcHandlers)')
  expect(electronMain).toContain('rendererShutdownPromise')
  expect(electronMain).toContain('rendererShutdownComplete')
  expect(electronMain).toContain('event.preventDefault()')
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
  expect(electronServe).toContain('if (electronProcess !== child || shuttingDown) return')
  expect(electronServe).toContain('if (!isCurrentProcess || shuttingDown) return')
  expect(electronServe).not.toContain('inferDevUrl')
  expect(electronServe).not.toContain('waitForUrlReady')
  expect(electronServe).not.toContain('watchLauncherSources')
  expect(electronServe).not.toContain('restartDevLauncher')
  expect(staticServer).toContain('server.closeIdleConnections()')
  expect(staticServer).toContain('server.closeAllConnections()')
  expect(rendererMain).not.toContain('ThemeProvider')
  expect(rendererApp).toContain('window.electron')

  const components = JSON.parse(readFileSync(join(projectRoot, 'components.json'), 'utf8')) as {
    style: string
    tailwind: { css: string }
    aliases: { ui: string; utils: string }
  }
  expect(components.style).toBe('base-nova')
  expect(components.tailwind.css).toBe('src/index.css')
  expect(components.aliases).toMatchObject({ ui: '@/components/ui', utils: '@/lib/utils' })
  for (const component of ['button', 'card', 'dialog', 'sidebar', 'tooltip']) {
    expect(existsSync(join(projectRoot, `src/components/ui/${component}.tsx`))).toBe(true)
  }
  expect(readFileSync(join(projectRoot, 'src/index.css'), 'utf8')).not.toContain(
    '@import "shadcn/tailwind.css"',
  )
  expect(rendererApp).toContain('@/components/ui/button')
  // release-rehearsal의 실제 Electron 프로브가 이 제목과 상태 요소로 마운트·IPC를 확인한다.
  expect(rendererApp).toMatch(/<h1[^>]*>Desktop app ready<\/h1>/)
  expect(rendererApp).toMatch(/className="status[ "]/)
  expect(existsSync(join(projectRoot, 'src/assets'))).toBe(false)
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

// 새 프로젝트의 `npm run format:check`가 생성 직후부터 통과해야 한다.
// 템플릿은 create-frontron 저장소 포매터 설정에서 제외되므로 생성된 프로젝트의 설정으로 확인한다.
test('a generated starter passes its own format check', async () => {
  const workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'create-frontron-format-')))
  const projectRoot = join(workspace, 'format-smoke-app')
  tempDirs.push(workspace)
  process.chdir(workspace)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)

  await runCreateFrontron(['format-smoke-app'])

  const oxfmt = join(import.meta.dirname, '..', 'node_modules', 'oxfmt', 'bin', 'oxfmt')
  const result = spawnSync(
    process.execPath,
    [oxfmt, '--check', 'src', 'scripts', 'vite.config.ts', 'package.json'],
    { cwd: projectRoot, encoding: 'utf8' },
  )

  expect(result.stdout + result.stderr).toContain('All matched files use the correct format')
  expect(result.status).toBe(0)
})
