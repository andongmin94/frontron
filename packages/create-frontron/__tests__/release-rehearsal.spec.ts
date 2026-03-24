import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(createPackageRoot))
const frontronPackageRoot = join(repoRoot, 'packages', 'frontron')
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
  if (existsSync(join(packageRoot, 'dist', 'index.mjs'))) {
    return
  }

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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, 60000)

test('package versions stay in sync between create-frontron and frontron', () => {
  const createPackage = JSON.parse(
    readFileSync(join(createPackageRoot, 'package.json'), 'utf8'),
  ) as {
    version: string
  }
  const frontronPackage = JSON.parse(
    readFileSync(join(frontronPackageRoot, 'package.json'), 'utf8'),
  ) as {
    version: string
  }

  expect(createPackage.version).toBe(frontronPackage.version)
})

test(
  'packed create-frontron can generate an app that passes packed frontron dev check',
  async () => {
    const createPackage = JSON.parse(
      readFileSync(join(createPackageRoot, 'package.json'), 'utf8'),
    ) as {
      version: string
    }
    const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-release-')
    const frontronTarball = packPackageForReal(frontronPackageRoot, 'frontron-release-')
    const rehearsalRoot = mkdtempSync(join(tmpdir(), 'frontron-release-rehearsal-'))
    const generatedAppName = 'release-smoke-app'
    const generatedAppRoot = join(rehearsalRoot, generatedAppName)

    tempDirs.push(rehearsalRoot)

    runNpm(['init', '-y'], rehearsalRoot)
    runNpm(['install', '--ignore-scripts', createTarball, frontronTarball], rehearsalRoot)

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
    }

    expect(generatedPackage.dependencies.frontron).toBe(`^${createPackage.version}`)
    expect(generatedPackage.scripts['app:dev']).toBe('frontron dev')
    expect(generatedPackage.scripts['app:build']).toBe('frontron build')
    expect(existsSync(join(generatedAppRoot, 'frontron.config.ts'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'frontron', 'config.ts'))).toBe(true)
    expect(existsSync(join(generatedAppRoot, 'frontron', 'rust', 'Cargo.toml'))).toBe(true)

    const frontronCliPath = join(rehearsalRoot, 'node_modules', 'frontron', 'index.js')
    runNode([frontronCliPath, 'dev', '--cwd', generatedAppRoot, '--check'], rehearsalRoot)
    runNpm(['install', '--ignore-scripts', frontronTarball], generatedAppRoot)
    runNpm(['install'], generatedAppRoot)
    runNpm(['run', 'lint'], generatedAppRoot)

    expect(existsSync(join(generatedAppRoot, '.frontron', 'types', 'frontron-client.d.ts'))).toBe(
      true,
    )

    const generatedTypes = readFileSync(
      join(generatedAppRoot, '.frontron', 'types', 'frontron-client.d.ts'),
      'utf8',
    )

    expect(generatedTypes).toContain('cpuCount')
    expect(generatedTypes).toContain('hasTxtExtension')
  },
  180000,
)
