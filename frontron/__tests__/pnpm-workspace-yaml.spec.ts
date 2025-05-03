import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import type { PackageJsonOwnershipClaim } from '../src/init/manifest'
import {
  previewPnpmWorkspaceYamlPatch,
  readPnpmWorkspaceYamlClaimValue,
  restorePnpmWorkspaceYamlClaim,
} from '../src/init/pnpm-workspace-yaml'
import * as fixtures from './helpers/frontron-cli-fixtures'

const UNSAFE_YAML_CASES = [
  [
    'inline flow mapping',
    `packages:
  - apps/*
allowBuilds: { electron: false }
`,
  ],
  [
    'anchor and alias',
    `buildApprovals: &buildApprovals
  electron: false
allowBuilds: *buildApprovals
`,
  ],
  [
    'duplicate allowBuilds section',
    `allowBuilds:
  electron: false
allowBuilds:
  electron-winstaller: false
`,
  ],
  [
    'duplicate quoted key',
    `allowBuilds:
  electron: true
  "electron": false
`,
  ],
  [
    'nested value',
    `allowBuilds:
  electron:
    approved: true
`,
  ],
  [
    'sequence value',
    `allowBuilds:
  - electron
`,
  ],
  [
    'duplicate nested workspace key',
    `catalog:
  react: ^18.0.0
  "react": ^19.0.0
`,
  ],
  [
    'unclosed quoted workspace value',
    `packages:
  - "apps/*
`,
  ],
  [
    'unclosed flow workspace value',
    `packages: ["apps/*"
`,
  ],
] as const

// setPnpmPackageManager 함수는 테스트 프로젝트가 pnpm init 경로를 사용하도록 설정한다.
function setPnpmPackageManager(projectRoot: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: string
  }

  packageJson.packageManager = 'pnpm@11.11.0'
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

// createNestedPnpmWorkspace 함수는 실제 workspace root 탐색을 검증할 중첩 앱을 만든다.
function createNestedPnpmWorkspace() {
  const workspaceRoot = fixtures.createTempProject()
  const appRoot = join(workspaceRoot, 'apps', 'web')

  fixtures.tempDirs.push(workspaceRoot)
  mkdirSync(appRoot, { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'pnpm-workspace.yaml'),
    `packages:
  - apps/*
`,
  )
  writeFileSync(
    join(appRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'nested-web-app',
        version: '0.0.1',
        packageManager: 'pnpm@11.11.0',
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
    join(appRoot, 'vite.config.ts'),
    `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
  )

  return { workspaceRoot, appRoot }
}

// runPnpm11 함수는 opt-in 통합 테스트에서 npm cache의 실제 pnpm 11을 실행한다.
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
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr ||
        result.stdout ||
        `pnpm 11 exited with ${result.status}`,
    )
  }

  return result.stdout.trim()
}

describe('pnpm-workspace.yaml safety', () => {
  test('safe block mapping edits preserve comments, CRLF, quoting, spacing, and indentation', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = [
      'packages:',
      '  - "apps/*"',
      '',
      "'allowBuilds': # keep policy comment",
      '    "electron"  : false   # keep electron comment',
      "    'esbuild': false # keep esbuild comment",
      '',
      'catalog:',
      '  react: ^19.0.0',
      '',
    ].join('\r\n')
    const expected = [
      'packages:',
      '  - "apps/*"',
      '',
      "'allowBuilds': # keep policy comment",
      '    "electron"  : true   # keep electron comment',
      "    'esbuild': false # keep esbuild comment",
      '    electron-winstaller: true',
      '',
      'catalog:',
      '  react: ^19.0.0',
      '',
    ].join('\r\n')

    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)
    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')

    expect(plan?.blockers).toEqual([])
    expect(plan?.nextSource).toBe(expected)
    expect(plan?.nextSource.replace(/\r\n/g, '')).not.toContain('\n')
  })

  test('an already-approved block mapping remains byte-for-byte unchanged', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const source = `"allowBuilds": # no rewrite
    'electron': TRUE # keep casing
    "electron-winstaller": true
`

    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)
    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')

    expect(plan?.changes).toEqual([])
    expect(plan?.nextSource).toBe(source)
  })

  test.each(UNSAFE_YAML_CASES)('%s returns a blocker without changing source', (_name, source) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), source)

    const plan = previewPnpmWorkspaceYamlPatch(projectRoot, 'pnpm')
    const readResult = readPnpmWorkspaceYamlClaimValue(source, 'allowBuilds.electron')
    const claim: PackageJsonOwnershipClaim = {
      path: 'allowBuilds.electron',
      action: 'set',
      value: true,
      previous: { state: 'missing' },
    }

    expect(plan?.blockers[0]).toContain('Cannot safely edit pnpm-workspace.yaml')
    expect(plan?.blockers[0]).toContain('left unchanged')
    expect(plan?.changes).toEqual([])
    expect(plan?.ownershipClaims).toEqual([])
    expect(plan?.nextSource).toBe(source)
    expect(readResult.safeToEdit).toBe(false)
    expect(readResult.blocker).toContain('Cannot safely edit pnpm-workspace.yaml')
    expect(restorePnpmWorkspaceYamlClaim(source, claim)).toBe(source)
  })

  test.each(UNSAFE_YAML_CASES)('init blocks %s atomically', async (_name, source) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    writeFileSync(workspacePath, source)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes'], output, { cwd: projectRoot })
    const combinedErrors = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combinedErrors).toContain('Cannot safely edit pnpm-workspace.yaml')
    expect(readFileSync(workspacePath, 'utf8')).toBe(source)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonSource)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(existsSync(join(projectRoot, '.frontron'))).toBe(false)
  })

  test('clean and doctor warn without rewriting a workspace changed to flow YAML after init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    writeFileSync(
      workspacePath,
      `packages:
  - apps/*
allowBuilds:
  esbuild: false
`,
    )

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const complexSource = `packages: ["apps/*"]
allowBuilds: { electron: true, electron-winstaller: true }
`
    writeFileSync(workspacePath, complexSource)
    const doctorOutput = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], doctorOutput, { cwd: projectRoot })
    const doctorReport = doctorOutput.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(doctorReport).toContain('Status: warnings')
    expect(doctorReport).toContain('Manifest-owned pnpm-workspace.yaml field is missing')
    expect(readFileSync(workspacePath, 'utf8')).toBe(complexSource)

    const cleanOutput = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes', '--force'], cleanOutput, {
      cwd: projectRoot,
    })
    const cleanReport = cleanOutput.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(cleanReport).toContain('Manifest-owned pnpm-workspace.yaml field is already missing')
    expect(readFileSync(workspacePath, 'utf8')).toBe(complexSource)
  })

  test('clean restores the exact scalar spelling and surrounding block mapping formatting', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    const originalSource = [
      'packages:',
      '  - apps/*',
      '',
      'allowBuilds: # approvals',
      '    "electron"  : "set this to true or false"   # decision',
      '    esbuild: false',
      '',
      'catalog:',
      '  react: ^19.0.0',
      '',
    ].join('\r\n')
    writeFileSync(workspacePath, originalSource)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(workspacePath, 'utf8')).toBe(originalSource)
  })

  test.each([
    ['without final newline', 'packages:\r\n  - apps/*'],
    ['with final newline', 'packages:\r\n  - apps/*\r\n'],
    ['with an existing blank line', 'packages:\r\n  - apps/*\r\n\r\n'],
  ])('clean removes a generated section byte-for-byte %s', async (_name, originalSource) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    writeFileSync(workspacePath, originalSource)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(workspacePath, 'utf8')).toBe(originalSource)
  })

  test('default generation and nested workspace generation produce the pnpm 11 allowBuilds map', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setPnpmPackageManager(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      `allowBuilds:
  electron: true
  electron-winstaller: true
`,
    )

    const { workspaceRoot, appRoot } = createNestedPnpmWorkspace()

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: appRoot })).toBe(0)
    expect(readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')).toContain(
      `allowBuilds:
  electron: true
  electron-winstaller: true
`,
    )
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
      ).toEqual({
        electron: true,
        'electron-winstaller': true,
      })

      const { appRoot } = createNestedPnpmWorkspace()
      expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: appRoot })).toBe(0)
      expect(JSON.parse(runPnpm11(appRoot, ['config', 'get', 'allowBuilds', '--json']))).toEqual({
        electron: true,
        'electron-winstaller': true,
      })
      expect(runPnpm11(appRoot, ['--version'])).toMatch(/^11\./)
    },
    120_000,
  )
})
