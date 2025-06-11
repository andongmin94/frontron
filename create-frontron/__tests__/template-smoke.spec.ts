import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncOptions } from 'execa'
import { execaCommandSync } from 'execa'
import fs from 'fs-extra'
import { afterEach, beforeAll, expect, test } from 'vitest'

const CLI_PATH = join(__dirname, '..')
const projectName = 'beginner-docs-smoke'
const genPath = join(__dirname, projectName)

const run = (args: string[], options: SyncOptions = {}): ReturnType<typeof execaCommandSync> => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, options)
}

function removeGeneratedProject() {
  rmSync(genPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}

beforeAll(removeGeneratedProject)
afterEach(removeGeneratedProject)

test('starter template restores the template-owned electron structure', () => {
  run([projectName], { cwd: __dirname })

  const packageJson = fs.readJsonSync(join(genPath, 'package.json')) as {
    private?: boolean
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    main?: string
    build?: {
      productName?: string
      appId?: string
      npmRebuild?: boolean
      files?: string[]
    }
  }
  const titleBar = fs.readFileSync(join(genPath, 'src/components/TitleBar.tsx'), 'utf-8')
  const app = fs.readFileSync(join(genPath, 'src/App.tsx'), 'utf-8')
  const main = fs.readFileSync(join(genPath, 'src/main.tsx'), 'utf-8')
  const utils = fs.readFileSync(join(genPath, 'src/lib/utils.ts'), 'utf-8')
  const tsconfigApp = fs.readFileSync(join(genPath, 'tsconfig.app.json'), 'utf-8')
  const tsconfigElectron = fs.readFileSync(join(genPath, 'tsconfig.electron.json'), 'utf-8')
  const viteConfig = fs.readFileSync(join(genPath, 'vite.config.ts'), 'utf-8')
  const electronMain = fs.readFileSync(join(genPath, 'src/electron/main.ts'), 'utf-8')
  const electronServe = fs.readFileSync(join(genPath, 'src/electron/serve.ts'), 'utf-8')
  const electronPreload = fs.readFileSync(join(genPath, 'src/electron/preload.ts'), 'utf-8')
  const electronWindow = fs.readFileSync(join(genPath, 'src/electron/window.ts'), 'utf-8')
  const electronSplash = fs.readFileSync(join(genPath, 'src/electron/splash.ts'), 'utf-8')
  const electronTray = fs.readFileSync(join(genPath, 'src/electron/tray.ts'), 'utf-8')
  const electronTypes = fs.readFileSync(join(genPath, 'src/types/electron.d.ts'), 'utf-8')
  const tasksSource = fs.readFileSync(join(genPath, 'scripts/tasks.mjs'), 'utf-8')
  const htmlSource = fs.readFileSync(join(genPath, 'index.html'), 'utf-8')
  const indexCss = fs.readFileSync(join(genPath, 'src/index.css'), 'utf-8')
  const templateReadme = fs.readFileSync(join(genPath, 'README.md'), 'utf-8')
  const uiEntries = fs.readdirSync(join(genPath, 'src/components/ui')).sort()

  expect(packageJson.private).toBe(true)
  expect(packageJson.scripts.dev).toBe('node scripts/tasks.mjs dev')
  expect(packageJson.scripts.app).toBe('node scripts/tasks.mjs app')
  expect(packageJson.scripts.typecheck).toBe('node scripts/tasks.mjs typecheck')
  expect(packageJson.scripts.build).toBe('node scripts/tasks.mjs build')
  expect(packageJson.scripts.lint).toBe('node scripts/tasks.mjs lint')
  expect(packageJson.scripts).not.toHaveProperty('web:dev')
  expect(packageJson.scripts).not.toHaveProperty('web:build')
  expect(packageJson.scripts).not.toHaveProperty('app:dev')
  expect(packageJson.scripts).not.toHaveProperty('app:build')
  for (const dependency of [
    'cmdk',
    'embla-carousel-react',
    'input-otp',
    'next-themes',
    'react-day-picker',
    'react-resizable-panels',
    'recharts',
    'sonner',
    'vaul',
  ]) {
    expect(packageJson.dependencies).not.toHaveProperty(dependency)
  }
  expect(packageJson.dependencies).toHaveProperty('tw-animate-css')
  expect(packageJson.dependencies).not.toHaveProperty('electron')
  expect(packageJson.dependencies).not.toHaveProperty('frontron')
  expect(packageJson.devDependencies).toHaveProperty('electron')
  expect(packageJson.dependencies).not.toHaveProperty('electron-builder')
  expect(packageJson.devDependencies).toHaveProperty('electron-builder')
  expect(packageJson.build?.npmRebuild).toBe(false)
  expect(packageJson.build?.files).toContain('!node_modules{,/**/*}')
  expect(packageJson.devDependencies).not.toHaveProperty('concurrently')
  expect(packageJson.devDependencies).not.toHaveProperty('cross-env')
  expect(packageJson.main).toBe('dist/electron/main.js')
  expect(packageJson.build?.productName).toBe(projectName)
  expect(packageJson.build?.appId).toContain(projectName)
  expect(titleBar).toContain('getDesktopBridgeRuntime')
  expect(titleBar).toContain('Desktop App')
  expect(titleBar).toContain('onWindowMaximizedChanged')
  expect(titleBar).not.toContain('frontron/client')
  expect(titleBar).not.toContain('Frontron')
  expect(app).toContain('Electron template ready')
  expect(app).toContain('npm run app')
  expect(app).toContain('getDesktopBridgeRuntime')
  expect(utils).toContain('window.electron')
  expect(main).toContain('desktop-template-theme')
  expect(tsconfigApp).toContain('src/types/**/*.d.ts')
  expect(tsconfigApp).not.toContain('.frontron/types')
  expect(tsconfigElectron).toContain('src/electron/**/*.ts')
  expect(viteConfig).not.toContain('}),,')
  expect(electronMain).toContain('createWindow')
  expect(electronMain).toContain('rendererUrl = await waitForUrlReady(rendererUrl)')
  expect(electronMain).toContain('protocol.registerSchemesAsPrivileged')
  expect(electronMain).toContain('await registerRendererProtocol(rendererTargetUrl)')
  expect(electronMain).toContain('ensureRendererCsp(responseHeaders)')
  expect(electronMain).toContain('rendererUrl = `${rendererOrigin}/`')
  expect(electronMain).toContain('await createTray()')
  expect(electronServe).toContain('function createLoopbackUrlCandidates')
  expect(electronPreload).toContain('exposeInMainWorld("electron"')
  expect(electronWindow).toContain('preload')
  expect(electronWindow).toContain('webContents.on("will-frame-navigate"')
  expect(electronWindow).toContain('setWindowOpenHandler')
  expect(electronWindow).toContain(
    '...(existsSync(windowIconPath) ? { icon: windowIconPath } : {})',
  )
  expect(electronWindow).not.toContain('onHeadersReceived')
  expect(electronWindow).not.toContain('Content-Security-Policy')
  expect(electronTray).toContain('app.getFileIcon(process.execPath)')
  expect(electronSplash).toContain('font-family: system-ui, sans-serif')
  expect(electronSplash).not.toContain('Pretendard')
  expect(indexCss).toContain('@import "@fontsource-variable/geist"')
  expect(indexCss).toContain('font-family: "Geist Variable", sans-serif')
  expect(indexCss).not.toContain('Pretendard')
  expect(tasksSource).toContain('getElectronBuilderArgs(extraArgs)')
  expect(tasksSource).toContain('["--publish", "never", ...args]')
  expect(tasksSource).toContain('"--experimental-strip-types"')
  expect(tasksSource).toContain('formatPackageJson()')
  expect(tasksSource).not.toContain('case "format-package-json"')
  expect(electronServe).not.toContain('ELECTRON_DISABLE_SECURITY_WARNINGS')
  expect(htmlSource).toContain('http-equiv="Content-Security-Policy"')
  expect(electronTypes).toContain('interface Window')
  expect(titleBar).toContain('Web preview')
  expect(main).toContain('ThemeProvider')
  expect(main).toContain('TitleBar')
  expect(fs.existsSync(join(genPath, 'components.json'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'scripts', 'tasks.mjs'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'eslint.config.js'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/electron'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/App.css'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/types/electron.d.ts'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'tsconfig.electron.json'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'frontron.config.ts'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'frontron'))).toBe(false)
  expect(uiEntries).toEqual(['button.tsx', 'dialog.tsx'])
  expect(fs.existsSync(join(genPath, 'public/fonts/PretendardVariable.woff2'))).toBe(false)
  expect(templateReadme).toContain('only `button.tsx` and `dialog.tsx`')
  expect(fs.existsSync(join(genPath, 'src/components/theme-provider.tsx'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/hooks/use-mobile.ts'))).toBe(false)
})
