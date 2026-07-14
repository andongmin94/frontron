import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { resolveInitAdapterSelection } from '../src/init/adapters'
import { resolveBuildCommandOrThrow } from '../src/init/adapters/build-command'
import { genericNodeServerAdapter, genericStaticAdapter } from '../src/init/adapters/generic'
import { nextExportAdapter, nextStandaloneAdapter } from '../src/init/adapters/next'
import { nuxtNodeServerAdapter, remixNodeServerAdapter } from '../src/init/adapters/node-frameworks'
import { svelteKitNodeAdapter, svelteKitStaticAdapter } from '../src/init/adapters/sveltekit'
import type { InitAdapter, PackageJson } from '../src/init/shared'
import * as fixtures from './helpers/frontron-cli-fixtures'

const adapters: InitAdapter[] = [
  nextStandaloneAdapter,
  nuxtNodeServerAdapter,
  remixNodeServerAdapter,
  nextExportAdapter,
  svelteKitNodeAdapter,
  svelteKitStaticAdapter,
  genericNodeServerAdapter,
  genericStaticAdapter,
]

function readPackageJson(projectRoot: string) {
  return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as PackageJson
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('init adapter selection', () => {
  test('rejects a selected build script that no longer exists', () => {
    expect(() => resolveBuildCommandOrThrow({ scripts: {} }, 'web:build')).toThrow(
      'Selected web build script "web:build" was not found.',
    )
  })

  test('runs every detector once and warns when a specific adapter ties the generic fallback', () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'vite',
        build: 'vite build',
      },
      {
        devDependencies: {
          vite: '^8.0.1',
          '@sveltejs/adapter-static': '^3.0.0',
        },
        extraFiles: {
          'svelte.config.js': `import adapter from '@sveltejs/adapter-static'

export default { kit: { adapter: adapter() } }
`,
          'vite.config.ts': 'export default {}\n',
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const detectorSpies = adapters.map((adapter) => vi.spyOn(adapter, 'detect'))

    const selection = resolveInitAdapterSelection(
      projectRoot,
      readPackageJson(projectRoot),
      undefined,
    )

    expect(selection.adapter.id).toBe('sveltekit-static')
    expect(selection.confidence).toBe('high')
    expect(selection.warnings).toContainEqual(expect.stringContaining('generic-static fallback'))

    for (const detectorSpy of detectorSpies) {
      expect(detectorSpy).toHaveBeenCalledTimes(1)
    }
  })

  test('selects a high-confidence match ahead of an earlier medium-confidence match', () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'node scripts/dev.js',
        build: 'node scripts/build.js',
      },
      {
        dependencies: {
          nuxt: '^4.0.0',
          '@remix-run/node': '^2.0.0',
        },
        devDependencies: {},
        extraFiles: {
          'remix.config.js': 'module.exports = {}\n',
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)

    const selection = resolveInitAdapterSelection(
      projectRoot,
      readPackageJson(projectRoot),
      undefined,
    )

    expect(selection.adapter.id).toBe('remix-node-server')
    expect(selection.confidence).toBe('high')
  })

  test('requires an explicit adapter when concrete matches tie at the highest confidence', () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'node scripts/dev.js',
        build: 'node scripts/build.js',
      },
      {
        dependencies: {
          nuxt: '^4.0.0',
          '@remix-run/node': '^2.0.0',
        },
        devDependencies: {},
        extraFiles: {
          'nuxt.config.ts': 'export default {}\n',
          'remix.config.js': 'module.exports = {}\n',
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)

    expect(() =>
      resolveInitAdapterSelection(projectRoot, readPackageJson(projectRoot), undefined),
    ).toThrow(
      /Ambiguous adapter detection at high confidence: "nuxt-node-server", "remix-node-server".*--adapter/,
    )
  })
})
