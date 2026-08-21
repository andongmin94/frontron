import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, expect, test } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(packageRoot)
const createPackageRoot = join(repositoryRoot, 'create-frontron')
const tempDirs: string[] = []

function npmInvocation(args: string[]) {
  return process.platform === 'win32'
    ? {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'npm', ...args],
      }
    : { command: 'npm', args }
}

function runNpm(args: string[], cwd: string) {
  const invocation = npmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `npm ${args.join(' ')} failed`)
  }

  return result.stdout
}

function runNode(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'node command failed')
  }

  return result.stdout
}

function pack(packageDirectory: string, prefix: string) {
  runNpm(['run', 'build'], packageDirectory)
  const outputDirectory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(outputDirectory)
  const result = JSON.parse(
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDirectory],
      packageDirectory,
    ),
  ) as Array<{ filename?: string }>
  const filename = result[0]?.filename

  if (!filename) throw new Error('npm pack did not report an output filename')
  return join(outputDirectory, filename)
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('frontron package exposes only its CLI and exact template dependency', { timeout: 60_000 }, () => {
  runNpm(['run', 'build'], packageRoot)
  const result = JSON.parse(
    runNpm(['pack', '--json', '--dry-run', '--ignore-scripts'], packageRoot),
  ) as Array<{ files?: Array<{ path: string }> }>
  const files = new Set((result[0]?.files ?? []).map((entry) => entry.path))
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    version: string
    main?: string
    types?: string
    dependencies?: Record<string, string>
  }

  expect(files.has('index.js')).toBe(true)
  expect(files.has('dist/cli.mjs')).toBe(true)
  expect(files.has('dist/cli.d.ts')).toBe(true)
  expect(files.has('package.json')).toBe(true)
  expect(files.has('README.md')).toBe(true)
  expect(files.has('LICENSE')).toBe(true)
  expect(files.has('scripts/tasks.mjs')).toBe(false)
  expect(packageJson.main).toBe('./dist/cli.mjs')
  expect(packageJson.types).toBe('./dist/cli.d.ts')
  expect(packageJson.dependencies?.['create-frontron']).toBe(packageJson.version)
})

test(
  'installed package runs the public retrofit lifecycle with its packed template',
  { timeout: 180_000 },
  () => {
    const createTarball = pack(createPackageRoot, 'create-frontron-pack-')
    const frontronTarball = pack(packageRoot, 'frontron-pack-')
    const appRoot = mkdtempSync(join(tmpdir(), 'frontron-consumer-'))
    tempDirs.push(appRoot)

    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'packed-retrofit-app',
          version: '0.0.1',
          private: true,
          type: 'module',
          scripts: {
            dev: 'node -e ""',
            build: 'node -e ""',
          },
        },
        null,
        2,
      )}\n`,
    )

    runNpm(['install', '--ignore-scripts', createTarball, frontronTarball], appRoot)

    const importResult = runNode(
      [
        '--input-type=module',
        '--eval',
        "const module = await import('frontron'); process.stdout.write(typeof module.runCli)",
      ],
      appRoot,
    )
    expect(importResult).toBe('function')

    runNpm(
      [
        'exec',
        '--',
        'frontron',
        'init',
        '--yes',
        '--adapter',
        'generic-static',
        '--out-dir',
        'dist',
      ],
      appRoot,
    )
    expect(existsSync(join(appRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(appRoot, '.frontron', 'manifest.json'))).toBe(true)

    expect(runNpm(['exec', '--', 'frontron', 'doctor'], appRoot)).toContain('No blockers found.')
    expect(runNpm(['exec', '--', 'frontron', 'update', '--dry-run'], appRoot)).toContain(
      'Run "frontron update --yes" to apply this plan.',
    )
    expect(runNpm(['exec', '--', 'frontron', 'clean', '--dry-run'], appRoot)).toContain(
      'No changes were written because --dry-run was used.',
    )
  },
)
