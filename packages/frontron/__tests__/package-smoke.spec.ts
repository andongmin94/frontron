import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  'frontron npm pack output includes the public framework surface only',
  { timeout: 20_000 },
  () => {
  const packedFiles = readPackedFiles()

  expect(packedFiles.has('index.js')).toBe(true)
  expect(packedFiles.has('dist/index.mjs')).toBe(true)
  expect(packedFiles.has('dist/client.mjs')).toBe(true)
  expect(packedFiles.has('dist/cli.mjs')).toBe(true)
  expect(packedFiles.has('dist/runtime/main.mjs')).toBe(true)
  expect(packedFiles.has('dist/runtime/preload.mjs')).toBe(true)
  expect(packedFiles.has('assets/default-icon.ico')).toBe(true)
  expect(packedFiles.has('package.json')).toBe(true)
  expect(packedFiles.has('README.md')).toBe(true)

  expect(packedFiles.has('src/runtime/native.ts')).toBe(false)
  expect(packedFiles.has('__tests__/runtime-native.spec.ts')).toBe(false)
  expect(packedFiles.has('PLANS.md')).toBe(false)
  },
)

test('frontron can produce a real publish tarball', { timeout: 20_000 }, () => {
  const tarballPath = packPackageForReal()

  expect(existsSync(tarballPath)).toBe(true)
  expect(tarballPath.endsWith('.tgz')).toBe(true)
})

test(
  'packed frontron works on an existing project through check and app build',
  { timeout: 300_000 },
  () => {
    const tarballPath = packPackageForReal()
    const appRoot = mkdtempSync(join(tmpdir(), 'frontron-existing-project-'))
    const scriptsDir = join(appRoot, 'scripts')
    const srcDir = join(appRoot, 'src')

    tempDirs.push(appRoot)

    mkdirSync(scriptsDir, { recursive: true })
    mkdirSync(srcDir, { recursive: true })

    writeFileSync(
      join(appRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'packed-frontron-existing-app',
          version: '0.0.0',
          private: true,
          scripts: {
            'web:dev': 'node scripts/web-dev.mjs',
            'web:build': 'node scripts/web-build.mjs',
          },
        },
        null,
        2,
      ),
    )
    writeFileSync(
      join(appRoot, 'index.html'),
      [
        '<!doctype html>',
        '<html>',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <title>Packed Frontron Existing App</title>',
        '  </head>',
        '  <body>',
        '    <div id="app">Packed Frontron Existing App</div>',
        '    <script type="module" src="/src/main.js"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(srcDir, 'main.js'),
      "document.getElementById('app').dataset.ready = 'true'\n",
    )
    writeFileSync(
      join(scriptsDir, 'web-build.mjs'),
      [
        "import { cpSync, mkdirSync } from 'node:fs'",
        "import { resolve } from 'node:path'",
        '',
        'const root = process.cwd()',
        "const dist = resolve(root, 'dist')",
        "mkdirSync(dist, { recursive: true })",
        "cpSync(resolve(root, 'index.html'), resolve(dist, 'index.html'))",
        "cpSync(resolve(root, 'src'), resolve(dist, 'src'), { recursive: true })",
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(scriptsDir, 'web-dev.mjs'),
      [
        "import { createServer } from 'node:http'",
        "import { readFileSync } from 'node:fs'",
        "import { resolve } from 'node:path'",
        '',
        'const root = process.cwd()',
        "const indexHtml = readFileSync(resolve(root, 'index.html'))",
        "const mainJs = readFileSync(resolve(root, 'src', 'main.js'))",
        '',
        'const server = createServer((request, response) => {',
        "  if (request.url === '/src/main.js') {",
        "    response.writeHead(200, { 'Content-Type': 'text/javascript' })",
        '    response.end(mainJs)',
        '    return',
        '  }',
        '',
        "  response.writeHead(200, { 'Content-Type': 'text/html' })",
        '  response.end(indexHtml)',
        '})',
        '',
        "server.listen(4173, '127.0.0.1')",
        '',
      ].join('\n'),
    )

    runNpm(['install', '--ignore-scripts', tarballPath], appRoot)
    runNpm(['install'], appRoot)

    const frontronCliPath = join(appRoot, 'node_modules', 'frontron', 'index.js')

    runNode([frontronCliPath, 'init', '--cwd', appRoot, '--skip-install'], appRoot)
    writeFileSync(
      join(appRoot, 'frontron.config.ts'),
      [
        "import { defineConfig } from 'frontron'",
        '',
        'export default defineConfig({',
        '  app: {',
        "    name: 'packed-frontron-existing-app',",
        "    id: 'com.example.packed-frontron-existing-app',",
        '  },',
        '  web: {',
        '    dev: {',
        "      command: 'npm run web:dev',",
        "      url: 'http://127.0.0.1:4173',",
        '    },',
        '    build: {',
        "      command: 'npm run web:build',",
        "      outDir: 'dist',",
        '    },',
        '  },',
        '})',
        '',
      ].join('\n'),
    )
    runNode([frontronCliPath, 'check', '--cwd', appRoot], appRoot)
    runNode([frontronCliPath, 'build', '--cwd', appRoot, '--check'], appRoot)
    runNpm(['run', 'app:build'], appRoot)

    expect(existsSync(join(appRoot, 'output', 'packed-frontron-existing-app Setup 0.0.0.exe'))).toBe(
      true,
    )
    expect(existsSync(join(appRoot, 'output', 'win-unpacked', 'packed-frontron-existing-app.exe'))).toBe(
      true,
    )
  },
)
