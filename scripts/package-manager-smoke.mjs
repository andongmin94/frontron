import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const createRoot = join(repositoryRoot, 'create-frontron')
const frontronRoot = join(repositoryRoot, 'frontron')
const temporaryDirectories = []
const environment = {
  ...process.env,
  CI: '1',
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
}

function run(command, args, cwd, env = {}) {
  console.log(`[package-manager-smoke] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    env: { ...environment, ...env },
    stdio: 'inherit',
    shell: false,
    timeout: 300_000,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function pack(packageRoot, prefix) {
  const outputDirectory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(outputDirectory)
  const result = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDirectory],
    {
      cwd: packageRoot,
      env: environment,
      encoding: 'utf8',
      shell: false,
      timeout: 120_000,
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'npm pack failed')
  }

  const filename = JSON.parse(result.stdout)[0]?.filename
  if (!filename) throw new Error('npm pack did not report a filename')
  return join(outputDirectory, filename)
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function installedCli(projectRoot, packageName) {
  return join(projectRoot, 'node_modules', packageName, 'index.js')
}

function assertPnpmRetrofitConfig(projectRoot) {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const devDependencies = packageJson.devDependencies ?? {}

  for (const dependency of ['electron', 'electron-builder', 'typescript', '@types/node']) {
    if (typeof devDependencies[dependency] !== 'string') {
      throw new Error(`pnpm retrofit did not add devDependencies.${dependency}`)
    }
  }

  const workspaceSource = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')
  if (!/^\s{2}electron:\s*true\s*$/m.test(workspaceSource)) {
    throw new Error('pnpm retrofit did not approve the Electron install script')
  }
  if (!/^\s{2}electron-winstaller:\s*true\s*$/m.test(workspaceSource)) {
    throw new Error('pnpm retrofit did not approve the electron-winstaller install script')
  }
}

function smokePnpm(createTarball, frontronTarball) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-pnpm-'))
  temporaryDirectories.push(projectRoot)
  writeJson(join(projectRoot, 'package.json'), {
    name: 'pnpm-retrofit-smoke',
    version: '0.0.0',
    private: true,
    packageManager: 'pnpm@11.11.0',
    scripts: { dev: 'vite', build: 'vite build' },
    devDependencies: {
      'create-frontron': `file:${createTarball}`,
      frontron: `file:${frontronTarball}`,
      vite: '^8.0.1',
    },
  })
  writeFileSync(
    join(projectRoot, 'pnpm-workspace.yaml'),
    `overrides:\n  create-frontron: ${JSON.stringify(`file:${createTarball}`)}\n`,
    'utf8',
  )

  run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], projectRoot)
  const cli = installedCli(projectRoot, 'frontron')
  const userAgent = 'pnpm/11.11.0 npm/? node/v24 linux x64'
  run(
    process.execPath,
    [cli, 'init', '--yes', '--adapter', 'generic-static', '--out-dir', 'dist'],
    projectRoot,
    { npm_config_user_agent: userAgent },
  )
  assertPnpmRetrofitConfig(projectRoot)
  run(process.execPath, [cli, 'doctor'], projectRoot, {
    npm_config_user_agent: userAgent,
  })
  run(process.execPath, [cli, 'clean', '--yes'], projectRoot, {
    npm_config_user_agent: userAgent,
  })
}

function smokeYarn(createTarball) {
  const runnerRoot = mkdtempSync(join(tmpdir(), 'frontron-yarn-'))
  temporaryDirectories.push(runnerRoot)
  writeJson(join(runnerRoot, 'package.json'), {
    name: 'yarn-generator-smoke',
    version: '0.0.0',
    private: true,
    packageManager: 'yarn@4.9.2',
    devDependencies: { 'create-frontron': `file:${createTarball}` },
  })
  writeFileSync(join(runnerRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n', 'utf8')
  const yarnEnvironment = { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' }

  run('yarn', ['install', '--mode=skip-build'], runnerRoot, yarnEnvironment)
  run(
    process.execPath,
    [installedCli(runnerRoot, 'create-frontron'), 'yarn-app'],
    runnerRoot,
    {
      ...yarnEnvironment,
      npm_config_user_agent: 'yarn/4.9.2 npm/? node/v24 linux x64',
    },
  )

  const appRoot = join(runnerRoot, 'yarn-app')
  if (readFileSync(join(appRoot, '.yarnrc.yml'), 'utf8').trim() !== 'nodeLinker: node-modules') {
    throw new Error('Yarn node-modules linker configuration was not generated')
  }
  run('yarn', ['install', '--mode=skip-build'], appRoot, yarnEnvironment)
  run('yarn', ['typecheck'], appRoot, yarnEnvironment)
}

function smokeBun(createTarball) {
  const runnerRoot = mkdtempSync(join(tmpdir(), 'frontron-bun-'))
  temporaryDirectories.push(runnerRoot)
  writeJson(join(runnerRoot, 'package.json'), {
    name: 'bun-generator-smoke',
    version: '0.0.0',
    private: true,
    packageManager: 'bun@1.3.14',
    devDependencies: { 'create-frontron': `file:${createTarball}` },
  })

  run('bun', ['install', '--ignore-scripts'], runnerRoot)
  run(
    process.execPath,
    [installedCli(runnerRoot, 'create-frontron'), 'bun-app'],
    runnerRoot,
    { npm_config_user_agent: 'bun/1.3.14 npm/? node/v24 linux x64' },
  )

  const appRoot = join(runnerRoot, 'bun-app')
  run('bun', ['install', '--ignore-scripts'], appRoot)
  run('bun', ['run', 'typecheck'], appRoot)
}

try {
  const createTarball = pack(createRoot, 'create-frontron-pack-')
  const frontronTarball = pack(frontronRoot, 'frontron-pack-')
  smokePnpm(createTarball, frontronTarball)
  smokeYarn(createTarball)
  smokeBun(createTarball)
  console.log('[package-manager-smoke] pnpm, Yarn, and Bun consumers passed')
} finally {
  for (const directory of temporaryDirectories.reverse()) {
    rmSync(directory, { recursive: true, force: true })
  }
}
