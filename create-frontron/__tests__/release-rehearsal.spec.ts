import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const tempDirs: string[] = []

function getNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runNpm(args: string[], cwd: string) {
  const result = spawnSync(getNpmExecutable(), args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'npm command failed')
  }

  return result.stdout
}

function runNode(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'node command failed')
  }

  return result.stdout
}

function ensureBuildOutput(packageRoot: string) {
  runNpm(['run', 'build'], packageRoot)
}

function packPackageForReal(packageRoot: string, tempPrefix: string) {
  ensureBuildOutput(packageRoot)

  const outputDir = mkdtempSync(join(tmpdir(), tempPrefix))
  tempDirs.push(outputDir)

  const output = runNpm(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
    packageRoot,
  )
  const packResult = JSON.parse(output) as Array<{
    filename?: string
  }>
  const filename = packResult[0]?.filename

  if (!filename) {
    throw new Error('npm pack did not report an output filename')
  }

  return join(outputDir, filename)
}

function stabilizeGeneratedStarterDevPort(appRoot: string, port: number) {
  const packageJsonPath = join(appRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>
  }

  packageJson.scripts = {
    ...packageJson.scripts,
    dev: `vite --port ${port}`,
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, 60000)

test(
  'packed create-frontron can generate the restored template-owned electron starter',
  async () => {
    const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-release-')
    const rehearsalRoot = mkdtempSync(join(tmpdir(), 'frontron-release-rehearsal-'))
    const generatedAppName = 'release-smoke-app'
    const generatedAppRoot = join(rehearsalRoot, generatedAppName)

    tempDirs.push(rehearsalRoot)

    runNpm(['init', '-y'], rehearsalRoot)
    runNpm(['install', '--ignore-scripts', createTarball], rehearsalRoot)

    const createCliPath = join(
      rehearsalRoot,
      'node_modules',
      'create-frontron',
      'index.js',
    )

    runNode([createCliPath, generatedAppName, '--overwrite', 'yes'], rehearsalRoot)

    const generatedPackage = JSON.parse(
      readFileSync(join(generatedAppRoot, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      main?: string
      build?: {
        productName?: string
        appId?: string
      }
    }

    expect(generatedPackage.scripts.app).toContain('src/electron/serve.ts')
    expect(generatedPackage.scripts.build).toContain('electron-builder')
    expect(generatedPackage.dependencies).not.toHaveProperty('frontron')
    expect(generatedPackage.dependencies).toHaveProperty('express')
    expect(generatedPackage.devDependencies).toHaveProperty('electron')
    expect(generatedPackage.devDependencies).toHaveProperty('electron-builder')
    expect(generatedPackage.main).toBe('dist/electron/main.js')
    expect(generatedPackage.build?.productName).toBe(generatedAppName)
    expect(generatedPackage.build?.appId).toContain(generatedAppName)
    expect(existsSync(join(generatedAppRoot, 'src', 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'src', 'electron', 'preload.ts'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'src', 'types', 'electron.d.ts'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'tsconfig.electron.json'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'frontron.config.ts'))).toBe(false)

    runNpm(['install', '--ignore-scripts'], generatedAppRoot)
    stabilizeGeneratedStarterDevPort(generatedAppRoot, 4311)

    const packageAfterInstall = JSON.parse(
      readFileSync(join(generatedAppRoot, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }

    expect(packageAfterInstall.scripts.dev).toBe('vite --port 4311')
    expect(packageAfterInstall.scripts.app).toContain('src/electron/serve.ts')
  },
  120000,
)
