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

function readRendererProbe(probePath: string) {
  return JSON.parse(readFileSync(probePath, 'utf8')) as {
    ok: boolean
    protocol: string
    bridgeType: string
    appInfo: { name: string; version: string } | null
  }
}

function expectHealthyRendererProbe(probePath: string, protocol: 'http:' | 'frontron:') {
  const probe = readRendererProbe(probePath)
  expect(probe).toMatchObject({
    ok: true,
    protocol,
    bridgeType: 'object',
  })
  expect(probe.appInfo?.name).toBeTruthy()
}

function runDevelopmentAppProbe(generatedAppRoot: string, probePath: string) {
  const result = spawnSync('xvfb-run', ['-a', 'npm', 'run', 'app'], {
    cwd: generatedAppRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CI: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      FRONTRON_RENDERER_PROBE_PATH: probePath,
    },
  })

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expectHealthyRendererProbe(probePath, 'http:')
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
}, 60000)

test('packed create-frontron generates a buildable template-owned Electron starter', () => {
  const createTarball = packPackageForReal(createPackageRoot, 'create-frontron-release-')
  const rehearsalRoot = mkdtempSync(join(tmpdir(), 'frontron-release-rehearsal-'))
  const generatedAppName = 'release-smoke-app'
  const generatedAppRoot = join(rehearsalRoot, generatedAppName)

  tempDirs.push(rehearsalRoot)

  runNpm(['init', '-y'], rehearsalRoot)
  runNpm(
    ['exec', '--package', createTarball, '--', 'create-frontron', generatedAppName],
    rehearsalRoot,
  )

  const generatedPackage = JSON.parse(
    readFileSync(join(generatedAppRoot, 'package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    trustedDependencies?: string[]
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
  expect(generatedPackage.trustedDependencies).toEqual(['electron', 'electron-winstaller'])
  expect(generatedPackage.main).toBe('dist/electron/main.js')
  expect(generatedPackage.build?.productName).toBe(generatedAppName)
  expect(generatedPackage.build?.appId).toContain(generatedAppName)
  expect(generatedPackage.build?.icon).toBe('public/logo.svg')
  expect(generatedPackage).not.toHaveProperty('author')
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

  if (process.env.FRONTRON_TEST_ELECTRON_RUNTIME === '1') {
    runDevelopmentAppProbe(generatedAppRoot, join(rehearsalRoot, 'dev-renderer-probe.json'))
  }

  runNpm(['run', 'build', '--', '--dir'], generatedAppRoot)

  if (process.env.FRONTRON_TEST_ELECTRON_RUNTIME === '1') {
    const executablePath = join(
      generatedAppRoot,
      'output',
      'linux-unpacked',
      generatedAppName,
    )
    const probePath = join(rehearsalRoot, 'packaged-renderer-probe.json')
    const result = spawnSync(
      'xvfb-run',
      ['-a', executablePath, '--no-sandbox'],
      {
        cwd: generatedAppRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          FRONTRON_RENDERER_PROBE_PATH: probePath,
        },
      },
    )

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expectHealthyRendererProbe(probePath, 'frontron:')
  }
}, 600000)
