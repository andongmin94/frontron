import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import {
  getInitTemplateInfo,
  listCreateFrontronElectronFiles,
  readCreateFrontronTemplateFile,
  renderCreateFrontronElectronFile,
} from '../src/init/runtime/create-frontron-template'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron init core flow', () => {
  test('template reader exposes the matching repository Electron source', () => {
    const info = getInitTemplateInfo()
    const files = listCreateFrontronElectronFiles()
    const mainSource = readCreateFrontronTemplateFile('src/electron/main.ts')

    expect(info).toMatchObject({
      source: 'create-frontron',
      packageName: 'create-frontron',
      packageVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      resolvedFrom: 'repo',
    })
    expect(files).toEqual([...new Set(files)].sort())
    expect(files).toEqual(
      expect.arrayContaining(['dev.ts', 'ipc.ts', 'main.ts', 'preload.ts', 'window.ts']),
    )
    expect(files).not.toContain('serve.ts')
    expect(renderCreateFrontronElectronFile('main.ts')).toBe(
      mainSource.split('../../public/').join('../public/'),
    )
  })

  test('init writes the public Electron retrofit contract', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['init', '--yes'], output, { cwd: projectRoot })).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
      build: {
        appId: string
        productName: string
        files: string[]
        extraMetadata: { main: string }
      }
    }
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      schemaVersion: number
      adapter: string
      templateVersion: string
      createdFiles: string[]
      fileHashes: Record<string, string>
      scripts: string[]
      scriptCommands: Record<string, string>
      packageJsonClaims: Array<{ path: string }>
    }

    for (const filePath of [
      'electron/main.ts',
      'electron/window.ts',
      'electron/preload.ts',
      'electron/ipc.ts',
      'electron/serve.ts',
      'src/types/electron.d.ts',
      'tsconfig.electron.json',
      '.frontron/manifest.json',
    ]) {
      expect(existsSync(join(projectRoot, filePath))).toBe(true)
    }

    const windowSource = readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')
    expect(windowSource).not.toContain('frame: false')
    expect(windowSource).toContain('nodeIntegration: false')
    expect(windowSource).toContain('contextIsolation: true')
    expect(windowSource).toContain('sandbox: true')

    expect(packageJson.scripts['frontron:dev']).toContain('dist-electron/serve.js --dev-app')
    expect(packageJson.scripts['frontron:build']).toContain('electron-builder')
    expect(packageJson.scripts).not.toHaveProperty('frontron:package')
    expect(packageJson.devDependencies).toHaveProperty('electron')
    expect(packageJson.devDependencies).toHaveProperty('electron-builder')
    expect(packageJson.build.appId).toBe('com.local.sample-web-app')
    expect(packageJson.build.productName).toBe('Sample Web App')
    expect(packageJson.build.files).toContain('dist-web{,/**/*}')
    expect(packageJson.build.extraMetadata.main).toBe('dist-electron/main.js')

    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.adapter).toBe('generic-static')
    expect(manifest.templateVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.scripts).toEqual(['frontron:dev', 'frontron:build'])
    expect(manifest.scriptCommands['frontron:dev']).toBe(packageJson.scripts['frontron:dev'])
    expect(manifest.createdFiles).toContain('electron/main.ts')
    expect(manifest.fileHashes['electron/main.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.packageJsonClaims.map((claim) => claim.path)).toContain('build.appId')

    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('npm run frontron:dev')
    expect(report).toContain('npm run frontron:build')
  })

  test('Bun init adds only the required trust entries and clean restores the previous array', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
      trustedDependencies?: string[]
    }
    packageJson.packageManager = 'bun@1.3.14'
    packageJson.trustedDependencies = ['existing-native-tool']
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const initialized = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      trustedDependencies?: string[]
    }
    expect(initialized.trustedDependencies).toEqual([
      'existing-native-tool',
      'electron',
      'electron-winstaller',
    ])

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      packageJsonClaims: Array<{ path: string; value?: string }>
    }
    expect(
      manifest.packageJsonClaims.filter((claim) => claim.path === 'trustedDependencies'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'electron' }),
        expect.objectContaining({ value: 'electron-winstaller' }),
      ]),
    )

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const cleaned = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      trustedDependencies?: string[]
    }
    expect(cleaned.trustedDependencies).toEqual(['existing-native-tool'])
  })

  test('clean restores a package version that init had to add', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string
    }

    delete packageJson.version
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(
      JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string },
    ).toHaveProperty('version', '0.0.0')

    expect(await runCli(['clean', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(
      (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }).version,
    ).toBeUndefined()
  })
})
