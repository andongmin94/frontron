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

    if (argument === '--overwrite' || argument.startsWith('--overwrite=')) {
      throw new Error('The --overwrite option was removed. Choose a new target directory.')
    }

    if (argument === '--template' || argument === '-t' || argument.startsWith('--template=')) {
      throw new Error(
        'Template selection has been removed. create-frontron generates the React template.',
      )
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

function packageManagerFromUserAgent(userAgent: string | undefined) {
  return userAgent?.split(' ')[0]?.split('/')[0] || 'npm'
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

  console.log(`\nScaffolding project in ${root}...`)
  scaffoldProject(templateDir, root, packageJson)
  printNextSteps(cwd, root, packageManagerFromUserAgent(process.env.npm_config_user_agent))
}
