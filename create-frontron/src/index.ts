import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveTargetRoot, scaffoldProject } from './scaffold'

type CliArguments = {
  help: boolean
  targetDir?: string
}

type TemplatePackage = {
  name: string
  productName?: string
  trustedDependencies?: string[]
  overrides?: Record<string, unknown>
  resolutions?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
  }
}

const defaultTargetDir = 'desktop-app'
const templateDirectoryName = 'template'

function parseArguments(args: string[]): CliArguments {
  let help = false
  let targetDir: string | undefined

  for (const argument of args) {
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`)
    }

    if (targetDir !== undefined) {
      throw new Error(`Unexpected positional argument: "${argument}"`)
    }

    targetDir = argument
  }

  return { help, targetDir }
}

function printHelp() {
  console.log(`Usage: create-frontron [project-name]

Scaffold the default Electron + React + Vite starter in a new directory.

Arguments:
  project-name  Target directory. Defaults to "${defaultTargetDir}".

Options:
  --help, -h    Print this help message.

Examples:
  npm create frontron@latest my-app
  npx create-frontron@latest my-app
`)
}

function templateDirRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function formatTargetDir(targetDir: string | undefined) {
  if (targetDir === undefined) return undefined

  const trimmed = targetDir.trim()

  if (path.parse(trimmed).root === trimmed) {
    return trimmed
  }

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/g, '')
  return withoutTrailingSeparators || trimmed
}

function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(projectName)
}

function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

function toDefaultAppId(projectName: string) {
  const slug = toValidPackageName(projectName).replace(/^@/, '').replace(/\//g, '-')
  return `com.example.${slug || defaultTargetDir}`
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

function packageManagerFromUserAgent(userAgent: string | undefined): PackageManager {
  const name = userAgent?.split(' ')[0]?.split('/')[0]
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm'
}

// 템플릿 package.json의 npm override가 electron-builder 하위 취약 minimatch를 교체한다.
// pnpm·Yarn은 같은 범위를 각자의 문법으로 표현하고, 중첩·범위 override를 지원하지 않는
// Bun에는 minimatch 3.x·5.x 소비자를 깨뜨리지 않도록 아무 override도 넣지 않는다.
// frontron/src/init/npm-builder-override.ts의 키와 같은 값을 유지해야 한다.
const NPM_MINIMATCH_OVERRIDE_KEY = 'minimatch@>=9 <12'
const PNPM_MINIMATCH_OVERRIDE_KEYS = [
  'app-builder-lib>minimatch@>=9 <12',
  '@electron/universal>minimatch@>=9 <12',
]
const YARN_MINIMATCH_RESOLUTION_KEYS = [
  'app-builder-lib/minimatch',
  '@electron/universal/minimatch',
]

function readTemplateMinimatchOverride(packageJson: TemplatePackage) {
  const builder = packageJson.overrides?.['electron-builder']
  const value =
    builder && typeof builder === 'object'
      ? (builder as Record<string, unknown>)[NPM_MINIMATCH_OVERRIDE_KEY]
      : undefined
  return typeof value === 'string' ? value : undefined
}

// applyPackageManagerOverrides 함수는 npm 전용 overrides를 패키지 매니저별 형식으로 바꾼다.
function applyPackageManagerOverrides(
  packageJson: TemplatePackage,
  packageManager: PackageManager,
) {
  const minimatch = readTemplateMinimatchOverride(packageJson)
  if (packageManager === 'npm') return minimatch

  delete packageJson.overrides
  if (packageManager === 'yarn' && minimatch) {
    packageJson.resolutions = Object.fromEntries(
      YARN_MINIMATCH_RESOLUTION_KEYS.map((key) => [key, minimatch]),
    )
  }
  return minimatch
}

function createPackageManagerFiles(packageManager: PackageManager, minimatch: string | undefined) {
  if (packageManager === 'pnpm') {
    const overrides = minimatch
      ? `overrides:\n${PNPM_MINIMATCH_OVERRIDE_KEYS.map((key) => `  "${key}": "${minimatch}"\n`).join('')}`
      : ''
    return new Map([
      [
        'pnpm-workspace.yaml',
        `allowBuilds:\n  electron: true\n  electron-winstaller: true\n${overrides}`,
      ],
    ])
  }

  if (packageManager === 'yarn') {
    return new Map([['.yarnrc.yml', 'nodeLinker: node-modules\n']])
  }

  return new Map<string, string>()
}

function printNextSteps(cwd: string, root: string, packageManager: string) {
  const relativeRoot = path.relative(cwd, root)

  console.log('\nDone. Now run:\n')
  console.log(`  cd ${relativeRoot.includes(' ') ? `"${relativeRoot}"` : relativeRoot}`)

  if (packageManager === 'yarn') {
    console.log('  yarn')
    console.log('  yarn app')
  } else {
    console.log(`  ${packageManager} install`)
    console.log(`  ${packageManager} run app`)
  }

  console.log()
}

// runCreateFrontron 함수는 입력 검증, 템플릿 메타데이터 치환, 실제 scaffold 순서만 조율한다.
export async function runCreateFrontron(args = process.argv.slice(2)) {
  const argv = parseArguments(args)

  if (argv.help) {
    printHelp()
    return
  }

  const cwd = process.cwd()
  const targetDir = formatTargetDir(argv.targetDir) || defaultTargetDir
  const root = resolveTargetRoot(cwd, targetDir)
  const templateDir = path.join(templateDirRoot(), templateDirectoryName)
  const templatePackagePath = path.join(templateDir, 'package.json')

  if (!fs.existsSync(templatePackagePath)) {
    throw new Error(`Template package was not found: ${templatePackagePath}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(templatePackagePath, 'utf8')) as TemplatePackage
  const projectDisplayName = path.basename(root)
  const normalizedPackageName = toValidPackageName(projectDisplayName) || defaultTargetDir
  const projectPackageName = isValidPackageName(projectDisplayName)
    ? projectDisplayName
    : normalizedPackageName
  const packageManager = packageManagerFromUserAgent(process.env.npm_config_user_agent)

  // 표시 이름과 npm 패키지명은 규칙이 달라 각각 계산해 템플릿 placeholder에 넣는다.
  packageJson.name = projectPackageName

  if (packageJson.productName === '__CREATE_APP_NAME__') {
    packageJson.productName = projectDisplayName
  }

  if (packageJson.build?.productName === '__CREATE_APP_NAME__') {
    packageJson.build.productName = projectDisplayName
  }

  if (packageJson.build?.appId === '__CREATE_APP_ID__') {
    packageJson.build.appId = toDefaultAppId(projectPackageName)
  }

  if (packageManager === 'bun') {
    packageJson.trustedDependencies = ['electron', 'electron-winstaller']
  } else {
    delete packageJson.trustedDependencies
  }

  const minimatchOverride = applyPackageManagerOverrides(packageJson, packageManager)

  console.log(`\nScaffolding project in ${root}...`)
  scaffoldProject(
    templateDir,
    root,
    packageJson,
    createPackageManagerFiles(packageManager, minimatchOverride),
  )
  printNextSteps(cwd, root, packageManager)
}
