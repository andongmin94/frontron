import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const tempDirs: string[] = []
const buildLockPath = join(packageRoot, '.test-build.lock')

function sleepSync(timeoutMs: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs)
}

function withBuildLock<T>(run: () => T) {
  while (true) {
    try {
      writeFileSync(buildLockPath, String(process.pid), { flag: 'wx' })
      break
    } catch {
      sleepSync(50)
    }
  }

  try {
    return run()
  } finally {
    rmSync(buildLockPath, { force: true })
  }
}

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

function ensureBuildOutput() {
  withBuildLock(() => {
    runNpm(['run', 'build'], packageRoot)
  })
}

function readPackedFiles() {
  ensureBuildOutput()

  const output = withBuildLock(() =>
    runNpm(['pack', '--json', '--dry-run', '--ignore-scripts'], packageRoot),
  )
  const packResult = JSON.parse(output) as Array<{
    files?: Array<{
      path: string
    }>
  }>

  return new Set((packResult[0]?.files ?? []).map((entry) => entry.path))
}

function packPackageForReal() {
  ensureBuildOutput()

  const outputDir = mkdtempSync(join(tmpdir(), 'frontron-pack-'))
  tempDirs.push(outputDir)

  const output = withBuildLock(() =>
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
      packageRoot,
    ),
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
})

test(
  'frontron npm pack output includes only the init-focused package files',
  { timeout: 60_000 },
  () => {
    const packedFiles = readPackedFiles()

    expect(packedFiles.has('index.js')).toBe(true)
    expect(packedFiles.has('dist/cli.mjs')).toBe(true)
    expect(packedFiles.has('dist/cli.d.ts')).toBe(true)
    expect(packedFiles.has('dist/cli.d.mts')).toBe(true)
    expect(packedFiles.has('package.json')).toBe(true)
    expect(packedFiles.has('README.md')).toBe(true)

    expect(packedFiles.has('dist/index.mjs')).toBe(false)
    expect(packedFiles.has('dist/client.mjs')).toBe(false)
    expect(packedFiles.has('dist/runtime/main.mjs')).toBe(false)
    expect(packedFiles.has('dist/runtime/preload.mjs')).toBe(false)
    expect(packedFiles.has('assets/default-icon.ico')).toBe(false)
  },
)

test('frontron can produce a real publish tarball', { timeout: 60_000 }, () => {
  const tarballPath = packPackageForReal()

  expect(existsSync(tarballPath)).toBe(true)
  expect(tarballPath.endsWith('.tgz')).toBe(true)
})

test('packed frontron CLI can seed the minimal Electron layer', { timeout: 120_000 }, () => {
  const tarballPath = packPackageForReal()
  const appRoot = mkdtempSync(join(tmpdir(), 'frontron-retrofit-app-'))
  tempDirs.push(appRoot)

  runNpm(['init', '-y'], appRoot)
  writeFileSync(
    join(appRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-retrofit-app',
        version: '0.0.1',
        scripts: {
          dev: 'vite',
          build: 'vite build',
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

  runNpm(['install', '--ignore-scripts', tarballPath], appRoot)

  const cliPath = join(appRoot, 'node_modules', 'frontron', 'index.js')
  const result = spawnSync(process.execPath, [cliPath, 'init', '--yes'], {
    cwd: appRoot,
    encoding: 'utf8',
  })

  expect(result.status).toBe(0)
  expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)
  expect(existsSync(join(appRoot, 'electron', 'window.ts'))).toBe(true)
  expect(existsSync(join(appRoot, 'electron', 'serve.ts'))).toBe(true)
  expect(existsSync(join(appRoot, 'tsconfig.electron.json'))).toBe(true)
})
