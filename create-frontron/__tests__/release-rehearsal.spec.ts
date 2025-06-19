import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const tempDirs: string[] = []

function getNpmInvocation(args: string[]) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    }
  }

  return {
    command: 'npm',
    args,
  }
}

function runNpm(args: string[], cwd: string) {
  const invocation = getNpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'npm command failed')
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

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, 60000)

test('packed create-frontron can generate the restored template-owned electron starter', async () => {
  const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-release-')
  const rehearsalRoot = mkdtempSync(join(tmpdir(), 'frontron-release-rehearsal-'))
  const generatedAppName = 'release-smoke-app'
  const generatedAppRoot = join(rehearsalRoot, generatedAppName)

  tempDirs.push(rehearsalRoot)

  runNpm(['init', '-y'], rehearsalRoot)
  runNpm(
    [
      'exec',
      '--package',
      createTarball,
      '--',
      'create-frontron',
      generatedAppName,
      '--overwrite',
      'yes',
    ],
    rehearsalRoot,
  )

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
      icon?: string
    }
  }

  expect(generatedPackage.scripts.app).toBe('node scripts/tasks.mjs app')
  expect(generatedPackage.scripts.typecheck).toBe('node scripts/tasks.mjs typecheck')
  expect(generatedPackage.scripts.build).toBe('node scripts/tasks.mjs build')
  expect(generatedPackage.scripts.lint).toBe('node scripts/tasks.mjs lint')
  expect(generatedPackage.dependencies).not.toHaveProperty('frontron')
  expect(generatedPackage.devDependencies).toHaveProperty('electron')
  expect(generatedPackage.devDependencies).toHaveProperty('electron-builder')
  expect(generatedPackage.main).toBe('dist/electron/main.js')
  expect(generatedPackage.build?.productName).toBe(generatedAppName)
  expect(generatedPackage.build?.appId).toContain(generatedAppName)
  expect(generatedPackage.build?.icon).toBe('public/logo.svg')
  expect(existsSync(join(generatedAppRoot, 'src', 'electron', 'main.ts'))).toBe(true)
  expect(existsSync(join(generatedAppRoot, 'src', 'electron', 'preload.ts'))).toBe(true)
  expect(existsSync(join(generatedAppRoot, 'src', 'types', 'electron.d.ts'))).toBe(true)
  expect(existsSync(join(generatedAppRoot, 'tsconfig.electron.json'))).toBe(true)
  expect(existsSync(join(generatedAppRoot, 'frontron.config.ts'))).toBe(false)
  expect(existsSync(join(generatedAppRoot, 'dist'))).toBe(false)
  expect(existsSync(join(generatedAppRoot, '.npmignore'))).toBe(false)

  runNpm(['install'], generatedAppRoot)
  runNpm(['audit', '--audit-level=moderate'], generatedAppRoot)
  runNpm(['run', 'typecheck'], generatedAppRoot)
  runNpm(['run', 'build', '--', '--dir'], generatedAppRoot)

  const packageAfterInstall = JSON.parse(
    readFileSync(join(generatedAppRoot, 'package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>
  }

  expect(packageAfterInstall.scripts.dev).toBe('node scripts/tasks.mjs dev')
  expect(packageAfterInstall.scripts.app).toBe('node scripts/tasks.mjs app')
}, 600000)
