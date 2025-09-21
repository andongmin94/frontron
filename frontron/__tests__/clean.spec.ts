import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron clean', () => {
  test('clean prints a plan without writing unless --yes is used', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    const output = fixtures.createOutput()

    expect(await runCli(['clean'], output, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)

    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Files to delete:')
    expect(report).toContain('electron/main.ts')
    expect(report).toContain('No changes were written because --yes was not used.')
  })

  test('clean removes only manifest-owned files, scripts, and package metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'user-owned.ts'), 'keep me\n')
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build: { files: string[] }
    }
    packageJson.build.files.push('user-assets{,/**/*}')
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const cleaned = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      build?: { files?: string[] }
      devDependencies: Record<string, string>
    }

    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron', 'user-owned.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(cleaned.scripts.dev).toBe('vite --port 5180')
    expect(cleaned.scripts.build).toBe('vite build')
    expect(cleaned.scripts['frontron:dev']).toBeUndefined()
    expect(cleaned.scripts['frontron:build']).toBeUndefined()
    expect(cleaned.devDependencies.electron).toBeUndefined()
    expect(cleaned.build?.files).toEqual(['user-assets{,/**/*}'])
  })

  test('clean preserves user-edited owned package fields', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    packageJson.devDependencies.electron = '^99.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['clean', '--yes'], output, { cwd: projectRoot })).toBe(0)
    const cleaned = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }

    expect(cleaned.devDependencies.electron).toBe('^99.0.0')
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      'Package.json field has local edits and was left intact: devDependencies.electron',
    )
  })

  test('clean blocks modified managed files unless --force is explicit', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const managedPath = join(projectRoot, 'electron', 'main.ts')
    writeFileSync(managedPath, 'user edits\n')
    const blockedOutput = fixtures.createOutput()

    expect(await runCli(['clean', '--yes'], blockedOutput, { cwd: projectRoot })).toBe(1)
    expect(readFileSync(managedPath, 'utf8')).toBe('user edits\n')
    expect(blockedOutput.info.mock.calls.flat().join('\n')).toContain(
      'Manifest-owned file was modified and will not be removed without --force: electron/main.ts',
    )

    expect(
      await runCli(['clean', '--yes', '--force'], fixtures.createOutput(), { cwd: projectRoot }),
    ).toBe(0)
    expect(existsSync(managedPath)).toBe(false)
  })

  test('init and clean preserve JSONC while restoring only owned excludes', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    const originalSource = `{
  // keep this compiler comment
  "compilerOptions": {
    "strict": true,
  },
  "exclude": [
    "coverage",
  ],
}
`
    writeFileSync(tsconfigPath, originalSource)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    const initialized = readFileSync(tsconfigPath, 'utf8')
    expect(initialized).toContain('// keep this compiler comment')
    expect(initialized).toContain('"electron"')
    expect(initialized).toContain('"dist-electron"')
    expect(initialized).toContain('".frontron"')

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(tsconfigPath, 'utf8')).toBe(originalSource)
  })

  test('clean restores pnpm workspace build approvals without touching other values', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }
    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(
      join(projectRoot, 'pnpm-workspace.yaml'),
      `packages:
  - apps/*
allowBuilds:
  esbuild: false
  electron: set this to true or false
`,
    )

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const source = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')
    expect(source).toContain('esbuild: false')
    expect(source).toContain('electron: set this to true or false')
    expect(source).not.toContain('electron-winstaller')
  })

  test('clean refuses to run without a manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['clean', '--yes'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      '.frontron/manifest.json was not found',
    )
  })
})
