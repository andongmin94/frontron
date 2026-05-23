import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { runCreateFrontron } from '../src/index'

const initialCwd = process.cwd()
const initialUserAgent = process.env.npm_config_user_agent
const tempDirs: string[] = []

function createWorkspace(label: string) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `create-frontron-${label}-`)))
  tempDirs.push(root)
  return root
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  process.chdir(initialCwd)

  if (initialUserAgent === undefined) delete process.env.npm_config_user_agent
  else process.env.npm_config_user_agent = initialUserAgent

  vi.restoreAllMocks()

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('creates desktop-app when no project name is supplied', async () => {
  const workspace = createWorkspace('default-target')
  process.chdir(workspace)

  await runCreateFrontron([])

  expect(existsSync(join(workspace, 'desktop-app', 'package.json'))).toBe(true)
  expect(existsSync(join(workspace, 'desktop-app', 'src', 'electron', 'main.ts'))).toBe(true)
})

test('prints help without creating a project', async () => {
  const workspace = createWorkspace('help')
  process.chdir(workspace)

  await runCreateFrontron(['--help'])

  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('Usage: create-frontron [project-name]'),
  )
  expect(existsSync(join(workspace, 'desktop-app'))).toBe(false)
})

test('uses the final directory name for project metadata', async () => {
  const workspace = createWorkspace('nested')
  process.chdir(workspace)

  await runCreateFrontron(['products/My Desktop App'])

  const projectRoot = join(workspace, 'products', 'My Desktop App')
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    name: string
    productName: string
    build: { appId: string; productName: string }
  }

  expect(packageJson.name).toBe('my-desktop-app')
  expect(packageJson.productName).toBe('My Desktop App')
  expect(packageJson.build.productName).toBe('My Desktop App')
  expect(packageJson.build.appId).toBe('com.example.my-desktop-app')
})

test('rejects every existing target without changing it', async () => {
  const workspace = createWorkspace('existing-target')
  const target = join(workspace, 'existing-app')
  mkdirSync(target)
  writeFileSync(join(target, 'keep.txt'), 'user data\n')
  process.chdir(workspace)

  await expect(runCreateFrontron(['existing-app'])).rejects.toThrow('Target path already exists')

  expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('user data\n')
  expect(existsSync(join(target, 'package.json'))).toBe(false)
})

test('rejects the current directory even when it is otherwise empty', async () => {
  const workspace = createWorkspace('current-directory')
  process.chdir(workspace)

  await expect(runCreateFrontron(['.'])).rejects.toThrow('Target path already exists')
  expect(existsSync(join(workspace, 'package.json'))).toBe(false)
})

test('rejects unknown options and extra arguments', async () => {
  const workspace = createWorkspace('arguments')
  process.chdir(workspace)

  for (const option of ['--overwrite', '--template', '--unknown']) {
    await expect(runCreateFrontron(['app', option])).rejects.toThrow(`Unknown option: ${option}`)
  }
  await expect(runCreateFrontron(['app', 'extra'])).rejects.toThrow(
    'Unexpected positional argument: "extra"',
  )
})

test('rejects filesystem roots and symlinked ancestors', async () => {
  const workspace = createWorkspace('path-guards')
  const externalRoot = join(workspace, 'external')
  const linkedRoot = join(workspace, 'linked')
  mkdirSync(externalRoot)
  symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  process.chdir(workspace)

  await expect(runCreateFrontron([parse(workspace).root])).rejects.toThrow('filesystem root')
  await expect(runCreateFrontron(['linked/app'])).rejects.toThrow('symbolic link')
  expect(existsSync(join(externalRoot, 'app'))).toBe(false)
})

test('writes only the Yarn linker setting for Yarn consumers', async () => {
  const workspace = createWorkspace('yarn-config')
  process.chdir(workspace)
  process.env.npm_config_user_agent = 'yarn/4.9.2 npm/? node/v24.0.0 win32 x64'

  await runCreateFrontron(['app'])

  expect(console.log).toHaveBeenCalledWith('  yarn')
  expect(console.log).toHaveBeenCalledWith('  yarn app')
  expect(readFileSync(join(workspace, 'app', '.yarnrc.yml'), 'utf8')).toBe(
    'nodeLinker: node-modules\n',
  )
  expect(existsSync(join(workspace, 'app', 'yarn.lock'))).toBe(false)

  const packageJson = JSON.parse(readFileSync(join(workspace, 'app', 'package.json'), 'utf8')) as {
    trustedDependencies?: string[]
  }
  expect(packageJson.trustedDependencies).toBeUndefined()
})

test('writes pnpm Electron build approvals only for pnpm consumers', async () => {
  const workspace = createWorkspace('pnpm-config')
  process.chdir(workspace)
  process.env.npm_config_user_agent = 'pnpm/11.11.0 npm/? node/v24.0.0 linux x64'

  await runCreateFrontron(['app'])

  expect(readFileSync(join(workspace, 'app', 'pnpm-workspace.yaml'), 'utf8')).toBe(
    'allowBuilds:\n  electron: true\n  electron-winstaller: true\n',
  )
  expect(existsSync(join(workspace, 'app', '.yarnrc.yml'))).toBe(false)

  const packageJson = JSON.parse(readFileSync(join(workspace, 'app', 'package.json'), 'utf8')) as {
    trustedDependencies?: string[]
  }
  expect(packageJson.trustedDependencies).toBeUndefined()
})

test('writes Bun trust metadata only for Bun consumers', async () => {
  const workspace = createWorkspace('bun-config')
  process.chdir(workspace)
  process.env.npm_config_user_agent = 'bun/1.3.14 npm/? node/v24.0.0 linux x64'

  await runCreateFrontron(['app'])

  const packageJson = JSON.parse(readFileSync(join(workspace, 'app', 'package.json'), 'utf8')) as {
    trustedDependencies?: string[]
  }
  expect(packageJson.trustedDependencies).toEqual(['electron', 'electron-winstaller'])
  expect(existsSync(join(workspace, 'app', 'pnpm-workspace.yaml'))).toBe(false)
  expect(existsSync(join(workspace, 'app', '.yarnrc.yml'))).toBe(false)
})
