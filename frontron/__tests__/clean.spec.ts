import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { applyCleanPlan } from '../src/clean/apply'
import { createCleanPlan } from '../src/clean/plan'
import type { PackageJson } from '../src/init/shared'
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

  test('clean ignores legacy empty tsconfig ownership claims', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      tsconfigJsonClaims?: unknown[]
    }
    manifest.tsconfigJsonClaims = []
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(combined).not.toContain('tsconfig.json changes are already missing')
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
    expect(combined).toContain(
      'Package.json field has local edits and was left intact: devDependencies.electron',
    )
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
        npmRebuild?: boolean
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
        npmRebuild?: boolean
      }
    }

    expect(cleanExitCode).toBe(0)
    expect(cleanedPackageJson.build.files).toEqual(['user-assets{,/**/*}'])
    expect(cleanedPackageJson.build.npmRebuild).toBeUndefined()
  })

  test('clean --yes restores manifest-owned pnpm workspace build approvals', async () => {
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

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const pnpmWorkspaceSource = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')

    expect(cleanExitCode).toBe(0)
    expect(pnpmWorkspaceSource).toContain('  esbuild: false')
    expect(pnpmWorkspaceSource).toContain('  electron: set this to true or false')
    expect(pnpmWorkspaceSource).not.toContain('electron-winstaller')
  })

  test('clean --force blocks an unsafe pnpm workspace and preserves the manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')

    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(workspacePath, 'packages:\n  - apps/*\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const unsafeSource =
      'packages: ["apps/*"]\nallowBuilds: { electron: true, electron-winstaller: true }\n'
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    writeFileSync(workspacePath, unsafeSource)
    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(combined).toContain('Cannot safely edit pnpm-workspace.yaml')
    expect(combined).not.toContain('pnpm-workspace.yaml field is already missing')
    expect(combined).toContain('No changes were written because blockers were found.')
    expect(readFileSync(workspacePath, 'utf8')).toBe(unsafeSource)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
  })

  test('clean plan records guards for missing manifest-owned config sources', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }

    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(tsconfigPath, '{\n  "exclude": ["coverage"]\n}\n')
    writeFileSync(workspacePath, 'packages:\n  - apps/*\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      yarnRcClaims?: unknown[]
    }
    manifest.yarnRcClaims = [
      {
        file: '.yarnrc.yml',
        path: 'nodeLinker',
        value: 'node-modules',
        created: false,
        changed: true,
        previous: { state: 'value', value: 'pnp', source: 'pnp' },
      },
    ]
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    rmSync(tsconfigPath)
    rmSync(workspacePath)

    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const plan = createCleanPlan(
      projectRoot,
      JSON.parse(packageJsonSource) as PackageJson,
      packageJsonSource,
      { yes: true, force: true },
    )

    expect(plan.missingSourceGuards).toEqual([
      { path: tsconfigPath, safetyRoot: projectRoot },
      { path: workspacePath, safetyRoot: projectRoot },
      { path: yarnRcPath, safetyRoot: projectRoot },
    ])
  })

  test('clean preserves a config file that appears after the plan was created', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    writeFileSync(tsconfigPath, '{\n  "exclude": ["coverage"]\n}\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    rmSync(tsconfigPath)
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonSource) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, packageJsonSource, {
      yes: true,
      force: true,
    })
    const externalSource = '{\n  "compilerOptions": { "strict": true }\n}\n'
    writeFileSync(tsconfigPath, externalSource)

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'changed after the transaction plan was created',
    )
    expect(readFileSync(tsconfigPath, 'utf8')).toBe(externalSource)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonSource)
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
  })

  test('clean --yes restores the root pnpm workspace file from a nested package', async () => {
    const workspaceRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(workspaceRoot)
    const appRoot = join(workspaceRoot, 'apps', 'web')

    mkdirSync(appRoot, { recursive: true })
    writeFileSync(join(workspaceRoot, 'pnpm-lock.yaml'), '')
    writeFileSync(
      join(workspaceRoot, 'pnpm-workspace.yaml'),
      `packages:
  - apps/*

allowBuilds:
  esbuild: false
  electron: set this to true or false
`,
    )
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'nested-web-app',
          version: '0.0.1',
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

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: appRoot,
    })
    expect(initExitCode).toBe(0)
    expect(readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')).toContain(
      '  electron-winstaller: true',
    )

    const cleanExitCode = await runCli(['clean', '--yes'], fixtures.createOutput(), {
      cwd: appRoot,
    })
    const pnpmWorkspaceSource = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')

    expect(cleanExitCode).toBe(0)
    expect(pnpmWorkspaceSource).toContain('  esbuild: false')
    expect(pnpmWorkspaceSource).toContain('  electron: set this to true or false')
    expect(pnpmWorkspaceSource).not.toContain('electron-winstaller')
    expect(existsSync(join(appRoot, 'pnpm-workspace.yaml'))).toBe(false)
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

  test('init and clean preserve tsconfig JSONC comments, trailing commas, and formatting', async () => {
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

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const initializedSource = readFileSync(tsconfigPath, 'utf8')
    expect(initializedSource).toContain('// keep this compiler comment')
    expect(initializedSource).toContain('    "strict": true,')
    expect(initializedSource).toContain('    "coverage",')
    expect(initializedSource).toContain('    "electron",')
    expect(initializedSource).toContain('    "dist-electron",')
    expect(initializedSource).toContain('    ".frontron",')

    const cleanExitCode = await runCli(['clean', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })

    expect(cleanExitCode).toBe(0)
    expect(readFileSync(tsconfigPath, 'utf8')).toBe(originalSource)
  })

  test('clean rejects an out-of-scope generated file claim before path inspection', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const outsideFile = join(outsideRoot, 'outside.ts')
    const linkedDirectory = join(projectRoot, 'linked')
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      createdFiles: string[]
      fileHashes: Record<string, string>
    }

    writeFileSync(outsideFile, 'outside data\n')
    symlinkSync(outsideRoot, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    manifest.createdFiles.push('linked/outside.ts')
    manifest.fileHashes['linked/outside.ts'] = '0'.repeat(64)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['clean', '--yes'], output, { cwd: projectRoot })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid.')
    expect(readFileSync(outsideFile, 'utf8')).toBe('outside data\n')
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
  })

  test('clean apply rechecks parent links before deleting planned files', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonBefore) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, { yes: true, force: false })
    const externalElectronDir = join(outsideRoot, 'external-electron')
    const projectElectronDir = join(projectRoot, 'electron')

    renameSync(projectElectronDir, externalElectronDir)
    symlinkSync(
      externalElectronDir,
      projectElectronDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'symbolic link or junction',
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(externalElectronDir, 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
  })

  test('clean rolls back package changes when a later tsconfig apply step fails', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const tsconfigPath = join(projectRoot, 'tsconfig.json')

    writeFileSync(tsconfigPath, '{\n  "compilerOptions": {},\n}\n')
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonBefore) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, { yes: true, force: false })
    const brokenTsconfigSource = '{\n  // changed after planning\n'

    writeFileSync(tsconfigPath, brokenTsconfigSource)

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'Project files were rolled back from the persistent journal',
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(tsconfigPath, 'utf8')).toBe(brokenTsconfigSource)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
  })

  test('clean rejects package.json changes made after planning', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonSource) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, packageJsonSource, {
      yes: true,
      force: false,
    })
    const concurrentSource = `${packageJsonSource.trimEnd()}\n `
    writeFileSync(packageJsonPath, concurrentSource)

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'changed after the transaction plan was created',
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(concurrentSource)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
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
      fileHashes: Record<string, string>
    }
    manifest.createdFiles.push('../outside.txt')
    manifest.fileHashes['../outside.txt'] = '0'.repeat(64)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
    expect(combined).toContain('.frontron/manifest.json is invalid.')
  })
})
