import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron clean', () => {
  test('clean prints a plan without writing unless --yes is used', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(combined).toContain('Frontron Clean')
    expect(combined).toContain('Files to delete:')
    expect(combined).toContain('electron/main.ts')
    expect(combined).toContain('package.json scripts to remove:')
    expect(combined).toContain('scripts.frontron:dev')
    expect(combined).toContain('No changes were written because --yes was not used.')
  })

  test('clean --dry-run does not remove generated files or package scripts', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(combined).toContain('No changes were written because --dry-run was used.')
  })

  test('clean --yes removes only manifest-owned files, scripts, and package metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'user-owned.ts'), 'keep me\n')

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build?: unknown
      devDependencies: Record<string, string>
    }

    expect(cleanExitCode).toBe(0)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron', 'window.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron', 'serve.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron', 'user-owned.ts'))).toBe(true)
    expect(packageJson.scripts.dev).toBe('vite --port 5180')
    expect(packageJson.scripts.build).toBe('vite build')
    expect(packageJson.scripts['frontron:dev']).toBeUndefined()
    expect(packageJson.scripts['frontron:build']).toBeUndefined()
    expect(packageJson.scripts['frontron:package']).toBeUndefined()
    expect(packageJson.build).toBeUndefined()
    expect(packageJson.devDependencies.vite).toBe('^8.0.1')
    expect(packageJson.devDependencies.electron).toBeUndefined()
  })

  test('clean --yes preserves user-edited manifest-owned package fields', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    packageJson.devDependencies.electron = '^99.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')
    const cleanedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(cleanExitCode).toBe(0)
    expect(cleanedPackageJson.scripts['frontron:dev']).toBeUndefined()
    expect(cleanedPackageJson.devDependencies.electron).toBe('^99.0.0')
    expect(combined).toContain('Package.json field has local edits and was left intact: devDependencies.electron')
  })

  test('clean --yes removes only manifest-owned build array values', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build: {
        files: string[]
      }
    }
    packageJson.build.files.push('user-assets{,/**/*}')
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const cleanedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build: {
        files: string[]
      }
    }

    expect(cleanExitCode).toBe(0)
    expect(cleanedPackageJson.build.files).toEqual(['user-assets{,/**/*}'])
  })

  test('clean --yes blocks modified manifest-owned files without --force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'user edits\n')

    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toBe('user edits\n')
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain(
      'Manifest-owned file was modified and will not be removed without --force: electron/main.ts',
    )
    expect(combined).toContain('No changes were written because blockers were found.')
  })

  test('clean --yes blocks modified manifest-owned scripts without --force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'user script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain(
      'Manifest-owned script was modified and will not be removed without --force: frontron:dev',
    )
    expect(combined).toContain('No changes were written because blockers were found.')
  })

  test('clean --dry-run reports modified manifest-owned scripts as blockers', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'user script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain(
      'Manifest-owned script was modified and will not be removed without --force: frontron:dev',
    )
    expect(combined).toContain('No changes were written because --dry-run was used.')
  })

  test('clean treats empty string manifest-owned scripts as present', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = ''
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(combined).toContain(
      'Manifest-owned script was modified and will not be removed without --force: frontron:dev',
    )
    expect(combined).not.toContain('Package script is already missing: frontron:dev')
  })

  test('clean --dry-run reports modified manifest-owned files as blockers', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'user edits\n')

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toBe('user edits\n')
    expect(combined).toContain('Blockers:')
    expect(combined).toContain(
      'Manifest-owned file was modified and will not be removed without --force: electron/main.ts',
    )
    expect(combined).toContain('No changes were written because --dry-run was used.')
  })

  test('clean --yes --force removes modified manifest-owned files', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'user edits\n')

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(combined).toContain(
      'Modified manifest-owned file will be removed because --force was used: electron/main.ts',
    )
  })

  test('clean --yes --force removes modified manifest-owned scripts', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'user script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')
    const cleanedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(cleanExitCode).toBe(0)
    expect(cleanedPackageJson.scripts['frontron:dev']).toBeUndefined()
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(combined).toContain(
      'Modified manifest-owned script will be removed because --force was used: frontron:dev',
    )
  })

  test('clean refuses to run without a manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json was not found')
  })

  test('clean blocks manifest entries that point outside the project', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      createdFiles: string[]
    }
    manifest.createdFiles.push('../outside.txt')
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain('Manifest file entry points outside the project: ../outside.txt')
  })
})
