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

function getNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function logStep(message) {
  console.log(`[matrix] ${message}`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
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
  run(getNpmExecutable(), args, cwd)
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
  const npmExecutable = getNpmExecutable()
  const result = spawnSync(
    npmExecutable,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
    {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
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
  logStep('starter case: packed create-frontron -> typecheck')

  const root = createScratchDir('starter')
  const appName = 'matrix-starter-app'
  const appRoot = join(root, appName)

  runNpm(['init', '-y'], root)
  runNpm(['install', '--ignore-scripts', createTarball], root)

  runNpm(['exec', '--', 'create-frontron', appName, '--overwrite', 'yes'], root)
  runNpm(['install'], appRoot)
  runNpm(['run', 'typecheck'], appRoot)
}

function runViteCase(frontronTarball) {
  logStep('vite case: existing Vite app -> init -> frontron:build')

  const root = createScratchDir('vite')
  const appName = 'matrix-vite-app'
  const appRoot = join(root, appName)

  runNpm(['create', 'vite@latest', appName, '--', '--template', 'react-ts'], root)
  runNpm(['install'], appRoot)
  runNpm(['install', '--ignore-scripts', frontronTarball], appRoot)
  runNpm(['install'], appRoot)

  runNpm(['exec', '--', 'frontron', 'init', '--yes'], appRoot)
  runNpm(['install'], appRoot)
  runNpm(['run', 'frontron:build'], appRoot)
}

function runVitePressCase(frontronTarball) {
  logStep('vitepress case: existing docs app -> init -> frontron:build')

  const appRoot = createScratchDir('vitepress')

  createVitePressProject(appRoot)
  runNpm(['install', '--ignore-scripts', 'vitepress', frontronTarball], appRoot)
  runNpm(['install'], appRoot)

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
  runNpm(['install'], appRoot)
  runNpm(['run', 'frontron:build'], appRoot)
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

  if (!['all', 'starter', 'vite', 'vitepress'].includes(selectedCase)) {
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
