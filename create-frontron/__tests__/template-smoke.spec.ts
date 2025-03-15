import { join } from 'node:path'
import type { SyncOptions } from 'execa'
import { execaCommandSync } from 'execa'
import fs from 'fs-extra'
import { afterEach, beforeAll, expect, test } from 'vitest'

const CLI_PATH = join(__dirname, '..')
const projectName = 'beginner-docs-smoke'
const genPath = join(__dirname, projectName)

const run = (
  args: string[],
  options: SyncOptions = {},
): ReturnType<typeof execaCommandSync> => {
  return execaCommandSync(`node ${CLI_PATH} ${args.join(' ')}`, options)
}

beforeAll(() => fs.remove(genPath))
afterEach(() => fs.remove(genPath))

test('starter template restores the template-owned electron structure', () => {
  run([projectName], { cwd: __dirname })

  const packageJson = fs.readJsonSync(join(genPath, 'package.json')) as {
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    main?: string
    build?: {
      productName?: string
      appId?: string
    }
  }
  const titleBar = fs.readFileSync(
    join(genPath, 'src/components/TitleBar.tsx'),
    'utf-8',
  )
  const app = fs.readFileSync(join(genPath, 'src/App.tsx'), 'utf-8')
  const main = fs.readFileSync(join(genPath, 'src/main.tsx'), 'utf-8')
  const utils = fs.readFileSync(join(genPath, 'src/lib/utils.ts'), 'utf-8')
  const tsconfigApp = fs.readFileSync(join(genPath, 'tsconfig.app.json'), 'utf-8')
  const tsconfigElectron = fs.readFileSync(
    join(genPath, 'tsconfig.electron.json'),
    'utf-8',
  )
  const viteConfig = fs.readFileSync(join(genPath, 'vite.config.ts'), 'utf-8')
  const electronMain = fs.readFileSync(join(genPath, 'src/electron/main.ts'), 'utf-8')
  const electronPreload = fs.readFileSync(
    join(genPath, 'src/electron/preload.ts'),
    'utf-8',
  )
  const electronWindow = fs.readFileSync(
    join(genPath, 'src/electron/window.ts'),
    'utf-8',
  )
  const electronTypes = fs.readFileSync(
    join(genPath, 'src/types/electron.d.ts'),
    'utf-8',
  )

  expect(packageJson.scripts.dev).toBe('vite')
  expect(packageJson.scripts.app).toContain('src/electron/serve.ts')
  expect(packageJson.scripts.build).toContain('electron-builder')
  expect(packageJson.scripts).not.toHaveProperty('web:dev')
  expect(packageJson.scripts).not.toHaveProperty('web:build')
  expect(packageJson.scripts).not.toHaveProperty('app:dev')
  expect(packageJson.scripts).not.toHaveProperty('app:build')
  expect(packageJson.dependencies).toHaveProperty('cmdk')
  expect(packageJson.dependencies).toHaveProperty('express')
  expect(packageJson.dependencies).toHaveProperty('recharts')
  expect(packageJson.dependencies).toHaveProperty('sonner')
  expect(packageJson.dependencies).toHaveProperty('tw-animate-css')
  expect(packageJson.dependencies).not.toHaveProperty('electron')
  expect(packageJson.dependencies).not.toHaveProperty('frontron')
  expect(packageJson.devDependencies).toHaveProperty('electron')
  expect(packageJson.dependencies).not.toHaveProperty('electron-builder')
  expect(packageJson.devDependencies).toHaveProperty('electron-builder')
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
  expect(electronPreload).toContain('exposeInMainWorld("electron"')
  expect(electronWindow).toContain('preload')
  expect(electronTypes).toContain('interface Window')
  expect(titleBar).toContain('Web preview')
  expect(main).toContain('ThemeProvider')
  expect(main).toContain('TitleBar')
  expect(fs.existsSync(join(genPath, 'components.json'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'eslint.config.js'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/electron'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/App.css'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/types/electron.d.ts'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'tsconfig.electron.json'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'frontron.config.ts'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'frontron'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/components/ui/button.tsx'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/components/theme-provider.tsx'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/hooks/use-mobile.ts'))).toBe(true)
})
