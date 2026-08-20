import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { resolveWorkspaceProject } from '../src/workspace-project'

const tempDirs: string[] = []

function createWorkspace(label: string) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `frontron-workspace-${label}-`)))
  tempDirs.push(root)
  return root
}

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writePackage(root: string, relativePath: string, value: unknown) {
  const packageRoot = join(root, relativePath)
  mkdirSync(packageRoot, { recursive: true })
  writeJson(join(packageRoot, 'package.json'), value)
  return packageRoot
}

function frontendPackage(name: string) {
  return {
    name,
    private: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    devDependencies: {
      vite: '^8.0.0',
    },
  }
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('discovers the only compatible package.json workspace frontend', () => {
  const root = createWorkspace('single')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
    workspaces: ['apps/*'],
  })
  const frontendRoot = writePackage(root, 'apps/web', frontendPackage('web'))
  writePackage(root, 'apps/api', {
    name: 'api',
    private: true,
    scripts: { build: 'tsc' },
  })

  expect(resolveWorkspaceProject(root, 'init')).toEqual({
    invocationRoot: root,
    projectRoot: frontendRoot,
    source: 'workspace',
  })
})

test('discovers a pnpm workspace frontend', () => {
  const root = createWorkspace('pnpm')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
  })
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8')
  const frontendRoot = writePackage(root, 'packages/desktop-web', frontendPackage('desktop-web'))

  expect(resolveWorkspaceProject(root, 'init').projectRoot).toBe(frontendRoot)
})

test('uses an explicit project when multiple frontends exist', () => {
  const root = createWorkspace('explicit')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
    workspaces: ['apps/*'],
  })
  writePackage(root, 'apps/customer', frontendPackage('customer'))
  const adminRoot = writePackage(root, 'apps/admin', frontendPackage('admin'))

  expect(resolveWorkspaceProject(root, 'init', 'apps/admin')).toEqual({
    invocationRoot: root,
    projectRoot: adminRoot,
    source: 'option',
  })
})

test('uses package.json frontron.project before automatic discovery', () => {
  const root = createWorkspace('config')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
    workspaces: ['apps/*'],
    frontron: {
      project: 'apps/admin',
    },
  })
  writePackage(root, 'apps/customer', frontendPackage('customer'))
  const adminRoot = writePackage(root, 'apps/admin', frontendPackage('admin'))

  expect(resolveWorkspaceProject(root, 'init')).toEqual({
    invocationRoot: root,
    projectRoot: adminRoot,
    source: 'config',
  })
})

test('requires an explicit project when multiple frontends match', () => {
  const root = createWorkspace('ambiguous')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
    workspaces: ['apps/*'],
  })
  writePackage(root, 'apps/customer', frontendPackage('customer'))
  writePackage(root, 'apps/admin', frontendPackage('admin'))

  expect(() => resolveWorkspaceProject(root, 'init')).toThrow(
    'Multiple frontend workspace projects matched',
  )
})

test('lifecycle commands prefer the only initialized workspace package', () => {
  const root = createWorkspace('initialized')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
    workspaces: ['apps/*'],
  })
  writePackage(root, 'apps/customer', frontendPackage('customer'))
  const adminRoot = writePackage(root, 'apps/admin', frontendPackage('admin'))
  mkdirSync(join(adminRoot, '.frontron'), { recursive: true })
  writeFileSync(join(adminRoot, '.frontron', 'manifest.json'), '{}\n', 'utf8')

  expect(resolveWorkspaceProject(root, 'doctor').projectRoot).toBe(adminRoot)
})

test('rejects project paths outside the workspace root', () => {
  const root = createWorkspace('escape')
  writeJson(join(root, 'package.json'), {
    name: 'workspace-root',
    private: true,
  })

  expect(() => resolveWorkspaceProject(root, 'init', '../outside')).toThrow(
    '--project must stay inside the workspace root',
  )
})
