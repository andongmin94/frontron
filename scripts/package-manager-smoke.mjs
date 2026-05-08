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
    timeout: 180_000,
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function installedCli(projectRoot, packageName) {
  return join(projectRoot, 'node_modules', packageName, 'index.js')
}

function assertGeneratedScripts(packageJson, manager) {
  for (const script of ['app', 'build', 'typecheck']) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      throw new Error(`${manager} starter did not generate scripts.${script}`)
    }
  }
}

function assertBunTrust(packageJson, label) {
  if (
    !Array.isArray(packageJson.trustedDependencies) ||
    !packageJson.trustedDependencies.includes('electron') ||
    !packageJson.trustedDependencies.includes('electron-winstaller')
  ) {
    throw new Error(`${label} did not trust the Electron install scripts`)
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

  const packageJson = readJson(join(projectRoot, 'package.json'))
  for (const dependency of ['electron', 'electron-builder', 'typescript', '@types/node']) {
    if (typeof packageJson.devDependencies?.[dependency] !== 'string') {
      throw new Error(`pnpm retrofit did not add devDependencies.${dependency}`)
    }
  }
  if (typeof packageJson.scripts?.['frontron:dev'] !== 'string') {
    throw new Error('pnpm retrofit did not add scripts.frontron:dev')
  }
  if (typeof packageJson.scripts?.['frontron:build'] !== 'string') {
    throw new Error('pnpm retrofit did not add scripts.frontron:build')
  }

  const workspaceSource = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')
  if (!/^\s{2}electron:\s*true\s*$/m.test(workspaceSource)) {
    throw new Error('pnpm retrofit did not approve the Electron install script')
  }
  if (!/^\s{2}electron-winstaller:\s*true\s*$/m.test(workspaceSource)) {
    throw new Error('pnpm retrofit did not approve the electron-winstaller install script')
  }

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
  assertGeneratedScripts(readJson(join(appRoot, 'package.json')), 'Yarn')
}

function smokeBun(createTarball, frontronTarball) {
  const runnerRoot = mkdtempSync(join(tmpdir(), 'frontron-bun-generator-'))
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

  const generatedPackage = readJson(join(runnerRoot, 'bun-app', 'package.json'))
  assertBunTrust(generatedPackage, 'Bun starter')
  assertGeneratedScripts(generatedPackage, 'Bun')

  const retrofitRoot = mkdtempSync(join(tmpdir(), 'frontron-bun-retrofit-'))
  temporaryDirectories.push(retrofitRoot)
  writeJson(join(retrofitRoot, 'package.json'), {
    name: 'bun-retrofit-smoke',
    version: '0.0.0',
    private: true,
    packageManager: 'bun@1.3.14',
    scripts: { dev: 'vite', build: 'vite build' },
    devDependencies: {
      'create-frontron': `file:${createTarball}`,
      frontron: `file:${frontronTarball}`,
      vite: '^8.0.1',
    },
  })

  run('bun', ['install', '--ignore-scripts'], retrofitRoot)
  const cli = installedCli(retrofitRoot, 'frontron')
  const userAgent = 'bun/1.3.14 npm/? node/v24 linux x64'
  run(
    process.execPath,
    [cli, 'init', '--yes', '--adapter', 'generic-static', '--out-dir', 'dist'],
    retrofitRoot,
    { npm_config_user_agent: userAgent },
  )

  const initializedPackage = readJson(join(retrofitRoot, 'package.json'))
  assertBunTrust(initializedPackage, 'Bun retrofit')
  run(process.execPath, [cli, 'doctor'], retrofitRoot, {
    npm_config_user_agent: userAgent,
  })
  run(process.execPath, [cli, 'clean', '--yes'], retrofitRoot, {
    npm_config_user_agent: userAgent,
  })

  const cleanedPackage = readJson(join(retrofitRoot, 'package.json'))
  if (Object.hasOwn(cleanedPackage, 'trustedDependencies')) {
    throw new Error('Bun retrofit clean did not restore the original package.json')
  }
}

try {
  const createTarball = pack(createRoot, 'create-frontron-pack-')
  const frontronTarball = pack(frontronRoot, 'frontron-pack-')
  smokePnpm(createTarball, frontronTarball)
  smokeYarn(createTarball)
  smokeBun(createTarball, frontronTarball)
  console.log('[package-manager-smoke] pnpm, Yarn, and Bun manager-specific contracts passed')
} finally {
  for (const directory of temporaryDirectories.reverse()) {
    rmSync(directory, { recursive: true, force: true })
  }
}
