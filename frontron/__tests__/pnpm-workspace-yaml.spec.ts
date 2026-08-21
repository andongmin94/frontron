import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import {
  previewPnpmWorkspaceYamlPatch,
  readPnpmWorkspaceYamlClaimValue,
  restorePnpmWorkspaceYamlClaim,
} from '../src/init/pnpm-workspace-yaml'
import * as fixtures from './helpers/frontron-cli-fixtures'

function setPnpmPackageManager(projectRoot: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: string
  }
  packageJson.packageManager = 'pnpm@11.11.0'
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function createNestedPnpmWorkspace() {
  const workspaceRoot = fixtures.createTempProject()
  const appRoot = join(workspaceRoot, 'apps', 'web')
  fixtures.tempDirs.push(workspaceRoot)
  mkdirSync(appRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
  writeFileSync(
    join(appRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'nested-web-app',
        version: '0.0.1',
        packageManager: 'pnpm@11.11.0',
        scripts: { dev: 'vite --port 5180', build: 'vite build' },
        devDependencies: { vite: '^8.0.1' },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(appRoot, 'vite.config.ts'), 'export default {}\n')
  return { workspaceRoot, appRoot }
}

function runPnpm11(cwd: string, args: string[]) {
  const invocation =
    process.platform === 'win32'
      ? {
          command: process.env.ComSpec ?? 'cmd.exe',
          args: ['/d', '/s', '/c', 'npx', '--yes', 'pnpm@11', '--dir', cwd, ...args],
        }
      : {
          command: 'npx',
          args: ['--yes', 'pnpm@11', '--dir', cwd, ...args],
        }
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', shell: false })

  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout)
  }

  return result.stdout.trim()
}

describe('pnpm workspace config', () => {
  test('sets the required allowBuilds values while retaining unrelated data', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = `packages:\n  - apps/*\nallowBuilds:\n  esbuild: false\ncatalog:\n  react: ^19\n`
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)

    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')!
    const value = parse(plan.nextSource) as {
      packages: string[]
      catalog: { react: string }
      allowBuilds: Record<string, boolean>
    }

    expect(plan.blockers).toEqual([])
    expect(value.packages).toEqual(['apps/*'])
    expect(value.catalog).toEqual({ react: '^19' })
    expect(value.allowBuilds).toEqual({
      esbuild: false,
      electron: true,
      'electron-winstaller': true,
    })
  })

  test('ownership claims restore previous values without deleting unrelated settings', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = 'allowBuilds:\n  electron: false\n  esbuild: false\n'
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)
    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')!
    const restored = plan.ownershipClaims.reduce(
      (current, claim) => restorePnpmWorkspaceYamlClaim(current, claim),
      plan.nextSource,
    )

    expect(parse(restored)).toEqual(parse(source))
  })

  test.each([
    ['alias', 'defaults: &defaults\n  electron: true\nallowBuilds: *defaults\n', 'aliases'],
    ['flow target', 'allowBuilds: { electron: false }\n', 'block mapping'],
    ['duplicate key', 'allowBuilds:\n  electron: false\n  electron: true\n', 'Map keys'],
    ['complex target', 'allowBuilds:\n  electron:\n    approved: true\n', 'simple scalar'],
  ])('blocks an unsafe %s without changing the source', (_label, source, reason) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)

    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')!
    expect(plan.blockers.join('\n')).toContain(reason)
    expect(plan.nextSource).toBe(source)
    expect(plan.ownershipClaims).toEqual([])
  })

  test('reports claim values and ignores non-pnpm projects', () => {
    expect(previewPnpmWorkspaceYamlPatch('/tmp', 'npm')).toBeNull()
    expect(
      readPnpmWorkspaceYamlClaimValue('allowBuilds:\n  electron: true\n', 'allowBuilds.electron'),
    ).toEqual({ exists: true, value: true, safeToEdit: true })
  })

  test('blocks a hard-linked workspace file', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const sharedPath = join(projectRoot, 'shared-workspace.yaml')
    writeFileSync(sharedPath, 'packages: []\n')
    linkSync(sharedPath, join(projectRoot, 'pnpm-workspace.yaml'))

    expect(previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')?.blockers.join('\n')).toContain(
      'exactly one hard link',
    )
  })

  test('init and clean retain the workspace configuration semantically', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    const original = 'packages:\n  - apps/*\nallowBuilds:\n  esbuild: false\n'
    writeFileSync(workspacePath, original)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(parse(readFileSync(workspacePath, 'utf8'))).toEqual(parse(original))
  })

  test('default and nested generation write the pnpm 11 allowBuilds map', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(parse(readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8'))).toMatchObject({
      allowBuilds: { electron: true, 'electron-winstaller': true },
    })

    const { workspaceRoot, appRoot } = createNestedPnpmWorkspace()
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: appRoot })).toBe(0)
    expect(parse(readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8'))).toMatchObject({
      allowBuilds: { electron: true, 'electron-winstaller': true },
    })
    expect(existsSync(join(appRoot, 'pnpm-workspace.yaml'))).toBe(false)
  })

  test.skipIf(process.env.FRONTRON_TEST_PNPM_11 !== '1')(
    'actual pnpm 11 reads default and nested generated workspace settings',
    async () => {
      const projectRoot = fixtures.createTempProject()
      fixtures.tempDirs.push(projectRoot)
      setPnpmPackageManager(projectRoot)

      expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
      expect(
        JSON.parse(runPnpm11(projectRoot, ['config', 'get', 'allowBuilds', '--json'])),
      ).toEqual({ electron: true, 'electron-winstaller': true })

      const { appRoot } = createNestedPnpmWorkspace()
      expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: appRoot })).toBe(0)
      expect(JSON.parse(runPnpm11(appRoot, ['config', 'get', 'allowBuilds', '--json']))).toEqual({
        electron: true,
        'electron-winstaller': true,
      })
    },
    120_000,
  )
})
