import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const createPackageRoot = join(repoRoot, 'create-frontron')
const tempDirs: string[] = []
const buildLockPath = join(packageRoot, '.test-build.lock')

function sleepSync(timeoutMs: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs)
}

// isProcessAlive 함수는 build lock을 만든 테스트 프로세스가 아직 실행 중인지 확인한다.
function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// readBuildLockOwner 함수는 깨진 lock도 stale 상태로 처리할 수 있게 PID를 읽는다.
function readBuildLockOwner() {
  try {
    return Number(readFileSync(buildLockPath, 'utf8'))
  } catch {
    return 0
  }
}

// releaseBuildLock 함수는 현재 프로세스가 만든 lock만 제거한다.
function releaseBuildLock() {
  if (readBuildLockOwner() === process.pid) {
    rmSync(buildLockPath, { force: true })
  }
}

// withBuildLock 함수는 병렬 pack 빌드를 직렬화하고 죽은 프로세스의 lock은 복구한다.
function withBuildLock<T>(run: () => T) {
  const startedAt = Date.now()

  while (true) {
    try {
      writeFileSync(buildLockPath, String(process.pid), { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      const ownerPid = readBuildLockOwner()

      if (!isProcessAlive(ownerPid)) {
        rmSync(buildLockPath, { force: true })
        continue
      }

      if (Date.now() - startedAt > 60_000) {
        throw new Error(`Timed out waiting for package build lock owned by process ${ownerPid}.`)
      }

      sleepSync(50)
    }
  }

  try {
    return run()
  } finally {
    releaseBuildLock()
  }
}

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

function ensureBuildOutput() {
  withBuildLock(() => {
    runNpm(['run', 'build'], packageRoot)
  })
}

function ensureCreateBuildOutput() {
  withBuildLock(() => {
    runNpm(['run', 'build'], createPackageRoot)
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
    runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir], packageRoot),
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

function packCreatePackageForReal() {
  ensureCreateBuildOutput()

  const outputDir = mkdtempSync(join(tmpdir(), 'create-frontron-pack-'))
  tempDirs.push(outputDir)

  const output = withBuildLock(() =>
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
      createPackageRoot,
    ),
  )
  const packResult = JSON.parse(output) as Array<{
    filename?: string
  }>
  const filename = packResult[0]?.filename

  if (!filename) {
    throw new Error('npm pack did not report an output filename for create-frontron')
  }

  return join(outputDir, filename)
}

function installPackedFrontron(appRoot: string, frontronTarballPath: string) {
  runNpm(['install', '--ignore-scripts', packCreatePackageForReal(), frontronTarballPath], appRoot)
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
    expect(packedFiles.has('scripts/tasks.mjs')).toBe(true)
    expect(packedFiles.has('dist/cli.mjs')).toBe(true)
    expect(packedFiles.has('dist/cli.d.ts')).toBe(true)
    expect(packedFiles.has('dist/cli.d.mts')).toBe(true)
    expect(packedFiles.has('package.json')).toBe(true)
    expect(packedFiles.has('README.md')).toBe(true)
    expect(packedFiles.has('LICENSE')).toBe(true)

    expect(packedFiles.has('template/create-frontron/src/electron/main.ts')).toBe(false)
    expect(packedFiles.has('template/create-frontron/src/electron/preload.ts')).toBe(false)
    expect(packedFiles.has('template/create-frontron/src/electron/window.ts')).toBe(false)
    expect(packedFiles.has('template/create-frontron/src/types/electron.d.ts')).toBe(false)
    expect(packedFiles.has('dist/index.mjs')).toBe(false)
    expect(packedFiles.has('dist/client.mjs')).toBe(false)
    expect(packedFiles.has('dist/runtime/main.mjs')).toBe(false)
    expect(packedFiles.has('dist/runtime/preload.mjs')).toBe(false)
    expect(packedFiles.has('assets/default-icon.ico')).toBe(false)

    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string
      dependencies?: Record<string, string>
      engines?: Record<string, string>
    }
    const createFrontronDependency = packageJson.dependencies?.['create-frontron']

    expect(packageJson.engines?.node).toBe('>=22.15.0')
    expect(
      createFrontronDependency === 'latest' ||
        createFrontronDependency === `^${packageJson.version}`,
    ).toBe(true)
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

  installPackedFrontron(appRoot, tarballPath)

  runNpm(['exec', '--', 'frontron', 'init', '--yes'], appRoot)
  expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)
  expect(existsSync(join(appRoot, 'electron', 'window.ts'))).toBe(true)
  expect(existsSync(join(appRoot, 'electron', 'serve.ts'))).toBe(true)
  expect(existsSync(join(appRoot, '.frontron', 'manifest.json'))).toBe(true)
  expect(existsSync(join(appRoot, 'tsconfig.electron.json'))).toBe(true)

  const doctorOutput = runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)

  expect(doctorOutput).toContain('No blockers found.')

  const cleanOutput = runNpm(['exec', '--', 'frontron', 'clean', '--dry-run'], appRoot)

  expect(cleanOutput).toContain('Frontron Clean')
  expect(cleanOutput).toContain('No changes were written because --dry-run was used.')

  const updateOutput = runNpm(['exec', '--', 'frontron', 'update', '--dry-run'], appRoot)

  expect(updateOutput).toContain('Files to overwrite:')
  expect(updateOutput).toContain('Run "frontron update --yes" to apply this plan.')
})

test(
  'packed frontron CLI can seed the create-frontron starter-like Electron layer',
  { timeout: 120_000 },
  () => {
    const tarballPath = packPackageForReal()
    const createPackageJson = JSON.parse(
      readFileSync(join(createPackageRoot, 'package.json'), 'utf8'),
    ) as {
      version: string
    }
    const appRoot = mkdtempSync(join(tmpdir(), 'frontron-retrofit-starter-app-'))
    tempDirs.push(appRoot)

    runNpm(['init', '-y'], appRoot)
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'packed-retrofit-starter-app',
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

    installPackedFrontron(appRoot, tarballPath)
    runNpm(
      ['exec', '--', 'frontron', 'init', '--yes', '--preset', 'starter-like', '--out-dir', 'dist'],
      appRoot,
    )

    const manifest = JSON.parse(
      readFileSync(join(appRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
    }
    const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
      }
    }

    expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(appRoot, 'electron', 'dev.ts'))).toBe(true)
    expect(existsSync(join(appRoot, 'electron', 'splash.ts'))).toBe(true)
    expect(existsSync(join(appRoot, 'electron', 'tray.ts'))).toBe(true)
    expect(existsSync(join(appRoot, 'src', 'types', 'electron.d.ts'))).toBe(true)
    expect(manifest.templateSource).toBe('create-frontron')
    expect(manifest.templatePackage).toBe('create-frontron')
    expect(manifest.templateVersion).toBe(createPackageJson.version)
    expect(manifest.templateResolvedFrom).toBe('dependency')
    expect(packageJson.build.files).toContain('public{,/**/*}')

    const doctorOutput = runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)

    expect(doctorOutput).toContain('No blockers found.')
  },
)
