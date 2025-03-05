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

test('framework-first starter template wires the config-driven app shape', () => {
  const createPackage = fs.readJsonSync(join(CLI_PATH, 'package.json')) as {
    version: string
  }
  const expectedRustPackageName = `${projectName.replace(/[^a-z\d]+/gi, '_').toLowerCase()}_native`

  run([projectName], { cwd: __dirname })

  const packageJson = fs.readJsonSync(join(genPath, 'package.json')) as {
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const rootConfig = fs.readFileSync(join(genPath, 'frontron.config.ts'), 'utf-8')
  const appConfig = fs.readFileSync(join(genPath, 'frontron/config.ts'), 'utf-8')
  const bridgeConfig = fs.readFileSync(
    join(genPath, 'frontron/bridge/index.ts'),
    'utf-8',
  )
  const hooksConfig = fs.readFileSync(join(genPath, 'frontron/hooks/index.ts'), 'utf-8')
  const menuConfig = fs.readFileSync(join(genPath, 'frontron/menu.ts'), 'utf-8')
  const trayConfig = fs.readFileSync(join(genPath, 'frontron/tray.ts'), 'utf-8')
  const rustCargoToml = fs.readFileSync(join(genPath, 'frontron/rust/Cargo.toml'), 'utf-8')
  const rustLib = fs.readFileSync(join(genPath, 'frontron/rust/src/lib.rs'), 'utf-8')
  const windowsConfig = fs.readFileSync(
    join(genPath, 'frontron/windows/index.ts'),
    'utf-8',
  )
  const titleBar = fs.readFileSync(
    join(genPath, 'src/components/TitleBar.tsx'),
    'utf-8',
  )
  const app = fs.readFileSync(join(genPath, 'src/App.tsx'), 'utf-8')
  const main = fs.readFileSync(join(genPath, 'src/main.tsx'), 'utf-8')
  const indexCss = fs.readFileSync(join(genPath, 'src/index.css'), 'utf-8')
  const tsconfigApp = fs.readFileSync(join(genPath, 'tsconfig.app.json'), 'utf-8')
  const viteConfig = fs.readFileSync(join(genPath, 'vite.config.ts'), 'utf-8')

  expect(packageJson.scripts.dev).toBe('vite')
  expect(packageJson.scripts['web:dev']).toBe('vite')
  expect(packageJson.scripts.build).toBe('tsc -b && vite build')
  expect(packageJson.scripts['web:build']).toBe('tsc -b && vite build')
  expect(packageJson.scripts['app:dev']).toBe('frontron dev')
  expect(packageJson.scripts['app:build']).toBe('frontron build')
  expect(packageJson.scripts).not.toHaveProperty('app')
  expect(packageJson.dependencies.frontron).toBe(`^${createPackage.version}`)
  expect(packageJson.dependencies).toHaveProperty('cmdk')
  expect(packageJson.dependencies).toHaveProperty('recharts')
  expect(packageJson.dependencies).toHaveProperty('sonner')
  expect(packageJson.dependencies).toHaveProperty('tw-animate-css')
  expect(packageJson.dependencies).not.toHaveProperty('electron')
  expect(packageJson.dependencies).not.toHaveProperty('electron-builder')
  expect(packageJson.devDependencies).not.toHaveProperty('shadcn')
  expect(packageJson.devDependencies).not.toHaveProperty('cross-env')
  expect(packageJson.devDependencies).not.toHaveProperty('concurrently')
  expect(rootConfig).toContain("export { default } from './frontron/config'")
  expect(appConfig).toContain("import { defineConfig } from 'frontron'")
  expect(appConfig).toContain("command: 'npm run web:dev'")
  expect(appConfig).toContain("command: 'npm run web:build'")
  expect(appConfig).toContain('menu,')
  expect(appConfig).toContain('tray,')
  expect(appConfig).toContain('hooks,')
  expect(appConfig).toContain('rust:')
  expect(appConfig).toContain('enabled: false')
  expect(appConfig).toContain('bridge:')
  expect(appConfig).toContain("symbol: 'frontron_file_has_txt_extension'")
  expect(appConfig).toContain("symbol: 'frontron_system_cpu_count'")
  expect(appConfig).toContain("symbol: 'frontron_native_is_ready'")
  expect(appConfig).toContain("symbol: 'frontron_native_add'")
  expect(appConfig).toContain("symbol: 'frontron_native_average'")
  expect(bridgeConfig).toContain('getGreeting')
  expect(bridgeConfig).toContain('getSummary')
  expect(hooksConfig).toContain('beforeDev')
  expect(hooksConfig).toContain('afterPack')
  expect(menuConfig).toContain('Toggle Maximize')
  expect(menuConfig).toContain('Open Frontron Docs')
  expect(trayConfig).toContain('Show Window')
  expect(trayConfig).toContain('Quit')
  expect(rustCargoToml).toContain('[package]')
  expect(rustCargoToml).toContain(`name = "${expectedRustPackageName}"`)
  expect(rustCargoToml).toContain('crate-type = ["cdylib"]')
  expect(rustCargoToml).not.toContain('__FRONTRON_APP_SLUG__')
  expect(rustLib).toContain('frontron_file_has_txt_extension')
  expect(rustLib).toContain('frontron_system_cpu_count')
  expect(rustLib).toContain('frontron_native_ready')
  expect(rustLib).toContain('frontron_native_is_ready')
  expect(rustLib).toContain('frontron_native_add')
  expect(rustLib).toContain('frontron_native_average')
  expect(windowsConfig).toContain("route: '/'")
  expect(windowsConfig).toContain('frame: false')
  expect(titleBar).toContain('from "frontron/client"')
  expect(titleBar).toContain('Web preview')
  expect(titleBar).toContain('bridge.window')
  expect(titleBar).toContain('connectWindowBridge')
  expect(titleBar).toContain('bridge.window.onMaximizedChanged')
  expect(titleBar).toContain('runWindowAction')
  expect(app).toContain('Project ready!')
  expect(app).toContain('component base')
  expect(app).toContain('Web preview mode')
  expect(app).toContain('npm run app:dev')
  expect(app).toContain('bridge.system.getVersion()')
  expect(app).toContain('bridge.system.getPlatform()')
  expect(main).toContain('ThemeProvider')
  expect(main).toContain('TitleBar')
  expect(main).toContain('frontron-theme')
  expect(indexCss).not.toContain('shadcn/tailwind.css')
  expect(tsconfigApp).toContain('.frontron/types/**/*.d.ts')
  expect(viteConfig).not.toContain('}),,')
  expect(fs.existsSync(join(genPath, 'components.json'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'eslint.config.js'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/electron'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/App.css'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/lib/electron.ts'))).toBe(false)
  expect(fs.existsSync(join(genPath, 'src/components/ui/button.tsx'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/components/theme-provider.tsx'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/hooks/use-mobile.ts'))).toBe(true)
  expect(fs.existsSync(join(genPath, 'src/types/electron.d.ts'))).toBe(false)
})
