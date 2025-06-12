import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
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

function ensureBuildOutput() {
  runNpm(['run', 'build'], packageRoot)
}

function readPackedFiles() {
  ensureBuildOutput()

  const output = runNpm(['pack', '--json', '--dry-run', '--ignore-scripts'], packageRoot)
  const packResult = JSON.parse(output) as Array<{
    files?: Array<{
      path: string
    }>
  }>

  return new Set((packResult[0]?.files ?? []).map((entry) => entry.path))
}

function packPackageForReal() {
  ensureBuildOutput()

  const outputDir = mkdtempSync(join(tmpdir(), 'create-frontron-pack-'))
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
})

test(
  'create-frontron npm pack output includes the starter generator contract',
  { timeout: 20_000 },
  () => {
    const packedFiles = readPackedFiles()

    expect(packedFiles.has('index.js')).toBe(true)
    expect(packedFiles.has('scripts/tasks.mjs')).toBe(false)
    expect(packedFiles.has('dist/index.mjs')).toBe(true)
    expect(packedFiles.has('template/src/electron/main.ts')).toBe(true)
    expect(packedFiles.has('template/src/electron/preload.ts')).toBe(true)
    expect(packedFiles.has('template/src/electron/window.ts')).toBe(true)
    expect(packedFiles.has('template/scripts/tasks.mjs')).toBe(true)
    expect(packedFiles.has('template/src/types/electron.d.ts')).toBe(true)
    expect(packedFiles.has('template/tsconfig.electron.json')).toBe(true)
    expect(packedFiles.has('template/src/App.tsx')).toBe(true)
    expect(packedFiles.has('template/components.json')).toBe(true)
    expect(packedFiles.has('template/src/components/ui/button.tsx')).toBe(true)
    expect(packedFiles.has('template/src/components/theme-provider.tsx')).toBe(true)
    expect(packedFiles.has('template/src/hooks/use-mobile.ts')).toBe(false)
    expect(packedFiles.has('package.json')).toBe(true)
    expect(packedFiles.has('README.md')).toBe(true)
    expect(packedFiles.has('LICENSE')).toBe(true)

    expect(packedFiles.has('src/index.ts')).toBe(false)
    expect(packedFiles.has('__tests__/template-smoke.spec.ts')).toBe(false)
    expect(packedFiles.has('template/src/lib/electron.ts')).toBe(false)
    expect(packedFiles.has('template/frontron.config.ts')).toBe(false)
    expect(packedFiles.has('template/frontron/config.ts')).toBe(false)
    expect(packedFiles.has('template/frontron/rust/Cargo.toml')).toBe(false)
    expect(packedFiles.has('PLANS.md')).toBe(false)
    expect([...packedFiles].some((path) => path.startsWith('template/dist/'))).toBe(false)
    expect([...packedFiles].some((path) => path.startsWith('template/dist-ssr/'))).toBe(false)
    expect([...packedFiles].some((path) => path.startsWith('template/output/'))).toBe(false)
    expect(packedFiles.has('template/.npmignore')).toBe(false)
    expect([...packedFiles].some((path) => path.includes('/node_modules/'))).toBe(false)
    expect([...packedFiles].some((path) => path.endsWith('.tsbuildinfo'))).toBe(false)
  },
)

test('package exports allow metadata and template files while blocking implementation internals', () => {
  ensureBuildOutput()
  const packageRequire = createRequire(join(packageRoot, 'package.json'))

  expect(packageRequire.resolve('create-frontron/package.json')).toBe(
    join(packageRoot, 'package.json'),
  )
  expect(packageRequire.resolve('create-frontron/template/src/electron/main.ts')).toBe(
    join(packageRoot, 'template', 'src', 'electron', 'main.ts'),
  )
  expect(() => packageRequire.resolve('create-frontron/dist/index.mjs')).toThrow(
    /Package subpath .* is not defined by "exports"/,
  )
  expect(() => packageRequire.resolve('create-frontron/src/index.ts')).toThrow(
    /Package subpath .* is not defined by "exports"/,
  )
})

test('create-frontron can produce a real publish tarball', { timeout: 20_000 }, () => {
  const tarballPath = packPackageForReal()

  expect(existsSync(tarballPath)).toBe(true)
  expect(tarballPath.endsWith('.tgz')).toBe(true)
})
