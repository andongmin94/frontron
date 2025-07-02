import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
        scripts: {
          dev: 'vite --port 5180',
          build: 'vite build',
        },
        devDependencies: {
          vite: '^8.0.1',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(projectRoot, 'vite.config.ts'),
    `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
  )
  fixtures.tempDirs.push(workspaceRoot)
  return { workspaceRoot, projectRoot }
}

describe('Yarn .yarnrc.yml source editing', () => {
  test('preserves comments, CRLF, other keys, and scalar quote style', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const originalSource =
      '# workspace settings\r\nnodeLinker: "pnp"  # keep this comment\r\nenableGlobalCache: false\r\n'
    writeFileSync(yarnRcPath, originalSource)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.blockers).toEqual([])
    expect(plan?.nextSource).toBe(
      '# workspace settings\r\nnodeLinker: "node-modules"  # keep this comment\r\nenableGlobalCache: false\r\n',
    )
    expect(plan?.ownershipClaims).toEqual([
      {
        file: '.yarnrc.yml',
        path: 'nodeLinker',
        value: 'node-modules',
        created: false,
        changed: true,
        previous: {
          state: 'value',
          value: 'pnp',
          source: '"pnp"',
        },
      },
    ])

    const restored = restoreYarnRcYamlClaim(plan?.nextSource ?? '', plan!.ownershipClaims[0])
    expect(restored).toEqual({ source: originalSource })
  })

  test('allows unrelated flow, block scalar, anchor, alias, and duplicate-key syntax', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const originalSource = [
      'sharedCache: &cache { folder: .yarn/cache }',
      'cacheSettings: *cache',
      'notes: |',
      '  Keep this block scalar.',
      'checksumBehavior: throw',
      'checksumBehavior: update',
      "nodeLinker: 'pnp' # target comment",
      '',
    ].join('\r\n')
    writeFileSync(yarnRcPath, originalSource)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.blockers).toEqual([])
    expect(plan?.nextSource).toBe(
      originalSource.replace("nodeLinker: 'pnp'", "nodeLinker: 'node-modules'"),
    )
    expect(restoreYarnRcYamlClaim(plan!.nextSource, plan!.ownershipClaims[0])).toEqual({
      source: originalSource,
    })
  })

  test('creates a minimal project config when no .yarnrc.yml exists', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.created).toBe(true)
    expect(plan?.nextSource).toBe('nodeLinker: node-modules\n')
    expect(plan?.changes).toEqual([
      {
        action: 'create',
        path: 'nodeLinker',
        value: 'node-modules',
        previous: 'missing',
      },
    ])
    expect(plan?.ownershipClaims[0]).toMatchObject({
      file: '.yarnrc.yml',
      created: true,
      changed: true,
      previous: {
        state: 'missing',
        previousHadFinalEol: false,
      },
    })
  })

  test('preserves a UTF-8 BOM while replacing the first-line scalar', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const originalSource = '\uFEFFnodeLinker: pnp\r\n'
    writeFileSync(join(projectRoot, '.yarnrc.yml'), originalSource)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.nextSource).toBe('\uFEFFnodeLinker: node-modules\r\n')
    expect(restoreYarnRcYamlClaim(plan!.nextSource, plan!.ownershipClaims[0])).toEqual({
      source: originalSource,
    })
  })

  test('appends and removes nodeLinker without changing an existing final-EOL state', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const originalSource = 'enableGlobalCache: false'
    writeFileSync(join(projectRoot, '.yarnrc.yml'), originalSource)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.nextSource).toBe('enableGlobalCache: false\nnodeLinker: node-modules')
    expect(plan?.changes[0].action).toBe('add')
    expect(restoreYarnRcYamlClaim(plan!.nextSource, plan!.ownershipClaims[0])).toEqual({
      source: originalSource,
    })
  })

  test('inserts before an explicit document-end marker and restores the exact source', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const originalSource = '---\ncacheSettings: [global]\n...\n# footer\n'
    writeFileSync(join(projectRoot, '.yarnrc.yml'), originalSource)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')!

    expect(plan.blockers).toEqual([])
    expect(plan.nextSource).toBe(
      '---\ncacheSettings: [global]\nnodeLinker: node-modules\n...\n# footer\n',
    )
    expect(restoreYarnRcYamlClaim(plan.nextSource, plan.ownershipClaims[0])).toEqual({
      source: originalSource,
    })
  })

  test('records an unchanged node-modules config for doctor without claiming a clean edit', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = 'nodeLinker: node-modules\n'
    writeFileSync(join(projectRoot, '.yarnrc.yml'), source)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.nextSource).toBe(source)
    expect(plan?.changes).toEqual([])
    expect(plan?.ownershipClaims[0]).toMatchObject({
      created: false,
      changed: false,
      previous: { state: 'value', value: 'node-modules' },
    })
  })

  test('ignores non-Yarn projects and blocks a non-file .yarnrc.yml target', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(previewYarnRcYamlPatch(projectRoot, 'npm')).toBeNull()
    mkdirSync(join(projectRoot, '.yarnrc.yml'))
    expect(previewYarnRcYamlPatch(projectRoot, 'yarn')?.blockers.join('\n')).toContain(
      'target is not a regular file',
    )
  })

  test('blocks a hard-linked .yarnrc.yml before reading or writing it', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const sharedPath = join(projectRoot, 'shared-yarnrc.yml')
    writeFileSync(sharedPath, 'nodeLinker: pnp\n')
    linkSync(sharedPath, join(projectRoot, '.yarnrc.yml'))

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.blockers.join('\n')).toContain('exactly one hard link')
    expect(readFileSync(sharedPath, 'utf8')).toBe('nodeLinker: pnp\n')
  })

  test('finds the nearest ancestor workspace .yarnrc.yml', () => {
    const { workspaceRoot, projectRoot } = createNestedYarnProject()
    const workspaceYarnRcPath = join(workspaceRoot, '.yarnrc.yml')
    writeFileSync(workspaceYarnRcPath, 'nodeLinker: pnp\n')

    expect(findYarnRcYamlPath(projectRoot)).toBe(workspaceYarnRcPath)
    expect(previewYarnRcYamlPatch(projectRoot, 'yarn')?.ownershipClaims[0].file).toBe(
      '../../.yarnrc.yml',
    )
  })

  test.each([
    ['duplicate key', 'nodeLinker: pnp\nnodeLinker: node-modules\n', 'duplicate top-level key'],
    ['alias value', 'nodeLinker: *sharedLinker\n', 'aliases are not supported safely'],
    ['anchor key', '&linkerKey nodeLinker: pnp\n', 'anchors are not supported safely'],
    ['anchor value', 'nodeLinker: &linker pnp\n', 'anchors are not supported safely'],
    ['tagged value', 'nodeLinker: !!str pnp\n', 'tags are not supported safely'],
    ['flow value', 'nodeLinker: [pnp]\n', 'flow collections are not supported safely'],
    ['complex value', 'nodeLinker:\n  mode: pnp\n', 'simple pnp or node-modules scalar'],
    [
      'nested content after scalar',
      'enableGlobalCache: false\n  invalid: true\n',
      'Nested mappings are not allowed in compact mappings',
    ],
  ])('blocks %s without changing the source', (_label, source, expectedReason) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), source)

    const plan = previewYarnRcYamlPatch(projectRoot, 'yarn')

    expect(plan?.blockers.join('\n')).toContain(expectedReason)
    expect(plan?.nextSource).toBe(source)
    expect(plan?.changes).toEqual([])
    expect(plan?.ownershipClaims).toEqual([])
  })

  test('reports an unsafe current claim value to doctor and clean callers', () => {
    const result = readYarnRcYamlClaimValue('nodeLinker: { mode: pnp }\n')

    expect(result.safeToEdit).toBe(false)
    expect(result.blocker).toContain('flow collections are not supported safely')
  })
})

describe('Yarn init integration', () => {
  test('init patches the nearest workspace config and records a restorable manifest claim', async () => {
    const { workspaceRoot, projectRoot } = createNestedYarnProject()
    const yarnRcPath = join(workspaceRoot, '.yarnrc.yml')
    const originalSource = '# root config\nnodeLinker: pnp # Yarn PnP\nenableGlobalCache: false\n'
    writeFileSync(yarnRcPath, originalSource)

    const exitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      createdFiles: string[]
      yarnRcClaims: Array<{
        file: string
        created: boolean
        changed: boolean
        previous: { state: string; value?: string; source?: string }
      }>
    }

    expect(exitCode).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe(
      '# root config\nnodeLinker: node-modules # Yarn PnP\nenableGlobalCache: false\n',
    )
    expect(existsSync(join(projectRoot, '.yarnrc.yml'))).toBe(false)
    expect(manifest.createdFiles).not.toContain('../../.yarnrc.yml')
    expect(manifest.yarnRcClaims).toEqual([
      {
        file: '../../.yarnrc.yml',
        path: 'nodeLinker',
        value: 'node-modules',
        created: false,
        changed: true,
        previous: {
          state: 'value',
          value: 'pnp',
          source: 'pnp',
        },
      },
    ])
  })

  test('init --dry-run reports a new Yarn config without writing it', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--dry-run'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(join(projectRoot, '.yarnrc.yml'))).toBe(false)
    expect(combined).toContain('.yarnrc.yml changes:')
    expect(combined).toContain('+ .yarnrc.yml nodeLinker: (missing) -> node-modules')
  })

  test('init reports complex Yarn YAML as a clear blocker and leaves it unchanged', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const originalSource = 'nodeLinker: *workspaceLinker\n'
    writeFileSync(yarnRcPath, originalSource)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes'], output, { cwd: projectRoot })
    const combined = [...output.info.mock.calls.flat(), ...output.error.mock.calls.flat()].join(
      '\n',
    )

    expect(exitCode).toBe(1)
    expect(combined).toContain('Cannot safely edit .yarnrc.yml')
    expect(combined).toContain('aliases are not supported safely')
    expect(readFileSync(yarnRcPath, 'utf8')).toBe(originalSource)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
  })

  test('the transaction journal snapshots an ancestor Yarn config', () => {
    const { workspaceRoot, projectRoot } = createNestedYarnProject()
    const yarnRcPath = join(workspaceRoot, '.yarnrc.yml')
    writeFileSync(yarnRcPath, 'nodeLinker: pnp\n')
    const transaction = beginTransaction(projectRoot, 'init', [
      {
        path: yarnRcPath,
        safetyRoot: dirname(yarnRcPath),
      },
    ])

    writeFileSync(yarnRcPath, 'nodeLinker: node-modules\n')
    rollbackTransaction(transaction)

    expect(readFileSync(yarnRcPath, 'utf8')).toBe('nodeLinker: pnp\n')
  })

  test('update preserves the original Yarn claim for a later clean', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const originalSource = '# original\nnodeLinker: pnp\n'
    writeFileSync(yarnRcPath, originalSource)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      yarnRcClaims: Array<{ previous: { state: string; value?: string } }>
    }
    expect(manifest.yarnRcClaims).toHaveLength(1)
    expect(manifest.yarnRcClaims[0].previous).toMatchObject({ state: 'value', value: 'pnp' })

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe(originalSource)
  })
})

describe('Yarn doctor and clean integration', () => {
  test('doctor checks the manifest-owned nodeLinker and reports local edits', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), 'nodeLinker: pnp\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const healthyOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], healthyOutput, { cwd: projectRoot })).toBe(0)
    expect(healthyOutput.info.mock.calls.flat().join('\n')).toContain(
      '.yarnrc.yml: .yarnrc.yml nodeLinker matches manifest',
    )

    writeFileSync(join(projectRoot, '.yarnrc.yml'), 'nodeLinker: pnp\n')
    const editedOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], editedOutput, { cwd: projectRoot })).toBe(0)
    expect(editedOutput.info.mock.calls.flat().join('\n')).toContain(
      '.yarnrc.yml: Manifest-owned .yarnrc.yml field has local edits: nodeLinker',
    )
  })

  test('doctor blocks an unsafe post-init Yarn config', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), 'nodeLinker: [node-modules]\n')
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      'flow collections are not supported safely',
    )
  })

  test('doctor and clean block a hard-linked manifest-owned Yarn config', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    const sharedPath = join(projectRoot, 'shared-yarnrc.yml')
    writeFileSync(sharedPath, readFileSync(yarnRcPath, 'utf8'))
    rmSync(yarnRcPath)
    linkSync(sharedPath, yarnRcPath)

    const doctorOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], doctorOutput, { cwd: projectRoot })).toBe(1)
    expect(doctorOutput.info.mock.calls.flat().join('\n')).toContain('exactly one hard link')

    const cleanOutput = fixtures.createOutput()
    expect(await runCli(['clean', '--yes'], cleanOutput, { cwd: projectRoot })).toBe(1)
    expect(cleanOutput.info.mock.calls.flat().join('\n')).toContain('exactly one hard link')
    expect(readFileSync(sharedPath, 'utf8')).toBe('nodeLinker: node-modules\n')
  })

  test('clean restores the exact previous scalar and surrounding source', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const originalSource =
      "# keep\r\nnodeLinker: 'pnp'  # restore quotes\r\nenableGlobalCache: false\r\n"
    writeFileSync(yarnRcPath, originalSource)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toContain("nodeLinker: 'node-modules'")

    const cleanOutput = fixtures.createOutput()
    expect(await runCli(['clean', '--yes'], cleanOutput, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe(originalSource)
  })

  test('clean removes an untouched .yarnrc.yml created by init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe('nodeLinker: node-modules\n')

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(existsSync(yarnRcPath)).toBe(false)
  })

  test('clean removes only nodeLinker when a generated config gained user keys', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(yarnRcPath, 'nodeLinker: node-modules\nenableGlobalCache: false # user setting\n')

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe('enableGlobalCache: false # user setting\n')
  })

  test('clean preserves the final EOL of a user comment added before nodeLinker', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(yarnRcPath, '# user comment\nnodeLinker: node-modules\n')

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe('# user comment\n')
  })

  test('clean leaves a locally edited nodeLinker intact without --force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(yarnRcPath, 'nodeLinker: pnp\n')
    const output = fixtures.createOutput()

    expect(await runCli(['clean', '--yes'], output, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(yarnRcPath, 'utf8')).toBe('nodeLinker: pnp\n')
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      '.yarnrc.yml field has local edits and was left intact: nodeLinker',
    )
  })
})
