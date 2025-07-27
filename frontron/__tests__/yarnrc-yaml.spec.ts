import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import {
  findYarnRcYamlPath,
  previewYarnRcYamlPatch,
  readYarnRcYamlClaimValue,
  restoreYarnRcYamlClaim,
} from '../src/init/yarnrc-yaml'
import { beginTransaction, rollbackTransaction } from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

function setYarnPackageManager(projectRoot: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: string
  }
  packageJson.packageManager = 'yarn@4.9.2'
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function createNestedYarnProject() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'frontron-yarn-workspace-'))
  const projectRoot = join(workspaceRoot, 'apps', 'web')
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'nested-yarn-app',
        version: '0.0.1',
        packageManager: 'yarn@4.9.2',
        scripts: { dev: 'vite --port 5180', build: 'vite build' },
        devDependencies: { vite: '^8.0.1' },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(projectRoot, 'vite.config.ts'), 'export default {}\n')
  fixtures.tempDirs.push(workspaceRoot)
  return { workspaceRoot, projectRoot }
}

describe('Yarn configuration', () => {
  test('sets nodeLinker while retaining unrelated values', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = 'nodeLinker: pnp\nenableGlobalCache: false\n'
    writeFileSync(join(projectRoot, '.yarnrc.yml'), source)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')!
    expect(parse(plan.nextSource)).toEqual({
      nodeLinker: 'node-modules',
      enableGlobalCache: false,
    })
    const restored = restoreYarnRcYamlClaim(plan.nextSource, plan.ownershipClaims[0])
    expect(restored.blocker).toBeUndefined()
    expect(parse(restored.source)).toEqual(parse(source))
  })

  test('creates a minimal config when none exists', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')!
    expect(plan.created).toBe(true)
    expect(parse(plan.nextSource)).toEqual({ nodeLinker: 'node-modules' })
    expect(plan.changes[0].action).toBe('create')
  })

  test('finds and records the nearest ancestor config', () => {
    const { workspaceRoot, projectRoot } = createNestedYarnProject()
    const configPath = join(workspaceRoot, '.yarnrc.yml')
    writeFileSync(configPath, 'nodeLinker: pnp\n')

    expect(findYarnRcYamlPath(projectRoot)).toBe(configPath)
    expect(previewYarnRcYamlPatch(projectRoot, 'yarn')?.ownershipClaims[0].file).toBe(
      '../../.yarnrc.yml',
    )
  })

  test.each([
    ['alias', 'shared: &linker pnp\nnodeLinker: *linker\n', 'aliases'],
    ['flow value', 'nodeLinker: [pnp]\n', 'flow collections'],
    ['duplicate key', 'nodeLinker: pnp\nnodeLinker: node-modules\n', 'Map keys'],
    ['complex value', 'nodeLinker:\n  mode: pnp\n', 'simple pnp or node-modules'],
  ])('blocks an unsafe %s', (_label, source, reason) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), source)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')!
    expect(plan.blockers.join('\n')).toContain(reason)
    expect(plan.nextSource).toBe(source)
    expect(readYarnRcYamlClaimValue(source).safeToEdit).toBe(false)
  })

  test('blocks a hard-linked config', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const sharedPath = join(projectRoot, 'shared-yarnrc.yml')
    writeFileSync(sharedPath, 'nodeLinker: pnp\n')
    linkSync(sharedPath, join(projectRoot, '.yarnrc.yml'))

    expect(previewYarnRcYamlPatch(projectRoot, 'yarn')?.blockers.join('\n')).toContain(
      'exactly one hard link',
    )
  })

  test('the transaction journal can restore an ancestor Yarn config', () => {
    const { workspaceRoot, projectRoot } = createNestedYarnProject()
    const configPath = join(workspaceRoot, '.yarnrc.yml')
    writeFileSync(configPath, 'nodeLinker: pnp\n')
    const transaction = beginTransaction(projectRoot, 'init', [
      { path: configPath, safetyRoot: dirname(configPath) },
    ])

    writeFileSync(configPath, 'nodeLinker: node-modules\n')
    rollbackTransaction(transaction)

    expect(readFileSync(configPath, 'utf8')).toBe('nodeLinker: pnp\n')
  })
})

describe('Yarn lifecycle', () => {
  test('init, update, and clean preserve the original nodeLinker value', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const configPath = join(projectRoot, '.yarnrc.yml')
    const original = 'nodeLinker: pnp\nenableGlobalCache: false\n'
    writeFileSync(configPath, original)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(parse(readFileSync(configPath, 'utf8'))).toEqual(parse(original))
  })

  test('clean removes a config created by init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const configPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(existsSync(configPath)).toBe(false)
  })

  test('clean leaves a locally edited nodeLinker intact without force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const configPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(configPath, 'nodeLinker: pnp\n')
    const output = fixtures.createOutput()

    expect(await runCli(['clean', '--yes'], output, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(configPath, 'utf8')).toBe('nodeLinker: pnp\n')
    expect(output.info.mock.calls.flat().join('\n')).toContain('local edits')
  })
})
