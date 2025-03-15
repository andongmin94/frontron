import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
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
  expect(packedFiles.has('dist/index.mjs')).toBe(true)
  expect(packedFiles.has('template/src/electron/main.ts')).toBe(true)
  expect(packedFiles.has('template/src/electron/preload.ts')).toBe(true)
  expect(packedFiles.has('template/src/electron/window.ts')).toBe(true)
  expect(packedFiles.has('template/src/types/electron.d.ts')).toBe(true)
  expect(packedFiles.has('template/tsconfig.electron.json')).toBe(true)
  expect(packedFiles.has('template/src/App.tsx')).toBe(true)
  expect(packedFiles.has('template/components.json')).toBe(true)
  expect(packedFiles.has('template/src/components/ui/button.tsx')).toBe(true)
  expect(packedFiles.has('template/src/components/theme-provider.tsx')).toBe(true)
  expect(packedFiles.has('template/src/hooks/use-mobile.ts')).toBe(true)
  expect(packedFiles.has('package.json')).toBe(true)
  expect(packedFiles.has('README.md')).toBe(true)

  expect(packedFiles.has('src/index.ts')).toBe(false)
  expect(packedFiles.has('__tests__/template-smoke.spec.ts')).toBe(false)
  expect(packedFiles.has('template/src/lib/electron.ts')).toBe(false)
  expect(packedFiles.has('template/frontron.config.ts')).toBe(false)
  expect(packedFiles.has('template/frontron/config.ts')).toBe(false)
  expect(packedFiles.has('template/frontron/rust/Cargo.toml')).toBe(false)
  expect(packedFiles.has('PLANS.md')).toBe(false)
  },
)

test('create-frontron can produce a real publish tarball', { timeout: 20_000 }, () => {
  const tarballPath = packPackageForReal()

  expect(existsSync(tarballPath)).toBe(true)
  expect(tarballPath.endsWith('.tgz')).toBe(true)
})
