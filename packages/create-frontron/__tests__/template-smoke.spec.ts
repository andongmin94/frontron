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

test('generated template keeps the starter sample while preserving hard fixes', () => {
  run([projectName], { cwd: __dirname })

  const preload = fs.readFileSync(
    join(genPath, 'src/electron/preload.ts'),
    'utf-8',
  )
  const titleBar = fs.readFileSync(
    join(genPath, 'src/components/TitleBar.tsx'),
    'utf-8',
  )
  const windowFile = fs.readFileSync(
    join(genPath, 'src/electron/window.ts'),
    'utf-8',
  )
  const app = fs.readFileSync(join(genPath, 'src/App.tsx'), 'utf-8')
  const viteConfig = fs.readFileSync(join(genPath, 'vite.config.ts'), 'utf-8')

  expect(preload).toContain('invoke:')
  expect(preload).toContain('require("electron")')
  expect(preload).toContain('return () => ipcRenderer.removeListener')
  expect(titleBar).toContain('window.electron')
  expect(titleBar).toContain('Preload bridge missing')
  expect(windowFile).toContain('Boolean(window.electron)')
  expect(windowFile).toContain('Preload script not found')
  expect(app).toContain('count is {count}')
  expect(app).toContain('Edit <code>src/App.tsx</code> and save to test HMR')
  expect(app).toContain('process?.versions')
  expect(viteConfig).not.toContain('}),,')
})
