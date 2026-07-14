import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { createFileHash, parseManifest } from '../src/init/manifest'
import * as fixtures from './helpers/frontron-cli-fixtures'

type GeneratedManifest = Record<string, unknown> & {
  schemaVersion: number
  desktopDir?: string
  createdFiles: string[]
  fileHashes: Record<string, string>
}

describe('frontron manifest compatibility', () => {
  test('new manifests use the complete schema v2 contract', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      schemaVersion: number
      fileHashes: Record<string, string>
      scriptCommands: Record<string, string>
      packageJsonClaims: unknown[]
      tsconfigJsonClaims: unknown[]
      pnpmWorkspaceClaims: unknown[]
      yarnRcClaims: unknown[]
    }

    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.fileHashes).toBeTypeOf('object')
    expect(manifest.scriptCommands).toBeTypeOf('object')
    expect(manifest.packageJsonClaims).toBeInstanceOf(Array)
    expect(manifest.tsconfigJsonClaims).toBeInstanceOf(Array)
    expect(manifest.pnpmWorkspaceClaims).toBeInstanceOf(Array)
    expect(manifest.yarnRcClaims).toBeInstanceOf(Array)
  })

  test('v1 and v2 parsing reject arbitrary ownership claim paths by category', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>
    const claimCategories = [
      'packageJsonClaims',
      'tsconfigJsonClaims',
      'pnpmWorkspaceClaims',
    ] as const

    for (const schemaVersion of [1, 2]) {
      const compatibleManifest = structuredClone(manifest)
      compatibleManifest.schemaVersion = schemaVersion
      expect(() => parseManifest(compatibleManifest)).not.toThrow()

      for (const category of claimCategories) {
        const forgedManifest = structuredClone(compatibleManifest)
        forgedManifest[category] = [
          {
            path: 'name',
            action: 'set',
            value: 'forged',
            previous: { state: 'missing' },
          },
        ]

        expect(() => parseManifest(forgedManifest)).toThrow('.frontron/manifest.json is invalid.')
      }
    }
  })

  test('v1 and v2 parsing enforce generated file ownership boundaries', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as GeneratedManifest
    const invalidMutations: Array<(candidate: GeneratedManifest) => void> = [
      (candidate) => {
        candidate.createdFiles.push('package.json')
        candidate.fileHashes['package.json'] = '0'.repeat(64)
      },
      (candidate) => candidate.createdFiles.push('.frontron/manifest.json'),
      (candidate) => {
        candidate.createdFiles.push('/outside.ts')
        candidate.fileHashes['/outside.ts'] = '0'.repeat(64)
      },
      (candidate) => {
        candidate.createdFiles.push('electron/../package.json')
        candidate.fileHashes['electron/../package.json'] = '0'.repeat(64)
      },
      (candidate) => {
        candidate.fileHashes['package.json'] = '0'.repeat(64)
      },
      (candidate) => {
        candidate.desktopDir = 'electron//nested'
      },
    ]

    for (const schemaVersion of [1, 2]) {
      const compatibleManifest = structuredClone(manifest)
      compatibleManifest.schemaVersion = schemaVersion
      expect(() => parseManifest(compatibleManifest)).not.toThrow()

      for (const mutate of invalidMutations) {
        const forgedManifest = structuredClone(compatibleManifest)
        mutate(forgedManifest)
        expect(() => parseManifest(forgedManifest)).toThrow('.frontron/manifest.json is invalid.')
      }
    }
  })

  test('v1 parsing without desktopDir keeps only the conservative legacy file set', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const legacyManifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as GeneratedManifest
    legacyManifest.schemaVersion = 1
    delete legacyManifest.desktopDir

    expect(() => parseManifest(legacyManifest)).not.toThrow()

    const forgedCreatedFile = structuredClone(legacyManifest)
    forgedCreatedFile.createdFiles.push('custom/main.ts')
    forgedCreatedFile.fileHashes['custom/main.ts'] = '0'.repeat(64)
    expect(() => parseManifest(forgedCreatedFile)).toThrow('.frontron/manifest.json is invalid.')

    const forgedFileHash = structuredClone(legacyManifest)
    forgedFileHash.fileHashes['package.json'] = '0'.repeat(64)
    expect(() => parseManifest(forgedFileHash)).toThrow('.frontron/manifest.json is invalid.')
  })

  test('clean and update never accept package.json as a generated file', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GeneratedManifest
    manifest.createdFiles.push('package.json')
    manifest.fileHashes['package.json'] = createFileHash(packageJsonSource)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    for (const command of [
      ['clean', '--yes', '--force'],
      ['update', '--yes', '--force'],
    ]) {
      const output = fixtures.createOutput()
      expect(await runCli(command, output, { cwd: projectRoot })).toBe(1)
      expect(output.error.mock.calls.flat().join('\n')).toContain(
        '.frontron/manifest.json is invalid.',
      )
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonSource)
      expect(existsSync(manifestPath)).toBe(true)
    }
  })

  test.each([
    ['unknown schema', (manifest: Record<string, unknown>) => (manifest.schemaVersion = 99)],
    ['missing v2 hashes', (manifest: Record<string, unknown>) => delete manifest.fileHashes],
    [
      'claim without an owned value',
      (manifest: Record<string, unknown>) =>
        (manifest.packageJsonClaims = [
          { path: 'build.appId', action: 'set', previous: { state: 'missing' } },
        ]),
    ],
    [
      'unsafe claim path',
      (manifest: Record<string, unknown>) =>
        (manifest.packageJsonClaims = [
          {
            path: '__proto__.polluted',
            action: 'set',
            value: true,
            previous: { state: 'missing' },
          },
        ]),
    ],
  ])('rejects %s', async (_label, mutate) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    mutate(manifest)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      '.frontron/manifest.json is invalid',
    )
  })

  test('manifest readers reject invalid file hash metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fileHashes: unknown
    }
    manifest.fileHashes = ['not-valid']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('manifest readers reject invalid script command metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scriptCommands: unknown
    }
    manifest.scriptCommands = ['not-valid']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('manifest readers reject invalid package ownership metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      packageJsonClaims: unknown
    }
    manifest.packageJsonClaims = [{ path: 'build.files', previous: { state: 'nope' } }]
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('legacy manifests without script commands require --force before clean removes them', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
      scriptCommands?: Record<string, string>
    }
    manifest.schemaVersion = 1
    delete manifest.scriptCommands
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(1)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(true)
    expect(combined).toContain(
      '.frontron/manifest.json does not include script commands. Run "frontron update --yes" to refresh it.',
    )
    expect(combined).toContain('has no recorded command and will not be removed without --force')

    const forcedExitCode = await runCli(['clean', '--yes', '--force'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(forcedExitCode).toBe(0)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
  })

  test('legacy manifests without package ownership leave package metadata intact', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
      packageJsonClaims?: unknown
    }
    manifest.schemaVersion = 1
    delete manifest.packageJsonClaims
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
      build: {
        extraMetadata: {
          main: string
        }
      }
    }

    expect(cleanExitCode).toBe(0)
    expect(packageJson.devDependencies.electron).toBeTruthy()
    expect(packageJson.build.extraMetadata.main).toBe('dist-electron/main.js')
    expect(combined).toContain(
      '.frontron/manifest.json does not include package.json ownership. Run "frontron update --yes" to refresh it.',
    )
  })
})
