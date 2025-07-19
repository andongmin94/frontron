import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { createFileHash, parseManifest } from '../src/init/manifest'
import * as fixtures from './helpers/frontron-cli-fixtures'

type GeneratedManifest = Record<string, unknown> & {
  schemaVersion: number
  createdFiles: string[]
  fileHashes: Record<string, string>
  packageJsonClaims: unknown[]
}

function readGeneratedManifest(projectRoot: string) {
  return JSON.parse(
    readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
  ) as GeneratedManifest
}

describe('frontron manifest', () => {
  test('init writes the complete current manifest contract', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = readGeneratedManifest(projectRoot)

    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.createdFiles).toContain('.frontron/manifest.json')
    expect(manifest.fileHashes['electron/main.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.fileHashes['.frontron/manifest.json']).toBeUndefined()
    expect(() => parseManifest(manifest)).not.toThrow()
  })

  test('older manifest schemas are rejected instead of migrated', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = readGeneratedManifest(projectRoot)
    manifest.schemaVersion = 1

    expect(() => parseManifest(manifest)).toThrow('uses unsupported schema version 1')
  })

  test('parser rejects generated-file and ownership claims outside the managed surface', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifest = readGeneratedManifest(projectRoot)
    const forgedFileManifest = structuredClone(manifest)
    forgedFileManifest.createdFiles.push('package.json')
    forgedFileManifest.fileHashes['package.json'] = createFileHash(
      readFileSync(join(projectRoot, 'package.json')),
    )

    expect(() => parseManifest(forgedFileManifest)).toThrow('.frontron/manifest.json is invalid')

    const forgedClaimManifest = structuredClone(manifest)
    forgedClaimManifest.packageJsonClaims = [
      {
        path: '__proto__.polluted',
        action: 'set',
        value: true,
        previous: { state: 'missing' },
      },
    ]

    expect(() => parseManifest(forgedClaimManifest)).toThrow('.frontron/manifest.json is invalid')
  })

  test('clean and update reject a manifest that claims package.json as a generated file', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = readGeneratedManifest(projectRoot)
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
        '.frontron/manifest.json is invalid',
      )
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonSource)
      expect(existsSync(manifestPath)).toBe(true)
    }
  })
})
