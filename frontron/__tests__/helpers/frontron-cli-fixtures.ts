import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, vi } from 'vitest'

import type { CliContext } from '../../src/cli'

export function createOutput() {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }
}

export function createTempProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-init-'))

  writeFileSync(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sample-web-app',
        version: '0.0.1',
        scripts: {
          dev: 'vite --port 5180',
          build: 'vite build',
        },
        devDependencies: {
          vite: '^8.0.1',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(projectRoot, 'vite.config.ts'),
    `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
  )

  return projectRoot
}

export function createTempProjectWithScripts(
  scripts: Record<string, string>,
  options?: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    extraFiles?: Record<string, string>
    viteConfigSource?: string
  },
) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-init-'))

  writeFileSync(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sample-web-app',
        version: '0.0.1',
        scripts,
        dependencies: options?.dependencies ?? {},
        devDependencies: options?.devDependencies ?? {
          vite: '^8.0.1',
        },
      },
      null,
      2,
    )}\n`,
  )

  if (options?.viteConfigSource) {
    writeFileSync(join(projectRoot, 'vite.config.ts'), options.viteConfigSource)
  }

  for (const [filePath, source] of Object.entries(options?.extraFiles ?? {})) {
    writeFileSync(join(projectRoot, filePath), source)
  }

  return projectRoot
}

export function createPromptAnswers(answers: string[], confirms: boolean[] = []): CliContext['prompter'] {
  let textIndex = 0
  let confirmIndex = 0

  return {
    async text(_message, defaultValue) {
      return answers[textIndex++] ?? defaultValue
    },
    async confirm(_message, defaultValue) {
      return confirms[confirmIndex++] ?? defaultValue
    },
    close() {},
  }
}

export function expectEmbeddedString(source: string, name: string, value: string) {
  expect(source).toContain(
    `const ${name} = readEmbeddedJson<string>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

export function expectEmbeddedNullableString(source: string, name: string, value: string | null) {
  expect(source).toContain(
    `const ${name} = readEmbeddedJson<string | null>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

export function expectEmbeddedRuntimeStrategy(
  source: string,
  value: 'static-export' | 'node-server',
) {
  expect(source).toContain(
    `const RUNTIME_STRATEGY = readEmbeddedJson<'static-export' | 'node-server'>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

export const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
