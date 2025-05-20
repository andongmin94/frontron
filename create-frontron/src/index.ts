import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import minimist from 'minimist'
import prompts from 'prompts'
import { red, reset } from 'kolorist'

type CliArguments = {
  h?: boolean
  help?: boolean
  overwrite?: string | boolean
  t?: string | boolean
  template?: string | boolean
  _: string[]
}

type CommitMode = 'merge' | 'replace'

type ScaffoldTransactionEntry = {
  identity: string
  targetEntries: string[]
  backupEntries: string[]
}

type MutableScaffoldTransactionEntry = {
  keys: Set<string>
  targetEntries: string[]
  backupEntries: string[]
}

type ScaffoldTransactionJournal = {
  schemaVersion: 1
  pid: number
  transactionId?: string
  root: string
  stagingRoot: string
  backupRoot: string
  mode: CommitMode
  rootExisted: boolean
  affectedEntries: string[]
  backedUpEntries: string[]
  entries?: ScaffoldTransactionEntry[]
}

type ValidatedScaffoldTransactionJournal = ScaffoldTransactionJournal & {
  transactionId: string
  entries: ScaffoldTransactionEntry[]
}

type ScaffoldTransactionLockRecord = {
  schemaVersion: 1
  pid: number
  token: string
  root: string
  createdAt: string
}

type ScaffoldTransactionLockOwnership = {
  lockPath: string
  root: string
  token: string
}

type ScaffoldTransactionLockSnapshot = {
  raw: string
  record: Partial<ScaffoldTransactionLockRecord> | null
  dev: bigint
  ino: bigint
  size: bigint
  mtimeMs: bigint
}

export type ScaffoldCommitHooks = {
  afterBackupEntry?(entryName: string, entryIndex: number): void
  afterEntry?(entryName: string, entryIndex: number): void
}

const renameFiles: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
}

const defaultTargetDir = 'desktop-app'
const TEMPLATE_DIR = 'template'
const ignoredTemplateEntries = new Set(['dist', 'node_modules', 'output', '.git', '.npmignore'])

// parseArguments 함수는 프로젝트 이름이 숫자로 자동 변환되지 않도록 CLI 인자를 문자열로 파싱한다.
function parseArguments(args: string[]) {
  return minimist<CliArguments>(args, {
    boolean: ['h', 'help'],
    string: ['_', 'overwrite'],
  })
}

// printHelp 함수는 create-frontron의 사용법과 지원 옵션을 출력한다.
function printHelp() {
  console.log(`Usage: create-frontron [project-name] [options]

Scaffold the default Electron + React + Vite starter.

Arguments:
  project-name                 Target directory. Defaults to "${defaultTargetDir}".

Options:
  --overwrite <yes|no|ignore>  Choose how to handle a non-empty target directory.
  --help, -h                   Print this help message.

Examples:
  npm create frontron@latest my-app
  npx create-frontron@latest my-app
`)
}

// ensureRemovedTemplateOption 함수는 제거된 template 선택 옵션을 명확한 오류로 차단한다.
function ensureRemovedTemplateOption(
  template: string | boolean | undefined,
  alias: string | boolean | undefined,
) {
  if (typeof template === 'undefined' && typeof alias === 'undefined') {
    return
  }

  throw new Error(
    red('x') +
      ' Template selection has been removed. create-frontron now generates the React template by default.',
  )
}

// ensureOverwriteOption 함수는 자동화에서 오타 난 덮어쓰기 값이 병합으로 처리되지 않게 막는다.
function ensureOverwriteOption(overwrite: string | boolean | undefined) {
  if (
    typeof overwrite === 'undefined' ||
    overwrite === 'yes' ||
    overwrite === 'no' ||
    overwrite === 'ignore'
  ) {
    return
  }

  throw new Error('--overwrite must be one of "yes", "no", or "ignore".')
}

// runCreateFrontron 함수는 입력을 수집하고 완성된 템플릿을 대상 폴더에 트랜잭션으로 적용한다.
export async function runCreateFrontron(args = process.argv.slice(2)) {
  const argv = parseArguments(args)
  const cwd = process.cwd()

  if (argv.help || argv.h) {
    printHelp()
    return
  }

  const argTargetDir = formatTargetDir(argv._[0])
  ensureRemovedTemplateOption(argv.template, argv.t)
  ensureOverwriteOption(argv.overwrite)

  let targetDir = argTargetDir || defaultTargetDir
  // getProjectName 함수는 현재 대상 경로의 마지막 이름을 제품명 기본값으로 사용한다.
  const getProjectName = () => path.basename(path.resolve(targetDir))
  const initialTargetRoot = resolveTargetRoot(cwd, targetDir)

  if (recoverScaffoldTransaction(initialTargetRoot)) {
    console.log(`Recovered an interrupted create-frontron transaction in ${initialTargetRoot}.`)
  }

  let result: prompts.Answers<'projectName' | 'overwrite' | 'packageName'>

  prompts.override({
    overwrite: argv.overwrite,
  })

  try {
    result = await prompts(
      [
        {
          type: argTargetDir ? null : 'text',
          name: 'projectName',
          message: reset('Project name:'),
          initial: defaultTargetDir,
          onState: (state) => {
            targetDir = formatTargetDir(state.value) || defaultTargetDir
          },
        },
        {
          type: () => (!fs.existsSync(targetDir) || isEmpty(targetDir) ? null : 'select'),
          name: 'overwrite',
          message: () =>
            (targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`) +
            ' is not empty. Please choose how to proceed:',
          initial: 0,
          choices: [
            {
              title: 'Remove existing files and continue',
              value: 'yes',
            },
            {
              title: 'Cancel operation',
              value: 'no',
            },
            {
              title: 'Ignore files and continue',
              value: 'ignore',
            },
          ],
        },
        {
          type: (_, { overwrite }: { overwrite?: string }) => {
            if (overwrite === 'no') {
              throw new Error(red('x') + ' Operation cancelled')
            }
            return null
          },
          name: 'overwriteChecker',
        },
        {
          type: () => (isValidPackageName(getProjectName()) ? null : 'text'),
          name: 'packageName',
          message: reset('Package name:'),
          initial: () => toValidPackageName(getProjectName()),
          validate: (dir) => isValidPackageName(dir) || 'Invalid package.json name',
        },
      ],
      {
        onCancel: () => {
          throw new Error(red('x') + ' Operation cancelled')
        },
      },
    )
  } catch (cancelled: any) {
    console.log(cancelled.message)
    return
  }

  // 프롬프트 결과는 이후 파일 작업에 필요한 값만 꺼내 사용한다.
  const { overwrite, packageName } = result

  const root = resolveTargetRoot(cwd, targetDir)

  if (recoverScaffoldTransaction(root)) {
    console.log(`Recovered an interrupted create-frontron transaction in ${root}.`)
  }

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'

  console.log(`\nScaffolding project in ${root}...`)

  const templateDir = path.join(templateDirRoot(), TEMPLATE_DIR)

  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory not found: "${TEMPLATE_DIR}"`)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'))

  const projectDisplayName = getProjectName()
  const projectPackageName = packageName || getProjectName()

  pkg.name = projectPackageName

  if (pkg.productName === '__CREATE_APP_NAME__') {
    pkg.productName = projectDisplayName
  }

  if (pkg.build?.productName === '__CREATE_APP_NAME__') {
    pkg.build.productName = projectDisplayName
  }

  if (pkg.build?.appId === '__CREATE_APP_ID__') {
    pkg.build.appId = toDefaultAppId(projectPackageName)
  }

  const stagingRoot = createTransactionDirectory(root, 'staging')

  try {
    stageTemplateProject(templateDir, stagingRoot, pkg)
    applyStagedProject(stagingRoot, root, overwrite === 'yes' ? 'replace' : 'merge')
  } finally {
    removePath(stagingRoot)
  }

  const cdProjectName = path.relative(cwd, root)
  console.log(`\nDone. Now run:\n`)
  if (root !== cwd) {
    console.log(`  cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`)
  }
  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn')
      console.log('  yarn app')
      break
    default:
      console.log(`  ${pkgManager} install`)
      console.log(`  ${pkgManager} run app`)
      break
  }
  console.log()
}

// templateDirRoot 함수는 빌드된 CLI 위치를 기준으로 배포된 template 폴더의 부모를 찾는다.
function templateDirRoot() {
  return path.resolve(fileURLToPath(import.meta.url), '../..')
}

// formatTargetDir 함수는 대상 경로의 공백과 끝쪽 경로 구분자를 정리한다.
function formatTargetDir(targetDir: string | undefined) {
  return targetDir?.trim().replace(/[\\/]+$/g, '')
}

// resolveTargetRoot 함수는 실제 현재 디렉터리를 기준으로 대상 경로를 확정하고 파일시스템 루트는 차단한다.
function resolveTargetRoot(cwd: string, targetDir: string) {
  const canonicalCwd = fs.realpathSync(cwd)
  const root = path.resolve(canonicalCwd, targetDir)

  if (root === path.parse(root).root) {
    throw new Error('The project target cannot be a filesystem root.')
  }

  assertNoSymlinkAncestors(root)
  return canonicalizeTargetRoot(root)
}

// lstatIfExists 함수는 깨진 심볼릭 링크도 존재하는 디렉터리 엔트리로 판정한다.
function lstatIfExists(targetPath: string) {
  try {
    return fs.lstatSync(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// lstatBigIntIfExists 함수는 Windows의 큰 파일 ID를 반올림 없이 읽어 identity 충돌을 막는다.
function lstatBigIntIfExists(targetPath: string) {
  try {
    return fs.lstatSync(targetPath, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// pathEntryExists 함수는 링크 대상이 없어도 링크 자체가 있으면 true를 반환한다.
function pathEntryExists(targetPath: string) {
  return lstatIfExists(targetPath) !== null
}

// normalizeIdentityText 함수는 Windows와 기본 macOS의 대소문자 및 유니코드 alias를 한 identity로 만든다.
function normalizeIdentityText(value: string) {
  const normalized = value.normalize('NFC')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLowerCase()
    : normalized
}

// canonicalizeTargetRoot 함수는 가장 가까운 기존 부모의 실제 경로를 기준으로 target alias를 정규화한다.
function canonicalizeTargetRoot(targetRoot: string) {
  const absoluteRoot = path.resolve(targetRoot)
  const missingParts: string[] = []
  let existingPath = absoluteRoot

  while (!pathEntryExists(existingPath)) {
    const parent = path.dirname(existingPath)

    if (parent === existingPath) break
    missingParts.unshift(path.basename(existingPath))
    existingPath = parent
  }

  const canonicalParent = fs.realpathSync.native(existingPath)
  return path.resolve(canonicalParent, ...missingParts)
}

// normalizedPathIdentity 함수는 아직 생성되지 않은 경로도 플랫폼의 기본 identity 규칙으로 비교한다.
function normalizedPathIdentity(targetPath: string) {
  return normalizeIdentityText(path.normalize(path.resolve(targetPath)))
}

// pathsShareIdentity 함수는 실제 파일 identity 또는 정규 경로 identity가 같은지 확인한다.
function pathsShareIdentity(firstPath: string, secondPath: string) {
  if (normalizedPathIdentity(firstPath) === normalizedPathIdentity(secondPath)) return true

  const firstStats = lstatBigIntIfExists(firstPath)
  const secondStats = lstatBigIntIfExists(secondPath)

  if (!firstStats || !secondStats || firstStats.ino === 0n || secondStats.ino === 0n) {
    return false
  }

  const knownDeviceMatches = firstStats.dev !== 0n && firstStats.dev === secondStats.dev
  const unknownWindowsDeviceMatches =
    process.platform === 'win32' &&
    firstStats.dev === 0n &&
    secondStats.dev === 0n &&
    normalizeIdentityText(path.parse(path.resolve(firstPath)).root) ===
      normalizeIdentityText(path.parse(path.resolve(secondPath)).root)

  return firstStats.ino === secondStats.ino && (knownDeviceMatches || unknownWindowsDeviceMatches)
}

// assertNoSymlinkAncestors 함수는 대상 경로의 기존 부모가 심볼릭 링크나 정션인지 확인한다.
function assertNoSymlinkAncestors(targetPath: string) {
  const parsed = path.parse(path.resolve(targetPath))
  const relativeParts = path.relative(parsed.root, path.resolve(targetPath)).split(path.sep)
  let current = parsed.root

  for (const part of relativeParts) {
    if (!part) continue
    current = path.join(current, part)

    const stats = lstatIfExists(current)

    if (stats?.isSymbolicLink()) {
      throw new Error(`Target path must not pass through a symbolic link: ${current}`)
    }
  }
}

// assertSafeDestination 함수는 병합 중 쓸 경로가 대상 루트 안에 있고 링크를 통과하지 않는지 재검사한다.
function assertSafeDestination(root: string, targetPath: string, allowFinalLink = false) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(targetPath)
  const relativePath = path.relative(resolvedRoot, resolvedTarget)

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Scaffold destination escaped the target directory: ${targetPath}`)
  }

  let current = resolvedRoot

  const parts = relativePath.split(path.sep).filter(Boolean)

  for (const [partIndex, part] of parts.entries()) {
    if (!part) continue
    current = path.join(current, part)
    const stats = lstatIfExists(current)

    if (stats?.isSymbolicLink() && !(allowFinalLink && partIndex === parts.length - 1)) {
      throw new Error(`Scaffold destination must not pass through a symbolic link: ${current}`)
    }
  }
}

// copyTemplatePath 함수는 템플릿 파일을 복사하되 패키지 밖을 가리킬 수 있는 링크는 거부한다.
function copyTemplatePath(src: string, dest: string, destinationRoot: string) {
  const stat = fs.lstatSync(src)

  if (stat.isSymbolicLink()) {
    throw new Error(`Template entries must not be symbolic links: ${src}`)
  }

  const destinationStats = lstatIfExists(dest)

  if (destinationStats?.isSymbolicLink()) {
    if (fs.existsSync(dest)) {
      throw new Error(`Scaffold destination must not pass through a symbolic link: ${dest}`)
    }

    removePath(dest)
  }

  assertSafeDestination(destinationRoot, dest)

  if (stat.isDirectory()) {
    copyTemplateDirectory(src, dest, destinationRoot)
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

// isValidPackageName 함수는 npm package.json에서 허용하는 보수적인 패키지 이름인지 검사한다.
function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(projectName)
}

// toValidPackageName 함수는 사용자가 입력한 이름을 npm 패키지 이름으로 정규화한다.
function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

// toDefaultAppId 함수는 패키지 이름을 Electron 기본 appId로 변환한다.
function toDefaultAppId(projectName: string) {
  const slug = toValidPackageName(projectName).replace(/^@/, '').replace(/\//g, '-')

  return `com.example.${slug || 'desktop-app'}`
}

// copyTemplateDirectory 함수는 링크를 허용하지 않는 템플릿 복사 규칙으로 디렉터리를 재귀 복사한다.
function copyTemplateDirectory(srcDir: string, destDir: string, destinationRoot: string) {
  const files = fs.readdirSync(srcDir)

  fs.mkdirSync(destDir, { recursive: true })
  for (const file of files) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, file)
    copyTemplatePath(srcFile, destFile, destinationRoot)
  }
}

// stageTemplateProject 함수는 대상 폴더를 건드리기 전에 임시 폴더에서 완성된 프로젝트를 만든다.
function stageTemplateProject(templateDir: string, stagingRoot: string, packageJson: unknown) {
  const files = fs
    .readdirSync(templateDir)
    .filter((file) => file !== 'package.json' && !ignoredTemplateEntries.has(file))

  for (const file of files) {
    const targetName = renameFiles[file] ?? file
    copyTemplatePath(path.join(templateDir, file), path.join(stagingRoot, targetName), stagingRoot)
  }

  fs.writeFileSync(
    path.join(stagingRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  )
}

// isEmpty 함수는 대상 디렉터리가 비었거나 Git 메타데이터만 있는지 확인한다.
function isEmpty(dirPath: string) {
  const files = fs.readdirSync(dirPath)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

const transactionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const lockWaitTimeoutMs = 5_000

// transactionBaseName 함수는 target alias가 동일한 잠금과 저널 이름을 사용하도록 basename을 정규화한다.
function transactionBaseName(root: string) {
  const sanitized = path.basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  return normalizeIdentityText(sanitized)
}

// getTransactionDirectoryPath 함수는 transaction ID와 정확히 결합된 staging 또는 backup 경로를 만든다.
function getTransactionDirectoryPath(
  root: string,
  purpose: 'staging' | 'backup',
  transactionId: string,
) {
  return path.join(
    path.dirname(root),
    `.${transactionBaseName(root)}.frontron-${purpose}-${transactionId}`,
  )
}

// createTransactionId 함수는 경로와 저널에서 함께 검증할 충돌 가능성이 낮은 transaction ID를 만든다.
function createTransactionId() {
  return randomUUID().replace(/-/g, '')
}

// parseTransactionDirectoryId 함수는 target 옆의 정확한 소유 경로에서 transaction ID만 추출한다.
function parseTransactionDirectoryId(
  root: string,
  candidate: string,
  purpose: 'staging' | 'backup',
) {
  if (!pathsShareIdentity(path.dirname(root), path.dirname(candidate))) return null

  const prefix = `.${transactionBaseName(root)}.frontron-${purpose}-`
  const candidateName = path.basename(candidate)
  const normalizedName = normalizeIdentityText(candidateName)
  const normalizedPrefix = normalizeIdentityText(prefix)

  if (!normalizedName.startsWith(normalizedPrefix)) return null

  const transactionId = candidateName.slice(prefix.length)
  return transactionIdPattern.test(transactionId) ? transactionId : null
}

// createTransactionDirectory 함수는 transaction ID가 포함된 정확한 경로 하나만 생성하고 부모를 동기화한다.
function createTransactionDirectory(
  root: string,
  purpose: 'staging' | 'backup',
  transactionId = createTransactionId(),
) {
  const parent = path.dirname(root)
  const transactionRoot = getTransactionDirectoryPath(root, purpose, transactionId)
  let created = false

  fs.mkdirSync(parent, { recursive: true })

  try {
    fs.mkdirSync(transactionRoot, { mode: 0o700 })
    created = true
    syncDirectory(parent)
    return transactionRoot
  } catch (error) {
    if (created) removePath(transactionRoot)
    throw error
  }
}

// prepareTransactionStaging 함수는 임의 staging을 transaction ID 소유 경로로 원자 이동한다.
function prepareTransactionStaging(stagingRoot: string, root: string) {
  const resolvedStagingRoot = path.resolve(stagingRoot)
  const stats = lstatIfExists(resolvedStagingRoot)

  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Scaffold staging directory must be a real directory: ${resolvedStagingRoot}`)
  }

  if (pathsShareIdentity(resolvedStagingRoot, root)) {
    throw new Error('Scaffold staging directory must differ from the target project.')
  }

  const transactionId =
    parseTransactionDirectoryId(root, resolvedStagingRoot, 'staging') ?? createTransactionId()
  const ownedStagingRoot = getTransactionDirectoryPath(root, 'staging', transactionId)

  if (pathsShareIdentity(resolvedStagingRoot, ownedStagingRoot)) {
    return { stagingRoot: ownedStagingRoot, transactionId }
  }

  if (pathEntryExists(ownedStagingRoot)) {
    throw new Error(`Scaffold staging directory already exists: ${ownedStagingRoot}`)
  }

  fs.renameSync(resolvedStagingRoot, ownedStagingRoot)
  syncDirectory(path.dirname(resolvedStagingRoot))

  if (!pathsShareIdentity(path.dirname(resolvedStagingRoot), path.dirname(ownedStagingRoot))) {
    syncDirectory(path.dirname(ownedStagingRoot))
  }

  return { stagingRoot: ownedStagingRoot, transactionId }
}

// removePath 함수는 Windows의 짧은 파일 잠금도 재시도하며 정확히 지정된 경로만 정리한다.
function removePath(targetPath: string) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}

// isUnsupportedDirectorySyncError 함수는 디렉터리 fsync 자체를 지원하지 않는 오류만 구분한다.
function isUnsupportedDirectorySyncError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code

  if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(code ?? '')) return true
  return process.platform === 'win32' && ['EACCES', 'EPERM', 'EBADF'].includes(code ?? '')
}

// syncDirectory 함수는 지원되는 파일시스템에서 디렉터리 엔트리를 동기화하고 I/O 오류는 전파한다.
function syncDirectory(directoryPath: string) {
  let descriptor: number | null = null

  try {
    descriptor = fs.openSync(directoryPath, 'r')
    fs.fsyncSync(descriptor)
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) throw error
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
  }
}

// syncRegularFile 함수는 Windows 읽기 전용 flush 미지원만 제외하고 일반 파일 fsync 오류를 전파한다.
function syncRegularFile(filePath: string) {
  let descriptor: number | null = null

  try {
    descriptor = fs.openSync(filePath, 'r+')
    fs.fsyncSync(descriptor)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code

    if (process.platform !== 'win32' || !['EACCES', 'EPERM'].includes(code ?? '')) throw error
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
  }
}

// syncPathTree 함수는 링크를 따라가지 않고 파일과 생성된 디렉터리를 아래에서 위로 동기화한다.
function syncPathTree(targetPath: string) {
  const stats = lstatIfExists(targetPath)

  if (!stats) return

  if (stats.isSymbolicLink()) {
    syncDirectory(path.dirname(targetPath))
    return
  }

  if (stats.isFile()) {
    syncRegularFile(targetPath)
    syncDirectory(path.dirname(targetPath))
    return
  }

  if (!stats.isDirectory()) return

  for (const entryName of fs.readdirSync(targetPath)) {
    syncPathTree(path.join(targetPath, entryName))
  }

  syncDirectory(targetPath)
}

// uniqueEntryNames 함수는 case-only alias를 하나의 디렉터리 엔트리 이름으로 합친다.
function uniqueEntryNames(entryNames: string[]) {
  const seen = new Set<string>()
  const uniqueNames: string[] = []

  for (const entryName of entryNames) {
    const identity = normalizeIdentityText(entryName)

    if (seen.has(identity)) continue
    seen.add(identity)
    uniqueNames.push(entryName)
  }

  return uniqueNames
}

// syncTransactionEntries 함수는 변경된 엔트리와 삭제를 담은 root 및 그 부모까지 저널 제거 전에 동기화한다.
function syncTransactionEntries(root: string, entryNames: string[]) {
  for (const entryName of uniqueEntryNames(entryNames)) {
    syncPathTree(path.join(root, entryName))
  }

  const rootStats = lstatIfExists(root)

  if (rootStats?.isDirectory() && !rootStats.isSymbolicLink()) syncDirectory(root)
  syncDirectory(path.dirname(root))
}

// removePathAndSyncParent 함수는 디렉터리 엔트리를 지운 뒤 그 삭제를 부모 디렉터리에 확정한다.
function removePathAndSyncParent(targetPath: string) {
  if (!pathEntryExists(targetPath)) return
  removePath(targetPath)
  syncDirectory(path.dirname(targetPath))
}

// copyExistingPath 함수는 rollback 백업을 위해 파일, 폴더, 깨진 링크를 링크 자체로 복사한다.
function copyExistingPath(source: string, destination: string) {
  const stats = fs.lstatSync(source)

  if (stats.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(source)
    fs.mkdirSync(path.dirname(destination), { recursive: true })

    if (process.platform === 'win32') {
      try {
        fs.symlinkSync(linkTarget, destination, 'file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM' || !path.isAbsolute(linkTarget)) {
          throw error
        }

        fs.symlinkSync(linkTarget, destination, 'junction')
      }
    } else {
      fs.symlinkSync(linkTarget, destination)
    }

    return
  }

  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  })
}

// getScaffoldTransactionPaths 함수는 정규 target이 사용하는 저널과 원자 잠금 경로를 정한다.
function getScaffoldTransactionPaths(root: string) {
  const prefix = path.join(path.dirname(root), `.${transactionBaseName(root)}.frontron-transaction`)

  return {
    journalPath: `${prefix}.json`,
    lockPath: `${prefix}.lock`,
    temporaryPrefix: `${prefix}.tmp-`,
  }
}

// getFileIdentity 함수는 정밀 장치와 inode로 링크 자체를 포함한 실제 파일 identity를 만든다.
function getFileIdentity(targetPath: string) {
  const stats = lstatBigIntIfExists(targetPath)

  if (!stats || (stats.dev === 0n && stats.ino === 0n)) return null
  return `${stats.dev}:${stats.ino}`
}

// getEntryIdentityKeys 함수는 이름 정규 identity와 존재 시 실제 파일 identity를 함께 반환한다.
function getEntryIdentityKeys(directory: string, entryName: string) {
  const keys = new Set([`name:${normalizeIdentityText(entryName)}`])
  const fileIdentity = getFileIdentity(path.join(directory, entryName))

  if (fileIdentity) keys.add(`file:${fileIdentity}`)
  return keys
}

// addUniqueEntryNames 함수는 한 identity 안에서 같은 case-only 이름을 중복 기록하지 않는다.
function addUniqueEntryNames(target: string[], additions: string[]) {
  for (const addition of additions) {
    if (
      !target.some(
        (existingEntry) => normalizeIdentityText(existingEntry) === normalizeIdentityText(addition),
      )
    ) {
      target.push(addition)
    }
  }
}

// addTransactionEntryCandidate 함수는 실제 또는 정규 identity가 겹치는 엔트리를 한 복구 단위로 합친다.
function addTransactionEntryCandidate(
  groups: MutableScaffoldTransactionEntry[],
  root: string,
  targetEntries: string[],
  backupEntries: string[],
) {
  const keys = new Set<string>()

  for (const entryName of [...targetEntries, ...backupEntries]) {
    for (const key of getEntryIdentityKeys(root, entryName)) keys.add(key)
  }

  const matchingGroups = groups.filter((group) => [...group.keys].some((key) => keys.has(key)))
  const destinationGroup = matchingGroups.shift() ?? {
    keys: new Set<string>(),
    targetEntries: [],
    backupEntries: [],
  }

  for (const key of keys) destinationGroup.keys.add(key)
  addUniqueEntryNames(destinationGroup.targetEntries, targetEntries)
  addUniqueEntryNames(destinationGroup.backupEntries, backupEntries)

  for (const matchingGroup of matchingGroups) {
    for (const key of matchingGroup.keys) destinationGroup.keys.add(key)
    addUniqueEntryNames(destinationGroup.targetEntries, matchingGroup.targetEntries)
    addUniqueEntryNames(destinationGroup.backupEntries, matchingGroup.backupEntries)
    groups.splice(groups.indexOf(matchingGroup), 1)
  }

  if (!groups.includes(destinationGroup)) groups.push(destinationGroup)
}

// finalizeTransactionEntries 함수는 내부 identity 집합을 영속 저널 형식으로 바꾼다.
function finalizeTransactionEntries(groups: MutableScaffoldTransactionEntry[]) {
  return groups.map<ScaffoldTransactionEntry>((group, entryIndex) => ({
    identity: [...group.keys].sort()[0] ?? `entry:${entryIndex}`,
    targetEntries: group.targetEntries,
    backupEntries: group.backupEntries,
  }))
}

// findExistingEntryName 함수는 case-only 이름과 실제 파일 identity로 기존 엔트리의 원래 이름을 찾는다.
function findExistingEntryName(root: string, entryNames: string[], requestedName: string) {
  const normalizedName = normalizeIdentityText(requestedName)
  const nameMatch = entryNames.find(
    (entryName) => normalizeIdentityText(entryName) === normalizedName,
  )

  if (nameMatch) return nameMatch

  const requestedIdentity = getFileIdentity(path.join(root, requestedName))
  return requestedIdentity
    ? entryNames.find(
        (entryName) => getFileIdentity(path.join(root, entryName)) === requestedIdentity,
      )
    : undefined
}

// buildTransactionEntries 함수는 commit mode별 대상과 원본 이름을 identity 기준 복구 단위로 만든다.
function buildTransactionEntries(
  root: string,
  stagedEntries: string[],
  previousEntries: string[],
  mode: CommitMode,
) {
  const groups: MutableScaffoldTransactionEntry[] = []

  if (mode === 'replace') {
    for (const previousEntry of previousEntries) {
      addTransactionEntryCandidate(groups, root, [previousEntry], [previousEntry])
    }
  }

  for (const stagedEntry of stagedEntries) {
    const previousEntry = findExistingEntryName(root, previousEntries, stagedEntry)
    addTransactionEntryCandidate(
      groups,
      root,
      [stagedEntry],
      mode === 'merge' && previousEntry ? [previousEntry] : [],
    )
  }

  return finalizeTransactionEntries(groups)
}

// isProcessRunning 함수는 남은 잠금 레코드의 프로세스가 아직 실행 중인지 보수적으로 확인한다.
function isProcessRunning(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// sleepSynchronously 함수는 다른 복구 프로세스가 저널을 처리할 짧은 시간을 양보한다.
function sleepSynchronously(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

// readScaffoldTransactionLockSnapshot 함수는 잠금 파일의 내용과 파일 identity를 한 스냅샷으로 읽는다.
function readScaffoldTransactionLockSnapshot(
  lockPath: string,
): ScaffoldTransactionLockSnapshot | null {
  const stats = lstatBigIntIfExists(lockPath)

  if (!stats) return null
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Scaffold transaction lock is not a regular file: ${lockPath}`)
  }

  const raw = fs.readFileSync(lockPath, 'utf8')
  let record: Partial<ScaffoldTransactionLockRecord> | null = null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      record = parsed as Partial<ScaffoldTransactionLockRecord>
    }
  } catch {
    record = null
  }

  return {
    raw,
    record,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

// lockSnapshotsMatch 함수는 stale 판단 뒤 잠금 파일이 교체되지 않았는지 확인한다.
function lockSnapshotsMatch(
  first: ScaffoldTransactionLockSnapshot,
  second: ScaffoldTransactionLockSnapshot,
) {
  return (
    first.raw === second.raw &&
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs
  )
}

// removeMatchingLock 함수는 reclaim hard-link를 선점하고 같은 소유 레코드와 identity일 때만 제거한다.
function removeMatchingLock(lockPath: string, expected: ScaffoldTransactionLockSnapshot) {
  const reclaimIdentity = String(
    expected.record?.token ?? `${expected.dev}-${expected.ino}`,
  ).replace(/[^a-zA-Z0-9_-]+/g, '-')
  const reclaimPath = `${lockPath}.reclaim-${reclaimIdentity}`

  try {
    fs.linkSync(lockPath, reclaimPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code

    if (code === 'ENOENT') return false
    if (code !== 'EEXIST') throw error

    const reclaimStats = lstatIfExists(reclaimPath)

    if (reclaimStats && Date.now() - reclaimStats.mtimeMs > lockWaitTimeoutMs) {
      removePath(reclaimPath)
      syncDirectory(path.dirname(reclaimPath))
    } else {
      sleepSynchronously(5)
    }

    return false
  }

  let removed = false

  try {
    const claimed = readScaffoldTransactionLockSnapshot(reclaimPath)
    const current = readScaffoldTransactionLockSnapshot(lockPath)

    if (
      claimed &&
      current &&
      lockSnapshotsMatch(expected, claimed) &&
      lockSnapshotsMatch(expected, current)
    ) {
      fs.rmSync(lockPath)
      removed = true
    }
  } finally {
    fs.rmSync(reclaimPath, { force: true })
    syncDirectory(path.dirname(reclaimPath))
  }

  return removed
}

// writeDurableLockCandidate 함수는 잠금 후보의 완성된 소유권 레코드를 링크 게시 전에 fsync한다.
function writeDurableLockCandidate(candidatePath: string, record: ScaffoldTransactionLockRecord) {
  let created = false

  try {
    const descriptor = fs.openSync(candidatePath, 'wx', 0o600)
    created = true

    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  } catch (error) {
    if (created) removePath(candidatePath)
    throw error
  }
}

// removePublishedLockAfterFailure 함수는 잠금 게시 후 동기화 실패 시 자기 토큰만 제거한다.
function removePublishedLockAfterFailure(lockPath: string, token: string) {
  const snapshot = readScaffoldTransactionLockSnapshot(lockPath)

  if (snapshot?.record?.token === token) fs.rmSync(lockPath, { force: true })
}

// acquireScaffoldTransactionLock 함수는 완성된 레코드를 hard link로 게시해 빈 잠금 노출 없이 잠근다.
function acquireScaffoldTransactionLock(root: string) {
  const { journalPath, lockPath } = getScaffoldTransactionPaths(root)
  const waitDeadline = Date.now() + lockWaitTimeoutMs
  const waitForActiveRecovery = pathEntryExists(journalPath)

  for (;;) {
    const token = createTransactionId()
    const candidatePath = `${lockPath}.candidate-${token}`
    const record: ScaffoldTransactionLockRecord = {
      schemaVersion: 1,
      pid: process.pid,
      token,
      root,
      createdAt: new Date().toISOString(),
    }

    writeDurableLockCandidate(candidatePath, record)

    try {
      fs.linkSync(candidatePath, lockPath)
    } catch (error) {
      removePath(candidatePath)

      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      const existingLock = readScaffoldTransactionLockSnapshot(lockPath)
      if (!existingLock) continue

      const ownerPid = Number(existingLock.record?.pid)
      const ownerToken = existingLock.record?.token
      const legacySameProcessLock = ownerPid === process.pid && typeof ownerToken !== 'string'

      if (isProcessRunning(ownerPid) && !legacySameProcessLock) {
        if ((waitForActiveRecovery || pathEntryExists(journalPath)) && Date.now() < waitDeadline) {
          sleepSynchronously(25)
          continue
        }

        throw new Error(`Another create-frontron transaction is active for ${root}.`)
      }

      removeMatchingLock(lockPath, existingLock)
      continue
    }

    try {
      removePath(candidatePath)
      syncDirectory(path.dirname(lockPath))
    } catch (error) {
      removePublishedLockAfterFailure(lockPath, token)
      removePath(candidatePath)
      throw error
    }

    return { lockPath, root, token } satisfies ScaffoldTransactionLockOwnership
  }
}

// releaseScaffoldTransactionLock 함수는 자기 토큰 소유권을 제거 직전에 확인한 뒤 잠금을 해제한다.
function releaseScaffoldTransactionLock(ownership: ScaffoldTransactionLockOwnership) {
  const snapshot = readScaffoldTransactionLockSnapshot(ownership.lockPath)

  if (
    !snapshot ||
    snapshot.record?.token !== ownership.token ||
    !pathsShareIdentity(String(snapshot.record.root), ownership.root)
  ) {
    throw new Error(`Lost create-frontron transaction lock ownership for ${ownership.root}.`)
  }

  if (!removeMatchingLock(ownership.lockPath, snapshot)) {
    throw new Error(`Lost create-frontron transaction lock ownership for ${ownership.root}.`)
  }
}

// runWithScaffoldTransactionLock 함수는 작업 오류를 보존하면서 전체 임계 구역 뒤에 잠금을 해제한다.
function runWithScaffoldTransactionLock<T>(root: string, operation: () => T) {
  const ownership = acquireScaffoldTransactionLock(root)
  let operationError: unknown
  let result: T | undefined

  try {
    result = operation()
  } catch (error) {
    operationError = error
  }

  try {
    releaseScaffoldTransactionLock(ownership)
  } catch (error) {
    operationError ??= error
  }

  if (operationError) throw operationError
  return result as T
}

// validateTransactionEntry 함수는 저널 값이 프로젝트 최상위 한 항목만 가리키는지 확인한다.
function validateTransactionEntry(entryName: unknown): entryName is string {
  return (
    typeof entryName === 'string' &&
    entryName.length > 0 &&
    entryName !== '.git' &&
    path.basename(entryName) === entryName &&
    !entryName.includes('/') &&
    !entryName.includes('\\')
  )
}

// validateTransactionEntryGroup 함수는 identity별 저널 엔트리 묶음의 구조를 검사한다.
function validateTransactionEntryGroup(value: unknown): value is ScaffoldTransactionEntry {
  if (!value || typeof value !== 'object') return false

  const entry = value as Partial<ScaffoldTransactionEntry>
  return (
    typeof entry.identity === 'string' &&
    entry.identity.length > 0 &&
    Array.isArray(entry.targetEntries) &&
    entry.targetEntries.length > 0 &&
    entry.targetEntries.every(validateTransactionEntry) &&
    Array.isArray(entry.backupEntries) &&
    entry.backupEntries.every(validateTransactionEntry)
  )
}

// entryNameSetsMatch 함수는 case-only 중복을 제거한 두 저널 이름 집합이 같은지 확인한다.
function entryNameSetsMatch(first: string[], second: string[]) {
  const firstSet = new Set(first.map(normalizeIdentityText))
  const secondSet = new Set(second.map(normalizeIdentityText))

  return firstSet.size === secondSet.size && [...firstSet].every((entry) => secondSet.has(entry))
}

// assertTransactionDirectory 함수는 저널 경로가 transaction ID의 정확한 실제 디렉터리인지 검증한다.
function assertTransactionDirectory(
  root: string,
  candidate: string,
  purpose: 'staging' | 'backup',
  transactionId: string,
) {
  const expectedPath = getTransactionDirectoryPath(root, purpose, transactionId)

  if (normalizedPathIdentity(candidate) !== normalizedPathIdentity(expectedPath)) {
    throw new Error(
      `Scaffold ${purpose} directory must match transaction ${transactionId}: ${candidate}`,
    )
  }

  const stats = lstatIfExists(candidate)

  if (stats && (!stats.isDirectory() || stats.isSymbolicLink())) {
    throw new Error(`Scaffold ${purpose} directory must not be a symbolic link: ${candidate}`)
  }
}

// inferJournalTransactionId 함수는 staging과 backup의 동일한 suffix를 검증해 구형 저널 ID도 복원한다.
function inferJournalTransactionId(
  root: string,
  stagingRoot: string,
  backupRoot: string,
  recordedId: unknown,
) {
  if (
    !pathsShareIdentity(path.dirname(root), path.dirname(stagingRoot)) ||
    !pathsShareIdentity(path.dirname(root), path.dirname(backupRoot))
  ) {
    throw new Error('Scaffold transaction directories must stay beside the target project.')
  }

  const stagingId = parseTransactionDirectoryId(root, stagingRoot, 'staging')
  const backupId = parseTransactionDirectoryId(root, backupRoot, 'backup')
  const transactionId = typeof recordedId === 'string' ? recordedId : stagingId

  if (
    !transactionId ||
    !transactionIdPattern.test(transactionId) ||
    stagingId !== transactionId ||
    backupId !== transactionId
  ) {
    throw new Error(
      'Scaffold transaction journal is invalid: paths do not match one transaction ID.',
    )
  }

  return transactionId
}

// deriveLegacyTransactionEntries 함수는 구형 이름 배열을 identity별 복구 단위로 안전하게 변환한다.
function deriveLegacyTransactionEntries(
  root: string,
  affectedEntries: string[],
  backedUpEntries: string[],
) {
  const groups: MutableScaffoldTransactionEntry[] = []
  const matchedBackups = new Set<number>()

  for (const affectedEntry of affectedEntries) {
    const backupEntries = backedUpEntries.filter((backupEntry, backupIndex) => {
      const matches = normalizeIdentityText(backupEntry) === normalizeIdentityText(affectedEntry)
      if (matches) matchedBackups.add(backupIndex)
      return matches
    })

    addTransactionEntryCandidate(groups, root, [affectedEntry], backupEntries)
  }

  if (matchedBackups.size !== backedUpEntries.length) {
    throw new Error('Scaffold transaction journal is invalid: unaffected backup entry.')
  }

  return finalizeTransactionEntries(groups)
}

// coalesceJournalTransactionEntries 함수는 중복된 case-only 저널 레코드를 identity당 한 묶음으로 만든다.
function coalesceJournalTransactionEntries(root: string, entries: ScaffoldTransactionEntry[]) {
  const groups: MutableScaffoldTransactionEntry[] = []

  for (const entry of entries) {
    addTransactionEntryCandidate(groups, root, entry.targetEntries, entry.backupEntries)
  }

  return finalizeTransactionEntries(groups)
}

// readScaffoldTransactionJournal 함수는 잠금 아래에서 ID, root identity, 경로와 엔트리를 모두 검증한다.
function readScaffoldTransactionJournal(root: string): ValidatedScaffoldTransactionJournal | null {
  const { journalPath } = getScaffoldTransactionPaths(root)
  const journalStats = lstatIfExists(journalPath)

  if (!journalStats) return null
  if (!journalStats.isFile() || journalStats.isSymbolicLink()) {
    throw new Error(`Scaffold transaction journal is not a regular file: ${journalPath}`)
  }

  let journal: ScaffoldTransactionJournal

  try {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as ScaffoldTransactionJournal
  } catch {
    throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
  }

  const affectedEntries = Array.isArray(journal.affectedEntries) ? journal.affectedEntries : []
  const backedUpEntries = Array.isArray(journal.backedUpEntries) ? journal.backedUpEntries : []

  if (
    journal.schemaVersion !== 1 ||
    !Number.isSafeInteger(journal.pid) ||
    typeof journal.root !== 'string' ||
    typeof journal.stagingRoot !== 'string' ||
    typeof journal.backupRoot !== 'string' ||
    !['merge', 'replace'].includes(journal.mode) ||
    typeof journal.rootExisted !== 'boolean' ||
    !Array.isArray(journal.affectedEntries) ||
    !Array.isArray(journal.backedUpEntries) ||
    !affectedEntries.every(validateTransactionEntry) ||
    !backedUpEntries.every(validateTransactionEntry)
  ) {
    throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
  }

  let journalRoot: string

  try {
    journalRoot = canonicalizeTargetRoot(journal.root)
  } catch {
    throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
  }

  const transactionId = inferJournalTransactionId(
    root,
    journal.stagingRoot,
    journal.backupRoot,
    journal.transactionId,
  )

  if (!pathsShareIdentity(journalRoot, root)) {
    throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
  }

  assertTransactionDirectory(root, journal.stagingRoot, 'staging', transactionId)
  assertTransactionDirectory(root, journal.backupRoot, 'backup', transactionId)

  let entries: ScaffoldTransactionEntry[]

  if (typeof journal.entries === 'undefined') {
    entries = deriveLegacyTransactionEntries(root, affectedEntries, backedUpEntries)
  } else if (
    Array.isArray(journal.entries) &&
    journal.entries.every(validateTransactionEntryGroup)
  ) {
    const journalTargets = journal.entries.flatMap((entry) => entry.targetEntries)
    const journalBackups = journal.entries.flatMap((entry) => entry.backupEntries)

    if (
      !entryNameSetsMatch(journalTargets, affectedEntries) ||
      !entryNameSetsMatch(journalBackups, backedUpEntries)
    ) {
      throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
    }

    entries = coalesceJournalTransactionEntries(root, journal.entries)
  } else {
    throw new Error(`Scaffold transaction journal is invalid: ${journalPath}`)
  }

  return { ...journal, transactionId, entries }
}

// writeDurableJson 함수는 완성된 JSON을 fsync한 뒤 최종 저널 이름으로 원자 게시한다.
function writeDurableJson(
  targetPath: string,
  temporaryPrefix: string,
  transactionId: string,
  value: unknown,
) {
  const temporaryPath = `${temporaryPrefix}${transactionId}-${createTransactionId()}`
  let published = false
  let created = false

  try {
    const descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
    created = true

    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  } catch (error) {
    if (created) removePath(temporaryPath)
    throw error
  }

  try {
    fs.renameSync(temporaryPath, targetPath)
    published = true
    syncDirectory(path.dirname(targetPath))
  } catch (error) {
    if (!published) removePath(temporaryPath)
    throw error
  }
}

// clearScaffoldTransaction 함수는 target과 부모 동기화 뒤 저널 삭제와 그 부모를 확정한다.
function clearScaffoldTransaction(root: string) {
  const { journalPath } = getScaffoldTransactionPaths(root)

  syncDirectory(path.dirname(journalPath))
  fs.rmSync(journalPath)
  syncDirectory(path.dirname(journalPath))
}

// activateScaffoldTransaction 함수는 대상 변경 직전에 ID와 identity별 복구 정보를 영속 저널로 남긴다.
function activateScaffoldTransaction(
  stagingRoot: string,
  root: string,
  backupRoot: string,
  transactionId: string,
  mode: CommitMode,
  rootExisted: boolean,
  entries: ScaffoldTransactionEntry[],
) {
  const { journalPath, temporaryPrefix } = getScaffoldTransactionPaths(root)
  const affectedEntries = entries.flatMap((entry) => entry.targetEntries)
  const backedUpEntries = entries.flatMap((entry) => entry.backupEntries)
  const journal: ScaffoldTransactionJournal = {
    schemaVersion: 1,
    pid: process.pid,
    transactionId,
    root,
    stagingRoot,
    backupRoot,
    mode,
    rootExisted,
    affectedEntries,
    backedUpEntries,
    entries,
  }

  writeDurableJson(journalPath, temporaryPrefix, transactionId, journal)
}

// cleanupValidatedTransactionPaths 함수는 검증된 저널의 정확한 ID 경로 두 개만 정리한다.
function cleanupValidatedTransactionPaths(journal: ValidatedScaffoldTransactionJournal) {
  removePathAndSyncParent(journal.backupRoot)
  removePathAndSyncParent(journal.stagingRoot)
}

// ensureRecoveryBackupsComplete 함수는 복구를 시작하기 전에 깨진 링크를 포함한 모든 백업을 확인한다.
function ensureRecoveryBackupsComplete(journal: ValidatedScaffoldTransactionJournal) {
  const { journalPath } = getScaffoldTransactionPaths(journal.root)

  for (const entryName of uniqueEntryNames(
    journal.entries.flatMap((entry) => entry.backupEntries),
  )) {
    if (!pathEntryExists(path.join(journal.backupRoot, entryName))) {
      throw new Error(
        `Scaffold recovery backup is incomplete. Keep the journal for manual recovery: ${journalPath}`,
      )
    }
  }
}

// restoreTransactionEntries 함수는 각 identity를 한 번 처리하며 target alias를 지우고 원래 이름으로 복원한다.
function restoreTransactionEntries(
  root: string,
  backupRoot: string,
  entries: ScaffoldTransactionEntry[],
) {
  fs.mkdirSync(root, { recursive: true })

  for (const entry of entries) {
    for (const targetEntry of uniqueEntryNames(entry.targetEntries)) {
      const targetPath = path.join(root, targetEntry)
      assertSafeDestination(root, targetPath, true)
      removePath(targetPath)
    }

    for (const backupEntry of uniqueEntryNames(entry.backupEntries)) {
      const backupPath = path.join(backupRoot, backupEntry)
      const targetPath = path.join(root, backupEntry)
      assertSafeDestination(root, targetPath, true)
      copyExistingPath(backupPath, targetPath)
    }
  }
}

// removeCreatedRootIfEmpty 함수는 트랜잭션이 만든 빈 root를 지우고 부모 삭제 엔트리를 동기화한다.
function removeCreatedRootIfEmpty(root: string, rootExisted: boolean) {
  const stats = lstatIfExists(root)

  if (!rootExisted && stats?.isDirectory() && fs.readdirSync(root).length === 0) {
    fs.rmdirSync(root)
    syncDirectory(path.dirname(root))
  }
}

// recoverScaffoldTransactionUnderLock 함수는 획득한 mutex 아래에서 저널 검증부터 정리까지 수행한다.
function recoverScaffoldTransactionUnderLock(root: string) {
  const journal = readScaffoldTransactionJournal(root)

  if (!journal) return false

  ensureRecoveryBackupsComplete(journal)
  restoreTransactionEntries(root, journal.backupRoot, journal.entries)
  syncTransactionEntries(
    root,
    journal.entries.flatMap((entry) => [...entry.targetEntries, ...entry.backupEntries]),
  )
  removeCreatedRootIfEmpty(root, journal.rootExisted)
  clearScaffoldTransaction(root)
  cleanupValidatedTransactionPaths(journal)
  return true
}

// recoverScaffoldTransaction 함수는 정규 target mutex를 원자 획득한 뒤 중단 트랜잭션 전체를 복구한다.
export function recoverScaffoldTransaction(root: string, preservePaths: string[] = []) {
  void preservePaths
  const resolvedRoot = canonicalizeTargetRoot(root)

  if (!pathEntryExists(path.dirname(resolvedRoot))) return false
  return runWithScaffoldTransactionLock(resolvedRoot, () =>
    recoverScaffoldTransactionUnderLock(resolvedRoot),
  )
}

// restoreBackupEntries 함수는 실패한 commit의 identity별 대상과 깨진 링크 백업을 원래대로 돌린다.
function restoreBackupEntries(
  root: string,
  backupRoot: string,
  entries: ScaffoldTransactionEntry[],
) {
  const rollbackErrors: string[] = []

  for (const backupEntry of uniqueEntryNames(entries.flatMap((entry) => entry.backupEntries))) {
    if (!pathEntryExists(path.join(backupRoot, backupEntry))) {
      rollbackErrors.push(`${backupEntry}: backup entry is missing`)
    }
  }

  if (rollbackErrors.length > 0) return rollbackErrors

  try {
    restoreTransactionEntries(root, backupRoot, entries)
    syncTransactionEntries(
      root,
      entries.flatMap((entry) => [...entry.targetEntries, ...entry.backupEntries]),
    )
  } catch (error) {
    rollbackErrors.push((error as Error).message)
  }

  return rollbackErrors
}

// getPreviousProjectEntries 함수는 실제 root의 .git 외 최상위 엔트리 이름을 원래 casing으로 읽는다.
function getPreviousProjectEntries(root: string) {
  const stats = lstatIfExists(root)

  if (!stats) return []
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Project target must be a real directory: ${root}`)
  }

  return fs.readdirSync(root).filter((entryName) => entryName !== '.git')
}

// throwScaffoldingFailure 함수는 원래 실패와 rollback 상태를 한 오류로 보고한다.
function throwScaffoldingFailure(
  error: unknown,
  rollbackErrors: string[],
  backupRoot: string,
): never {
  let failure: Error

  if (rollbackErrors.length > 0) {
    failure = new Error(
      `Scaffolding failed: ${(error as Error).message}. Rollback also failed: ${rollbackErrors.join('; ')}. Backup retained at ${backupRoot}`,
      { cause: error },
    )
  } else {
    failure = new Error(
      `Scaffolding failed: ${(error as Error).message}. Existing files were restored.`,
      { cause: error },
    )
  }

  const errorCode = (error as NodeJS.ErrnoException).code
  if (errorCode) (failure as NodeJS.ErrnoException).code = errorCode
  throw failure
}

// rollbackActiveTransaction 함수는 영속 저널이 있을 때만 복원하고 성공 시 저널을 제거한다.
function rollbackActiveTransaction(
  root: string,
  backupRoot: string,
  rootExisted: boolean,
  entries: ScaffoldTransactionEntry[],
) {
  const { journalPath } = getScaffoldTransactionPaths(root)

  if (!pathEntryExists(journalPath)) return []

  const rollbackErrors = restoreBackupEntries(root, backupRoot, entries)

  if (rollbackErrors.length === 0) {
    removeCreatedRootIfEmpty(root, rootExisted)
    clearScaffoldTransaction(root)
  }

  return rollbackErrors
}

// applyMergeCommit 함수는 기존 추가 파일은 보존하면서 identity별 백업 후 staging을 병합한다.
function applyMergeCommit(
  stagingRoot: string,
  root: string,
  backupRoot: string,
  transactionId: string,
  rootExisted: boolean,
  stagedEntries: string[],
  previousEntries: string[],
  hooks: ScaffoldCommitHooks,
) {
  const entries = buildTransactionEntries(root, stagedEntries, previousEntries, 'merge')
  const backupEntries = uniqueEntryNames(entries.flatMap((entry) => entry.backupEntries))

  try {
    for (const entryName of stagedEntries) {
      const targetPath = path.join(root, entryName)
      const targetStats = lstatIfExists(targetPath)
      const brokenFinalLink = targetStats?.isSymbolicLink() && !fs.existsSync(targetPath)
      assertSafeDestination(root, targetPath, brokenFinalLink)
    }

    for (const [entryIndex, entryName] of backupEntries.entries()) {
      copyExistingPath(path.join(root, entryName), path.join(backupRoot, entryName))
      hooks.afterBackupEntry?.(entryName, entryIndex)
    }

    syncTransactionEntries(backupRoot, backupEntries)
    syncTransactionEntries(stagingRoot, stagedEntries)
    activateScaffoldTransaction(
      stagingRoot,
      root,
      backupRoot,
      transactionId,
      'merge',
      rootExisted,
      entries,
    )
    fs.mkdirSync(root, { recursive: true })

    for (const [entryIndex, entryName] of stagedEntries.entries()) {
      copyTemplatePath(path.join(stagingRoot, entryName), path.join(root, entryName), root)
      hooks.afterEntry?.(entryName, entryIndex)
    }

    syncTransactionEntries(
      root,
      entries.flatMap((entry) => entry.targetEntries),
    )
    clearScaffoldTransaction(root)
  } catch (error) {
    const rollbackErrors = rollbackActiveTransaction(root, backupRoot, rootExisted, entries)
    throwScaffoldingFailure(error, rollbackErrors, backupRoot)
  }
}

// applyReplaceCommit 함수는 .git만 보존하고 기존 identity를 백업한 뒤 새 프로젝트를 설치한다.
function applyReplaceCommit(
  stagingRoot: string,
  root: string,
  backupRoot: string,
  transactionId: string,
  rootExisted: boolean,
  stagedEntries: string[],
  previousEntries: string[],
  hooks: ScaffoldCommitHooks,
) {
  const entries = buildTransactionEntries(root, stagedEntries, previousEntries, 'replace')

  try {
    for (const [entryIndex, entryName] of previousEntries.entries()) {
      copyExistingPath(path.join(root, entryName), path.join(backupRoot, entryName))
      hooks.afterBackupEntry?.(entryName, entryIndex)
    }

    syncTransactionEntries(backupRoot, previousEntries)
    syncTransactionEntries(stagingRoot, stagedEntries)
    activateScaffoldTransaction(
      stagingRoot,
      root,
      backupRoot,
      transactionId,
      'replace',
      rootExisted,
      entries,
    )
    fs.mkdirSync(root, { recursive: true })

    for (const entryName of previousEntries) {
      removePath(path.join(root, entryName))
    }

    for (const [entryIndex, entryName] of stagedEntries.entries()) {
      fs.renameSync(path.join(stagingRoot, entryName), path.join(root, entryName))
      hooks.afterEntry?.(entryName, entryIndex)
    }

    syncTransactionEntries(
      root,
      entries.flatMap((entry) => entry.targetEntries),
    )
    clearScaffoldTransaction(root)
  } catch (error) {
    const rollbackErrors = rollbackActiveTransaction(root, backupRoot, rootExisted, entries)
    throwScaffoldingFailure(error, rollbackErrors, backupRoot)
  }
}

// cleanupOwnedApplyPaths 함수는 현재 ID 소유 경로이며 저널이 더는 참조하지 않는 두 경로만 지운다.
function cleanupOwnedApplyPaths(
  root: string,
  transactionId: string | null,
  stagingRoot: string | null,
  backupRoot: string | null,
) {
  if (pathEntryExists(getScaffoldTransactionPaths(root).journalPath)) return
  if (!transactionId) return

  if (
    backupRoot &&
    normalizedPathIdentity(backupRoot) ===
      normalizedPathIdentity(getTransactionDirectoryPath(root, 'backup', transactionId))
  ) {
    removePathAndSyncParent(backupRoot)
  }

  if (
    stagingRoot &&
    normalizedPathIdentity(stagingRoot) ===
      normalizedPathIdentity(getTransactionDirectoryPath(root, 'staging', transactionId))
  ) {
    removePathAndSyncParent(stagingRoot)
  }
}

// applyStagedProject 함수는 복구부터 merge 또는 replace commit과 정리까지 target mutex 아래 실행한다.
export function applyStagedProject(
  stagingRoot: string,
  root: string,
  mode: CommitMode,
  hooks: ScaffoldCommitHooks = {},
) {
  const resolvedRoot = canonicalizeTargetRoot(root)
  fs.mkdirSync(path.dirname(resolvedRoot), { recursive: true })

  return runWithScaffoldTransactionLock(resolvedRoot, () => {
    let ownedStagingRoot: string | null = null
    let backupRoot: string | null = null
    let transactionId: string | null = null
    let operationError: unknown

    try {
      recoverScaffoldTransactionUnderLock(resolvedRoot)
      const preparedStaging = prepareTransactionStaging(stagingRoot, resolvedRoot)
      ownedStagingRoot = preparedStaging.stagingRoot
      transactionId = preparedStaging.transactionId
      backupRoot = createTransactionDirectory(resolvedRoot, 'backup', preparedStaging.transactionId)

      const rootExisted = pathEntryExists(resolvedRoot)
      const stagedEntries = fs.readdirSync(ownedStagingRoot)
      const previousEntries = getPreviousProjectEntries(resolvedRoot)

      if (mode === 'replace') {
        applyReplaceCommit(
          ownedStagingRoot,
          resolvedRoot,
          backupRoot,
          preparedStaging.transactionId,
          rootExisted,
          stagedEntries,
          previousEntries,
          hooks,
        )
      } else {
        applyMergeCommit(
          ownedStagingRoot,
          resolvedRoot,
          backupRoot,
          preparedStaging.transactionId,
          rootExisted,
          stagedEntries,
          previousEntries,
          hooks,
        )
      }
    } catch (error) {
      operationError = error
    }

    try {
      cleanupOwnedApplyPaths(resolvedRoot, transactionId, ownedStagingRoot, backupRoot)
    } catch (error) {
      operationError ??= error
    }

    if (operationError) throw operationError
  })
}

// pkgFromUserAgent 함수는 npm user-agent 문자열에서 실행 중인 패키지 매니저를 추론한다.
function pkgFromUserAgent(userAgent: string | undefined) {
  if (!userAgent) return undefined
  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}
