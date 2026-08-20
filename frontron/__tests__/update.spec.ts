import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

async function initializeProject(projectRoot: string, args: string[] = []) {
  const exitCode = await runCli(['init', '--yes', ...args], fixtures.createOutput(), {
    cwd: projectRoot,
  })

  expect(exitCode).toBe(0)
}

describe('frontron update', () => {
  test('update requires a current manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['update'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      '.frontron/manifest.json was not found',
    )
  })

  test('update previews without writing and applies with --yes', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const packageJsonPath = join(projectRoot, 'package.json')
    const mainPath = join(projectRoot, 'electron', 'main.ts')
    const packageBefore = readFileSync(packageJsonPath, 'utf8')
    const mainBefore = readFileSync(mainPath, 'utf8')
    const previewOutput = fixtures.createOutput()

    expect(await runCli(['update'], previewOutput, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageBefore)
    expect(readFileSync(mainPath, 'utf8')).toBe(mainBefore)
    expect(previewOutput.info.mock.calls.flat().join('\n')).toContain(
      'Run "frontron update --yes" to apply this plan.',
    )

    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(mainPath, 'utf8')).toContain('createWindow')
  })

  test('update restores a missing manifest-owned file', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const mainPath = join(projectRoot, 'electron', 'main.ts')
    rmSync(mainPath)

    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(existsSync(mainPath)).toBe(true)
    expect(readFileSync(mainPath, 'utf8')).toContain('createWindow')
  })

  test('update blocks local edits to owned files, scripts, and package fields', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const mainPath = join(projectRoot, 'electron', 'main.ts')
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'custom dev command'
    packageJson.devDependencies.electron = '^99.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(mainPath, 'custom main source\n')
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Manifest-owned file has local edits: electron/main.ts')
    expect(errors).toContain('Manifest-owned script has local edits: frontron:dev')
    expect(errors).toContain(
      'Manifest-owned package.json field has local edits: devDependencies.electron',
    )
    expect(readFileSync(mainPath, 'utf8')).toBe('custom main source\n')
  })

  test('update --force replaces local edits to owned state', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const mainPath = join(projectRoot, 'electron', 'main.ts')
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'custom dev command'
    packageJson.devDependencies.electron = '^99.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(mainPath, 'custom main source\n')

    expect(
      await runCli(['update', '--yes', '--force'], fixtures.createOutput(), {
        cwd: projectRoot,
      }),
    ).toBe(0)

    const refreshedPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(readFileSync(mainPath, 'utf8')).toContain('createWindow')
    expect(refreshedPackage.scripts['frontron:dev']).not.toBe('custom dev command')
    expect(refreshedPackage.devDependencies.electron).not.toBe('^99.0.0')
  })

  test('update --force still blocks an unsafe pnpm workspace', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }
    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    await initializeProject(projectRoot)

    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'allowBuilds: *sharedBuilds\n')
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('aliases are not supported safely')
  })

  test('update reuses the configuration recorded by init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot, [
      '--desktop-dir',
      'desktop',
      '--app-script',
      'desktop:dev',
      '--build-script',
      'desktop:build',
      '--package-script',
      'desktop:package',
      '--product-name',
      'Recorded Product',
      '--app-id',
      'com.example.recorded-product',
    ])

    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(manifest.desktopDir).toBe('desktop')
    expect(manifest.appScript).toBe('desktop:dev')
    expect(manifest.productName).toBe('Recorded Product')
    expect(existsSync(join(projectRoot, 'desktop', 'main.ts'))).toBe(true)
  })

  test('update rejects an obsolete manifest schema', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
    }
    manifest.schemaVersion = 1
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['update'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('uses unsupported schema version 1')
  })
})
