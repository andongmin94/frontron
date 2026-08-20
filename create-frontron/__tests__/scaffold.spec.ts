import fs from 'node:fs'
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
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { resolveTargetRoot, scaffoldProject } from '../src/scaffold'

const tempDirs: string[] = []

function createWorkspace(label: string) {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), `create-frontron-scaffold-${label}-`)),
  )
  tempDirs.push(root)
  return root
}

function createTemplate(workspace: string) {
  const templateRoot = join(workspace, 'template')
  mkdirSync(join(templateRoot, 'src'), { recursive: true })
  writeFileSync(join(templateRoot, '_gitignore'), 'node_modules\n')
  writeFileSync(join(templateRoot, 'src', 'main.ts'), 'export const ready = true\n')
  writeFileSync(join(templateRoot, 'package.json'), '{"name":"template"}\n')
  return templateRoot
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('copies the template into a newly claimed target', () => {
  const workspace = createWorkspace('success')
  const templateRoot = createTemplate(workspace)
  const targetRoot = join(workspace, 'app')

  scaffoldProject(templateRoot, targetRoot, { name: 'app' })

  expect(readFileSync(join(targetRoot, '.gitignore'), 'utf8')).toBe('node_modules\n')
  expect(readFileSync(join(targetRoot, 'src', 'main.ts'), 'utf8')).toContain('ready = true')
  expect(JSON.parse(readFileSync(join(targetRoot, 'package.json'), 'utf8')).name).toBe('app')
})

test('removes a newly created target when copying fails', () => {
  const workspace = createWorkspace('copy-failure')
  const templateRoot = createTemplate(workspace)
  const targetRoot = join(workspace, 'app')

  vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
    throw new Error('injected copy failure')
  })

  expect(() => scaffoldProject(templateRoot, targetRoot, { name: 'app' })).toThrow(
    'No existing project was changed',
  )
  expect(existsSync(targetRoot)).toBe(false)
})

test('never removes or modifies an existing target', () => {
  const workspace = createWorkspace('existing')
  const templateRoot = createTemplate(workspace)
  const targetRoot = join(workspace, 'app')
  mkdirSync(targetRoot)
  writeFileSync(join(targetRoot, 'keep.txt'), 'keep\n')

  expect(() => scaffoldProject(templateRoot, targetRoot, { name: 'app' })).toThrow(
    'Target path already exists',
  )
  expect(readFileSync(join(targetRoot, 'keep.txt'), 'utf8')).toBe('keep\n')
})

test('rejects symbolic links inside the template and cleans the target', () => {
  const workspace = createWorkspace('template-link')
  const templateRoot = createTemplate(workspace)
  const externalRoot = join(workspace, 'external')
  const targetRoot = join(workspace, 'app')
  mkdirSync(externalRoot)
  symlinkSync(
    externalRoot,
    join(templateRoot, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  expect(() => scaffoldProject(templateRoot, targetRoot, { name: 'app' })).toThrow(
    'Template entries must not be symbolic links',
  )
  expect(existsSync(targetRoot)).toBe(false)
})

test('resolves nested missing targets from the real existing parent', () => {
  const workspace = createWorkspace('resolve')
  const targetRoot = resolveTargetRoot(workspace, 'nested/app')

  expect(targetRoot).toBe(join(workspace, 'nested', 'app'))
})
