import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const frontronPackageRoot = join(repoRoot, 'frontron')
const tempRoot = join(repoRoot, '.tmp')
const scratchRoot = join(repoRoot, '.tmp', 'release-matrix-smoke')
const tempRoots = []

function getNpmInvocation(args) {
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

function logStep(message) {
  console.log(`[matrix] ${message}`)
}

function getChildEnv() {
  const nodeOptions = process.env.NODE_OPTIONS?.trim()

  if (nodeOptions?.includes('--trace-deprecation') || nodeOptions?.includes('--no-deprecation')) {
    return process.env
  }

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions ? `${nodeOptions} --no-deprecation` : '--no-deprecation',
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: getChildEnv(),
    stdio: 'pipe',
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`)
  }
}

function runNpm(args, cwd) {
  const invocation = getNpmInvocation(args)
  run(invocation.command, invocation.args, cwd)
}

function installNpm(args, cwd) {
  runNpm(['install', '--fund=false', '--audit=false', '--loglevel=error', ...args], cwd)
}

function createScratchDir(prefix) {
  mkdirSync(scratchRoot, { recursive: true })
  const directory = mkdtempSync(join(scratchRoot, `${prefix}-`))
  tempRoots.push(directory)
  return directory
}

function ensureBuildOutput(root) {
  runNpm(['run', 'build'], root)
}

function packPackageForReal(root, prefix) {
  ensureBuildOutput(root)

  const outputDir = createScratchDir(prefix)
  const invocation = getNpmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir])
  const result = spawnSync(
    invocation.command,
    invocation.args,
    {
      cwd: root,
      encoding: 'utf8',
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'npm pack failed')
  }

  const packResult = JSON.parse(result.stdout)
  const filename = packResult[0]?.filename

  if (!filename) {
    throw new Error('npm pack did not report an output filename')
  }

  return join(outputDir, filename)
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function assertFileExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} was not created at ${path}`)
  }
}

function createVitePressProject(appRoot) {
  const docsRoot = join(appRoot, 'docs')
  const vitepressRoot = join(docsRoot, '.vitepress')

  mkdirSync(vitepressRoot, { recursive: true })

  writeJson(join(appRoot, 'package.json'), {
    name: 'matrix-vitepress-app',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      'docs:dev': 'vitepress dev docs',
      'docs:build': 'vitepress build docs',
    },
  })

  writeFileSync(
    join(docsRoot, 'index.md'),
    '# Matrix VitePress App\n\nThis is a minimal VitePress site for Frontron release matrix smoke tests.\n',
  )

  writeFileSync(
    join(vitepressRoot, 'config.mts'),
    `import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Matrix VitePress App',
  description: 'Release matrix smoke fixture',
})
`,
  )
}

function runStarterCase(createTarball) {
  logStep('starter case: packed create-frontron -> typecheck -> MSI and portable package')

  const root = createScratchDir('starter')
  const appName = 'matrix-starter-app'
  const appRoot = join(root, appName)

  runNpm(['init', '-y'], root)
  installNpm(['--ignore-scripts', createTarball], root)

  runNpm(['exec', '--', 'create-frontron', appName, '--overwrite', 'yes'], root)
  installNpm([], appRoot)
  runNpm(['run', 'typecheck'], appRoot)
  runNpm(['run', 'build'], appRoot)

  if (process.platform === 'win32') {
    assertFileExists(join(appRoot, 'output', `${appName}-0.0.0-x64.msi`), 'starter MSI package')
    assertFileExists(join(appRoot, 'output', `${appName}.exe`), 'starter portable package')
  } else {
    assertFileExists(join(appRoot, 'output'), 'starter package output directory')
  }
}

function runViteCase(frontronTarball) {
  logStep('vite case: existing Vite app -> init -> frontron:build -> package directory')

  const root = createScratchDir('vite')
  const appName = 'matrix-vite-app'
  const appRoot = join(root, appName)

  runNpm(['create', 'vite@latest', appName, '--', '--template', 'react-ts'], root)
  installNpm([], appRoot)
  installNpm(['--ignore-scripts', frontronTarball], appRoot)
  installNpm([], appRoot)

  runNpm(['exec', '--', 'frontron', 'init', '--yes'], appRoot)
  installNpm([], appRoot)
  runNpm(['run', 'frontron:build'], appRoot)
  runNpm(['run', 'frontron:package', '--', '--dir'], appRoot)
}

function runVitePressCase(frontronTarball) {
  logStep('vitepress case: existing docs app -> init -> frontron:build -> package directory')

  const appRoot = createScratchDir('vitepress')

  createVitePressProject(appRoot)
  installNpm(['--ignore-scripts', 'vitepress', frontronTarball], appRoot)
  installNpm([], appRoot)

  runNpm(
    [
      'exec',
      '--',
      'frontron',
      'init',
      '--yes',
      '--web-dev',
      'docs:dev',
      '--web-build',
      'docs:build',
      '--out-dir',
      'docs/.vitepress/dist',
    ],
    appRoot,
  )
  installNpm([], appRoot)
  runNpm(['run', 'frontron:build'], appRoot)
  runNpm(['run', 'frontron:package', '--', '--dir'], appRoot)
}

function runGenericNodeServerCase(frontronTarball) {
  logStep('generic-node-server case: custom node runtime -> init -> package directory')

  const appRoot = createScratchDir('generic-node-server')
  const scriptsRoot = join(appRoot, 'scripts')
  mkdirSync(scriptsRoot, { recursive: true })

  writeJson(join(appRoot, 'package.json'), {
    name: 'matrix-generic-node-server-app',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'node scripts/dev-server.mjs',
      build: 'node scripts/build.mjs',
    },
  })

  writeFileSync(
    join(scriptsRoot, 'dev-server.mjs'),
    `import { createServer } from 'node:http'

const server = createServer((_request, response) => {
  response.end('ok')
})

server.listen(4217, '127.0.0.1')
`,
  )

  writeFileSync(
    join(scriptsRoot, 'build.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const serverRoot = join(process.cwd(), '.output', 'server')
mkdirSync(serverRoot, { recursive: true })
writeFileSync(join(serverRoot, 'index.mjs'), "console.log('generic node server')\\n")
`,
  )

  installNpm(['--ignore-scripts', frontronTarball], appRoot)
  installNpm([], appRoot)

  runNpm(
    [
      'exec',
      '--',
      'frontron',
      'init',
      '--yes',
      '--adapter',
      'generic-node-server',
      '--server-root',
      '.output',
      '--server-entry',
      'server/index.mjs',
    ],
    appRoot,
  )
  installNpm([], appRoot)
  runNpm(['run', 'frontron:package', '--', '--dir'], appRoot)
}

function main() {
  const createTarball = packPackageForReal(packageRoot, 'create-frontron-matrix-')
  const frontronTarball = packPackageForReal(frontronPackageRoot, 'frontron-matrix-')
  const selectedCase = process.argv[2] ?? 'all'

  if (selectedCase === 'all' || selectedCase === 'starter') {
    runStarterCase(createTarball)
  }

  if (selectedCase === 'all' || selectedCase === 'vite') {
    runViteCase(frontronTarball)
  }

  if (selectedCase === 'all' || selectedCase === 'vitepress') {
    runVitePressCase(frontronTarball)
  }

  if (selectedCase === 'all' || selectedCase === 'generic-node-server') {
    runGenericNodeServerCase(frontronTarball)
  }

  if (!['all', 'starter', 'vite', 'vitepress', 'generic-node-server'].includes(selectedCase)) {
    throw new Error(`Unknown matrix case: ${selectedCase}`)
  }

  logStep('all representative matrix cases passed')
}

try {
  main()
} finally {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(resolve(tempRoot), { recursive: true, force: true })
  }

  rmSync(scratchRoot, { recursive: true, force: true })

  if (existsSync(tempRoot) && readdirSync(tempRoot).length === 0) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}
