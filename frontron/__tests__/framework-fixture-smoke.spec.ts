import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import * as ts from 'typescript'
import { afterEach, describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'

type FixtureFile = {
  path: string
  content: string
}

type FrameworkFixture = {
  name: string
  initArgs?: string[]
  packageJson: Record<string, unknown>
  files: FixtureFile[]
  buildCommands: string[]
  expectedPreparedPaths: string[]
}

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
    throw new Error(result.stderr || result.stdout || `npm ${args.join(' ')} failed`)
  }
}

function writeFixtureFiles(rootDir: string, files: FixtureFile[]) {
  for (const file of files) {
    const filePath = join(rootDir, file.path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, file.content, 'utf8')
  }
}

function createBuildScript(writes: FixtureFile[]) {
  return `import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const rootDir = process.cwd()
const writes = ${JSON.stringify(writes, null, 2)}

for (const entry of writes) {
  const filePath = join(rootDir, entry.path)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, entry.content, 'utf8')
}
`
}

function createFixtureProject(fixture: FrameworkFixture) {
  const projectRoot = mkdtempSync(join(tmpdir(), `frontron-fixture-${fixture.name}-`))
  tempDirs.push(projectRoot)

  writeFileSync(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        ...fixture.packageJson,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  )
  writeFixtureFiles(projectRoot, fixture.files)

  return projectRoot
}

function stubElectronModule(projectRoot: string) {
  const moduleRoot = join(projectRoot, 'node_modules', 'electron')
  mkdirSync(moduleRoot, { recursive: true })
  writeFileSync(
    join(moduleRoot, 'package.json'),
    `${JSON.stringify({ name: 'electron', main: 'index.js' }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(join(moduleRoot, 'index.js'), `module.exports = 'electron'\n`, 'utf8')
}

function transpileGeneratedServe(projectRoot: string) {
  const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
  const transpiled = ts.transpileModule(serveSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'serve.ts',
  })

  const distDir = join(projectRoot, 'dist-electron')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'serve.js'), transpiled.outputText, 'utf8')
}

function runPrepareBuild(projectRoot: string) {
  stubElectronModule(projectRoot)
  transpileGeneratedServe(projectRoot)

  const result = spawnSync(process.execPath, [join(projectRoot, 'dist-electron', 'serve.js'), '--prepare-build'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'prepare-build failed')
  }
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

const frameworkFixtures: FrameworkFixture[] = [
  {
    name: 'next-export',
    packageJson: {
      name: 'fixture-next-export',
      version: '0.0.1',
      scripts: {
        dev: 'echo next dev --hostname 127.0.0.1 --port 3300',
        build: 'echo next build && node scripts/build-build.mjs',
        export: 'echo next export -o out && node scripts/build-export.mjs',
      },
      dependencies: {
        next: '^16.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    },
    files: [
      {
        path: 'next.config.ts',
        content: `export default {
  output: 'export',
}
`,
      },
      {
        path: 'scripts/build-build.mjs',
        content: createBuildScript([{ path: '.next/build.txt', content: 'next build marker' }]),
      },
      {
        path: 'scripts/build-export.mjs',
        content: createBuildScript([{ path: 'out/index.html', content: '<!doctype html><title>next export</title>' }]),
      },
    ],
    buildCommands: ['build', 'export'],
    expectedPreparedPaths: ['out/index.html'],
  },
  {
    name: 'next-standalone',
    packageJson: {
      name: 'fixture-next-standalone',
      version: '0.0.1',
      scripts: {
        dev: 'echo next dev --hostname 127.0.0.1 --port 3400',
        build: 'echo next build && node scripts/build.mjs',
      },
      dependencies: {
        next: '^16.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    },
    files: [
      {
        path: 'next.config.ts',
        content: `export default {
  output: 'standalone',
}
`,
      },
      {
        path: 'public/asset.txt',
        content: 'public asset',
      },
      {
        path: 'scripts/build.mjs',
        content: createBuildScript([
          { path: '.next/standalone/server.js', content: 'console.log("next standalone")\n' },
          { path: '.next/static/chunk.js', content: 'chunk' },
        ]),
      },
    ],
    buildCommands: ['build'],
    expectedPreparedPaths: [
      '.frontron/runtime/next-standalone/server.js',
      '.frontron/runtime/next-standalone/.next/static/chunk.js',
      '.frontron/runtime/next-standalone/public/asset.txt',
    ],
  },
  {
    name: 'nuxt-node-server',
    packageJson: {
      name: 'fixture-nuxt-node',
      version: '0.0.1',
      scripts: {
        dev: 'echo nuxt dev --host 127.0.0.1 --port 3500',
        build: 'echo nuxt build && node scripts/build.mjs',
      },
      dependencies: {
        nuxt: '^4.0.0',
      },
    },
    files: [
      {
        path: 'nuxt.config.ts',
        content: `export default defineNuxtConfig({})
`,
      },
      {
        path: 'scripts/build.mjs',
        content: createBuildScript([
          { path: '.output/server/index.mjs', content: 'console.log("nuxt server")\n' },
        ]),
      },
    ],
    buildCommands: ['build'],
    expectedPreparedPaths: ['.frontron/runtime/nuxt-node-server/server/index.mjs'],
  },
  {
    name: 'remix-node-server',
    packageJson: {
      name: 'fixture-remix-node',
      version: '0.0.1',
      scripts: {
        dev: 'echo remix dev --host 127.0.0.1 --port 8002',
        build: 'echo remix build && node scripts/build.mjs',
      },
      dependencies: {
        '@remix-run/node': '^2.0.0',
      },
      devDependencies: {
        '@remix-run/dev': '^2.0.0',
      },
    },
    files: [
      {
        path: 'remix.config.js',
        content: `module.exports = {}
`,
      },
      {
        path: 'public/remix.txt',
        content: 'remix public asset',
      },
      {
        path: 'scripts/build.mjs',
        content: createBuildScript([
          { path: 'build/server/index.js', content: 'console.log("remix server")\n' },
        ]),
      },
    ],
    buildCommands: ['build'],
    expectedPreparedPaths: [
      '.frontron/runtime/remix-node-server/server/index.js',
      '.frontron/runtime/remix-node-server/public/remix.txt',
    ],
  },
  {
    name: 'sveltekit-static',
    packageJson: {
      name: 'fixture-sveltekit-static',
      version: '0.0.1',
      scripts: {
        dev: 'echo svelte-kit dev --host 127.0.0.1 --port 4173',
        build: 'echo vite build && node scripts/build.mjs',
      },
      devDependencies: {
        vite: '^8.0.1',
        '@sveltejs/kit': '^2.0.0',
        '@sveltejs/adapter-static': '^3.0.0',
      },
    },
    files: [
      {
        path: 'svelte.config.js',
        content: `import adapter from '@sveltejs/adapter-static'

export default {
  kit: {
    adapter: adapter(),
  },
}
`,
      },
      {
        path: 'scripts/build.mjs',
        content: createBuildScript([
          { path: 'build/index.html', content: '<!doctype html><title>sveltekit static</title>' },
        ]),
      },
    ],
    buildCommands: ['build'],
    expectedPreparedPaths: ['build/index.html'],
  },
  {
    name: 'sveltekit-node',
    packageJson: {
      name: 'fixture-sveltekit-node',
      version: '0.0.1',
      scripts: {
        dev: 'echo svelte-kit dev --host 127.0.0.1 --port 4173',
        build: 'echo vite build && node scripts/build.mjs',
      },
      devDependencies: {
        vite: '^8.0.1',
        '@sveltejs/kit': '^2.0.0',
        '@sveltejs/adapter-node': '^5.0.0',
      },
    },
    files: [
      {
        path: 'svelte.config.js',
        content: `import adapter from '@sveltejs/adapter-node'

export default {
  kit: {
    adapter: adapter(),
  },
}
`,
      },
      {
        path: 'scripts/build.mjs',
        content: createBuildScript([
          { path: 'build/index.js', content: 'console.log("sveltekit node")\n' },
        ]),
      },
    ],
    buildCommands: ['build'],
    expectedPreparedPaths: ['.frontron/runtime/sveltekit-node/index.js'],
  },
]

describe('framework fixture smoke', () => {
  for (const fixture of frameworkFixtures) {
    test(`prepare-build succeeds for ${fixture.name} fixtures`, async () => {
      const projectRoot = createFixtureProject(fixture)

      const exitCode = await runCli(['init', '--yes', ...(fixture.initArgs ?? [])], {
        info() {},
        error(message) {
          throw new Error(message)
        },
      }, {
        cwd: projectRoot,
      })

      expect(exitCode).toBe(0)

      for (const scriptName of fixture.buildCommands) {
        runNpm(['run', scriptName], projectRoot)
      }

      runPrepareBuild(projectRoot)

      for (const expectedPath of fixture.expectedPreparedPaths) {
        expect(existsSync(join(projectRoot, expectedPath))).toBe(true)
      }

      const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
      expect(serveSource).toContain('prepareBuild')
    })
  }
})
