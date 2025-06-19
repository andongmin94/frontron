import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const createPackageRoot = join(repoRoot, 'create-frontron')
const frontronPackageRoot = join(repoRoot, 'frontron')
const createPackagePath = join(createPackageRoot, 'package.json')
const frontronPackagePath = join(frontronPackageRoot, 'package.json')
const packageSpecs = [
  {
    name: 'create-frontron',
    root: createPackageRoot,
    packagePath: createPackagePath,
    lockPath: join(createPackageRoot, 'package-lock.json'),
    lintDiffPaths: ['create-frontron', 'release.mjs'],
  },
  {
    name: 'frontron',
    root: frontronPackageRoot,
    packagePath: frontronPackagePath,
    lockPath: join(frontronPackageRoot, 'package-lock.json'),
    lintDiffPaths: ['frontron'],
  },
]
const tempRoot = join(repoRoot, '.tmp')
const publishStagingTag = 'frontron-staged'
const latestTag = 'latest'
const publishGuardTokenEnvironment = 'FRONTRON_RELEASE_PUBLISH_TOKEN'
const publishGuardFileEnvironment = 'FRONTRON_RELEASE_PUBLISH_TOKEN_FILE'

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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeFormattedPackageJson(packageRoot, packagePath, value) {
  writeJson(packagePath, value)
  runNode([join(packageRoot, 'scripts', 'tasks.mjs'), 'format-package-json'], packageRoot)
}

function createScratchDir(prefix) {
  mkdirSync(tempRoot, { recursive: true })
  return mkdtempSync(join(tempRoot, prefix))
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)

  if (!match) {
    throw new Error(`Unsupported package version "${version}". Use a plain x.y.z version.`)
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10))
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

function getHighestVersion(versions) {
  return versions.reduce((highest, version) =>
    compareVersions(version, highest) > 0 ? version : highest,
  )
}

function writePackageVersion(spec, version) {
  const packageJson = readJson(spec.packagePath)

  if (packageJson.version !== version) {
    packageJson.version = version
    writeFormattedPackageJson(spec.root, spec.packagePath, packageJson)
    logStep(`synced ${spec.name} package.json to ${version}`)
  }

  if (!existsSync(spec.lockPath)) {
    return
  }

  const lockJson = readJson(spec.lockPath)

  if (lockJson.version !== version) {
    lockJson.version = version
  }

  if (lockJson.packages?.['']?.version !== version) {
    lockJson.packages[''].version = version
  }

  writeJson(spec.lockPath, lockJson)
}

function syncFrontronCreateDependency(version) {
  const dependencyRange = `^${version}`
  const lockPath = join(frontronPackageRoot, 'package-lock.json')
  const originalPackageSource = readFileSync(frontronPackagePath, 'utf8')
  const originalLockSource = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null
  const packageJson = readJson(frontronPackagePath)
  packageJson.dependencies ??= {}
  packageJson.dependencies['create-frontron'] = dependencyRange

  try {
    writeFormattedPackageJson(frontronPackageRoot, frontronPackagePath, packageJson)

    if (!existsSync(lockPath)) {
      logStep(`synced frontron dependency create-frontron to ${dependencyRange}`)
      return
    }

    // 아직 레지스트리에 없는 릴리스 후보도 npm ci로 검증할 수 있게 로컬 패키지로 잠근다.
    runNpm(
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--fund=false',
        '--audit=false',
        createPackageRoot,
      ],
      frontronPackageRoot,
    )
    writeFormattedPackageJson(frontronPackageRoot, frontronPackagePath, packageJson)

    const lockJson = readJson(lockPath)
    lockJson.packages ??= {}
    lockJson.packages[''] ??= {}
    lockJson.packages[''].dependencies ??= {}
    lockJson.packages[''].dependencies['create-frontron'] = dependencyRange
    writeJson(lockPath, lockJson)

    logStep(`synced frontron dependency and lockfile to create-frontron ${dependencyRange}`)
  } catch (error) {
    writeFileSync(frontronPackagePath, originalPackageSource)

    if (originalLockSource === null) {
      rmSync(lockPath, { force: true })
    } else {
      writeFileSync(lockPath, originalLockSource)
    }

    throw error
  }
}

function assertFrontronCreateDependencySynced() {
  const packageJson = readJson(frontronPackagePath)
  const expectedRange = `^${packageJson.version}`
  const actualRange = packageJson.dependencies?.['create-frontron']

  if (actualRange !== expectedRange) {
    throw new Error(
      `frontron must depend on create-frontron "${expectedRange}" before publish. Run "node release.mjs publish" so the release script can sync and stage both packages safely.`,
    )
  }

  const lockJson = readJson(join(frontronPackageRoot, 'package-lock.json'))
  const lockRange = lockJson.packages?.['']?.dependencies?.['create-frontron']
  const localPackageVersion = lockJson.packages?.['../create-frontron']?.version
  const linkedPackage = lockJson.packages?.['node_modules/create-frontron']

  if (
    lockRange !== expectedRange ||
    localPackageVersion !== packageJson.version ||
    linkedPackage?.resolved !== '../create-frontron' ||
    linkedPackage?.link !== true
  ) {
    throw new Error(
      'frontron package-lock.json must link the matching local create-frontron release candidate.',
    )
  }
}

// assertVersionsAligned 함수는 두 npm 패키지가 같은 릴리스 버전을 가리키는지 확인한다.
function assertVersionsAligned() {
  const { packageVersions, nextVersion } = getPackageVersions()

  if (!packageVersions.every((version) => version === nextVersion)) {
    throw new Error(
      `Package versions are not aligned (${packageVersions.join(', ')}). Run "node release.mjs sync-version", review the metadata changes, and commit them before publishing.`,
    )
  }

  return nextVersion
}

// assertReleaseWorktreeClean 함수는 검토되지 않은 파일이 npm 게시물에 섞이지 않게 막는다.
function assertReleaseWorktreeClean(phase) {
  const result = runQuiet('git', ['status', '--porcelain=v1', '--untracked-files=all'], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to inspect the Git worktree ${phase}.`)
  }

  const dirtyPaths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  if (dirtyPaths.length > 0) {
    const preview = dirtyPaths.slice(0, 20).join('\n')
    const remainder = dirtyPaths.length > 20 ? `\n... and ${dirtyPaths.length - 20} more` : ''

    throw new Error(
      `Refusing to publish from a dirty Git worktree ${phase}:\n${preview}${remainder}\nCommit or intentionally remove these changes first.`,
    )
  }
}

function logStep(message) {
  console.log(`[release] ${message}`)
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env,
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

function runQuiet(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    // 큰 바이너리 변경이 있는 로컬 검증에서도 Git diff를 끝까지 비교한다.
    maxBuffer: 64 * 1024 * 1024,
  })
}

function runNpm(args, cwd, env) {
  const invocation = getNpmInvocation(args)
  run(invocation.command, invocation.args, cwd, env)
}

function runNpmQuiet(args, cwd) {
  const invocation = getNpmInvocation(args)
  return runQuiet(invocation.command, invocation.args, cwd)
}

function runNode(args, cwd) {
  run(process.execPath, args, cwd)
}

function runGuardedNpmPublish(args, cwd) {
  const guardRoot = mkdtempSync(join(tmpdir(), 'frontron-publish-guard-'))
  const tokenPath = join(guardRoot, 'token')
  const token = randomBytes(32).toString('hex')

  try {
    writeFileSync(tokenPath, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    runNpm(args, cwd, {
      ...process.env,
      [publishGuardTokenEnvironment]: token,
      [publishGuardFileEnvironment]: tokenPath,
    })
  } finally {
    rmSync(guardRoot, { recursive: true, force: true })
  }
}

function readTrackedDiff(paths) {
  const result = runQuiet('git', ['diff', '--no-ext-diff', '--binary', '--', ...paths], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to inspect the tracked diff for ${paths.join(', ')}.`)
  }

  return result.stdout
}

function runLintGate(spec) {
  logStep(`checking ${spec.name} lint and formatting`)
  runNpm(['run', 'check'], spec.root)

  const beforeLint = readTrackedDiff(spec.lintDiffPaths)

  runNpm(['run', 'lint'], spec.root)

  const afterLint = readTrackedDiff(spec.lintDiffPaths)

  if (afterLint !== beforeLint) {
    const changedDiff = runQuiet(
      'git',
      ['diff', '--no-ext-diff', '--', ...spec.lintDiffPaths],
      repoRoot,
    )

    if (changedDiff.stdout) {
      process.stdout.write(changedDiff.stdout)
    }

    throw new Error(
      `${spec.name} lint changed tracked files. Run "npm run lint" in ${spec.name} and commit the result before release verification.`,
    )
  }
}

function getPackageVersions() {
  const packageVersions = packageSpecs.map((spec) => readJson(spec.packagePath).version)
  const nextVersion = getHighestVersion(packageVersions)

  return { packageVersions, nextVersion }
}

function assertNpmPublishAccess() {
  if (isTrustedPublishing()) {
    if (
      process.env.GITHUB_ACTIONS !== 'true' ||
      !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
      !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    ) {
      throw new Error(
        'FRONTRON_TRUSTED_PUBLISHING=1 requires a GitHub-hosted Actions job with id-token: write.',
      )
    }

    logStep('using npm trusted publishing with GitHub Actions OIDC')
    return
  }

  logStep('checking npm publish authentication')
  const whoamiResult = runNpmQuiet(['whoami'], repoRoot)

  if (whoamiResult.status !== 0) {
    throw new Error(
      'npm is not authenticated. Run "npm login" with an account that can publish "frontron" and "create-frontron", then retry "node release.mjs publish".',
    )
  }

  const username = whoamiResult.stdout.trim()

  if (!username) {
    throw new Error(
      'npm did not return a username. Run "npm login", then retry "node release.mjs publish".',
    )
  }

  for (const spec of packageSpecs) {
    const ownerResult = runNpmQuiet(['owner', 'ls', spec.name], repoRoot)

    if (ownerResult.status !== 0) {
      throw new Error(
        `Unable to verify npm owners for "${spec.name}". Check npm access, then retry.`,
      )
    }

    const ownerLines = ownerResult.stdout.split(/\r?\n/).map((line) => line.trim())
    const hasPublishAccess = ownerLines.some(
      (line) => line === username || line.startsWith(`${username} `),
    )

    if (!hasPublishAccess) {
      throw new Error(
        `npm user "${username}" is not listed as an owner of "${spec.name}". Publish with an owner account or add the user before retrying.`,
      )
    }
  }

  logStep(`npm user "${username}" can publish both packages`)
}

// isTrustedPublishing 함수는 장기 npm token 대신 GitHub Actions OIDC 게시 모드인지 확인한다.
function isTrustedPublishing() {
  return process.env.FRONTRON_TRUSTED_PUBLISHING === '1'
}

// assertOfficialPublishingMode 함수는 공식 릴리스가 출처 증명이 남는 OIDC 경로를 사용하게 한다.
function assertOfficialPublishingMode() {
  if (isTrustedPublishing() || process.env.FRONTRON_ALLOW_LOCAL_PUBLISH === '1') {
    return
  }

  throw new Error(
    'Official releases must run through .github/workflows/frontron-release.yml with npm trusted publishing. Set FRONTRON_ALLOW_LOCAL_PUBLISH=1 only for an intentional emergency token-based release.',
  )
}

function versionExistsOnRegistry(spec, version) {
  const result = runNpmQuiet(['view', `${spec.name}@${version}`, 'version'], repoRoot)

  if (result.status === 0) {
    return true
  }

  const output = `${result.stdout}\n${result.stderr}`

  if (output.includes('E404') || output.includes('No match found for version')) {
    return false
  }

  throw new Error(`Unable to check npm registry version for "${spec.name}@${version}".`)
}

function assertVersionsNotPublished(version) {
  logStep(`checking npm registry for unpublished version ${version}`)

  const alreadyPublished = packageSpecs
    .filter((spec) => versionExistsOnRegistry(spec, version))
    .map((spec) => `${spec.name}@${version}`)

  if (alreadyPublished.length > 0) {
    throw new Error(
      `Refusing to publish an existing npm version: ${alreadyPublished.join(', ')}. Bump both package versions before retrying.`,
    )
  }
}

// readLocalPackageIntegrity 함수는 검증을 마친 로컬 tarball의 Subresource Integrity 값을 읽는다.
function readLocalPackageIntegrity(spec) {
  const result = runNpmQuiet(['pack', '--json', '--dry-run', '--ignore-scripts'], spec.root)

  if (result.status !== 0) {
    throw new Error(`Unable to calculate the local package integrity for ${spec.name}.`)
  }

  let packResult

  try {
    packResult = JSON.parse(result.stdout)
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${spec.name}.`)
  }

  const integrity = packResult[0]?.integrity

  if (typeof integrity !== 'string' || !integrity) {
    throw new Error(`npm pack did not report an integrity value for ${spec.name}.`)
  }

  return integrity
}

// assertPublishedPackageMatchesLocal 함수는 부분 게시 재개 시 이미 올라간 tarball이 현재 후보와 같은지 확인한다.
function assertPublishedPackageMatchesLocal(spec, version) {
  const localIntegrity = readLocalPackageIntegrity(spec)
  const registryIntegrity = readRegistryValue(
    [`${spec.name}@${version}`, 'dist.integrity'],
    `${spec.name}@${version} integrity`,
  )

  if (registryIntegrity !== localIntegrity) {
    throw new Error(
      `${spec.name}@${version} already exists but its registry integrity does not match the local release candidate. Bump the version instead of overwriting an immutable npm release.`,
    )
  }

  logStep(`${spec.name}@${version} matches the local tarball; resuming the partial release`)
}

function readRegistryValue(args, description) {
  const result = runNpmQuiet(['view', ...args], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to verify ${description} on npm registry.`)
  }

  return result.stdout.trim()
}

function verifyPublishedPackages(version, tag = latestTag) {
  logStep(`verifying published npm packages at ${version} with dist-tag "${tag}"`)

  for (const spec of packageSpecs) {
    const publishedVersion = readRegistryValue(
      [`${spec.name}@${version}`, 'version'],
      `${spec.name}@${version}`,
    )

    if (publishedVersion !== version) {
      throw new Error(`npm registry returned "${publishedVersion}" for "${spec.name}@${version}".`)
    }

    const taggedVersion = readRegistryValue(
      [spec.name, `dist-tags.${tag}`],
      `${spec.name} ${tag} dist-tag`,
    )

    if (taggedVersion !== version) {
      throw new Error(
        `npm ${tag} dist-tag for "${spec.name}" is "${taggedVersion}", expected "${version}". Publish completed but ${tag} does not point at the release.`,
      )
    }
  }
}

// sleepSync 함수는 npm 레지스트리 메타데이터가 전파될 때까지 짧게 기다린다.
function sleepSync(timeoutMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs)
}

// verifyPublishedProvenance 함수는 OIDC 릴리스 두 개에 Sigstore provenance가 생겼는지 확인한다.
function verifyPublishedProvenance(version) {
  for (const spec of packageSpecs) {
    let attestations = null

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = runNpmQuiet(
        ['view', `${spec.name}@${version}`, 'dist.attestations', '--json'],
        repoRoot,
      )

      if (result.status === 0 && result.stdout.trim()) {
        try {
          attestations = JSON.parse(result.stdout)
        } catch {
          attestations = null
        }
      }

      if (
        typeof attestations?.url === 'string' &&
        attestations?.provenance?.predicateType === 'https://slsa.dev/provenance/v1'
      ) {
        break
      }

      sleepSync(5_000)
    }

    if (
      typeof attestations?.url !== 'string' ||
      attestations?.provenance?.predicateType !== 'https://slsa.dev/provenance/v1'
    ) {
      throw new Error(
        `${spec.name}@${version} was published but npm did not expose its provenance attestation.`,
      )
    }

    logStep(`verified npm provenance for ${spec.name}@${version}`)
  }
}

function installNpm(args, cwd) {
  runNpm(['install', '--fund=false', '--audit=false', '--loglevel=error', ...args], cwd)
}

function verifyRegistryInstall(version) {
  logStep(`running registry install smoke for ${version}`)

  const scratchRoot = createScratchDir('registry-smoke-')

  try {
    const starterRoot = join(scratchRoot, 'starter')
    const retrofitRoot = join(scratchRoot, 'retrofit')

    mkdirSync(starterRoot, { recursive: true })
    runNpm(['init', '-y'], starterRoot)
    runNpm(
      [
        'exec',
        '--yes',
        '--package',
        `create-frontron@${version}`,
        '--',
        'create-frontron',
        'registry-starter',
        '--overwrite',
        'yes',
      ],
      starterRoot,
    )

    const generatedStarterRoot = join(starterRoot, 'registry-starter')

    installNpm([], generatedStarterRoot)
    runNpm(['run', 'typecheck'], generatedStarterRoot)
    runNpm(['audit', 'signatures'], generatedStarterRoot)

    mkdirSync(join(retrofitRoot, 'scripts'), { recursive: true })
    writeJson(join(retrofitRoot, 'package.json'), {
      name: 'registry-retrofit-app',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'node scripts/dev-server.mjs',
        build: 'node scripts/build.mjs',
      },
    })
    writeFileSync(
      join(retrofitRoot, 'scripts', 'dev-server.mjs'),
      `import { createServer } from 'node:http'

createServer((_request, response) => response.end('ok')).listen(5173, '127.0.0.1')
`,
    )
    writeFileSync(
      join(retrofitRoot, 'scripts', 'build.mjs'),
      `import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
writeFileSync('dist/index.html', '<!doctype html><title>registry retrofit</title>')
`,
    )

    installNpm(['--save-dev', `frontron@${version}`], retrofitRoot)
    runNpm(['audit', 'signatures'], retrofitRoot)
    runNpm(
      ['exec', '--', 'frontron', 'init', '--yes', '--preset', 'starter-like', '--out-dir', 'dist'],
      retrofitRoot,
    )
    runNpm(['exec', '--', 'frontron', 'doctor'], retrofitRoot)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function describeRegistryVersionState(spec, version) {
  try {
    return `${spec.name}@${version}: ${versionExistsOnRegistry(spec, version) ? 'published' : 'not published'}`
  } catch (error) {
    return `${spec.name}@${version}: unable to verify (${error instanceof Error ? error.message : error})`
  }
}

function syncVersions() {
  const { packageVersions, nextVersion } = getPackageVersions()
  const alreadyAligned = packageVersions.every((version) => version === nextVersion)

  if (alreadyAligned) {
    logStep(`versions already aligned at ${nextVersion}`)
    return nextVersion
  }

  for (const spec of packageSpecs) {
    writePackageVersion(spec, nextVersion)
  }

  return nextVersion
}

function verifyRelease() {
  assertVersionsAligned()
  assertFrontronCreateDependencySynced()

  for (const spec of packageSpecs) {
    logStep(`installing ${spec.name} from its lockfile`)
    runNpm(['ci', '--fund=false', '--audit=false'], spec.root)
  }

  for (const spec of packageSpecs) {
    logStep(`validating ${spec.name} dependency tree`)
    runNpm(['ls', '--all'], spec.root)

    logStep(`auditing ${spec.name} dependencies`)
    runNpm(['audit', '--audit-level=moderate'], spec.root)

    runLintGate(spec)

    logStep(`typechecking ${spec.name}`)
    runNpm(['run', 'typecheck'], spec.root)

    logStep(`testing ${spec.name} with coverage thresholds`)
    runNpm(['run', 'coverage'], spec.root)

    logStep(`building ${spec.name}`)
    runNpm(['run', 'build'], spec.root)

    logStep(`running ${spec.name} package smoke`)
    runNpm(['run', 'test:package-smoke'], spec.root)
  }

  logStep('running create-frontron release smoke')
  runNpm(['run', 'test:release-smoke'], createPackageRoot)
}

function runMatrixSmoke(args = []) {
  logStep('running release matrix smoke')
  runNode([join(createPackageRoot, 'scripts', 'release-matrix-smoke.mjs'), ...args], repoRoot)
}

// runPackageManagerSmoke 함수는 실제 pnpm, Yarn, Bun 프로젝트에 packed Frontron을 적용한다.
function runPackageManagerSmoke(args = []) {
  logStep('running package manager matrix smoke')
  runNode(
    [join(createPackageRoot, 'scripts', 'package-manager-matrix-smoke.mjs'), ...args],
    repoRoot,
  )
}

function publishPackages(version, tag = publishStagingTag) {
  const publishOrder = [
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
    packageSpecs.find((spec) => spec.name === 'frontron'),
  ].filter(Boolean)
  const published = []
  const skipped = []

  try {
    for (const spec of publishOrder) {
      if (versionExistsOnRegistry(spec, version)) {
        assertPublishedPackageMatchesLocal(spec, version)
        logStep(`${spec.name}@${version} is already published; skipping package publish`)
        skipped.push(spec.name)
        continue
      }

      logStep(`publishing ${spec.name} with dist-tag "${tag}"`)
      const publishArgs = ['publish', '--tag', tag]

      if (isTrustedPublishing()) {
        publishArgs.push('--provenance', '--access', 'public')
      }

      runGuardedNpmPublish(publishArgs, spec.root)
      published.push(spec.name)
    }
  } catch (error) {
    const registryState = packageSpecs.map((spec) => describeRegistryVersionState(spec, version))

    throw new Error(
      `Publish failed after ${published.length > 0 ? published.join(', ') : 'no packages'} published and ${
        skipped.length > 0 ? skipped.join(', ') : 'no packages'
      } skipped. Registry state: ${registryState.join('; ')}. Original error: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }
}

function setDistTagForPackages(version, tag, specs = packageSpecs) {
  for (const spec of specs) {
    logStep(`setting ${spec.name}@${version} dist-tag "${tag}"`)
    runNpm(['dist-tag', 'add', `${spec.name}@${version}`, tag], repoRoot)
  }
}

function promotePackagesToLatest(version) {
  const promoteOrder = [
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
    packageSpecs.find((spec) => spec.name === 'frontron'),
  ].filter(Boolean)

  setDistTagForPackages(version, latestTag, promoteOrder)
}

const productionPublishOperations = {
  promotePackagesToLatest,
  publishPackages,
  setDistTagForPackages,
  verifyPublishedPackages,
  verifyPublishedProvenance,
  verifyRegistryInstall,
}

// runPublishOrchestration 함수는 검증을 마친 릴리스의 trusted 또는 staging 게시 순서를 실행한다.
function runPublishOrchestration(version, operations = productionPublishOperations) {
  if (isTrustedPublishing()) {
    operations.publishPackages(version, latestTag)
    operations.verifyPublishedPackages(version)
    operations.verifyPublishedProvenance(version)
    operations.verifyRegistryInstall(version)
    return
  }

  operations.publishPackages(version, publishStagingTag)
  operations.setDistTagForPackages(version, publishStagingTag)
  operations.verifyPublishedPackages(version, publishStagingTag)
  operations.verifyRegistryInstall(version)
  operations.promotePackagesToLatest(version)
  operations.verifyPublishedPackages(version)
  operations.verifyRegistryInstall(version)
}

function dryRunPublishPackages() {
  logStep('dry-running create-frontron publish')
  runGuardedNpmPublish(['publish', '--dry-run', '--tag', publishStagingTag], createPackageRoot)

  logStep('dry-running frontron publish')
  runGuardedNpmPublish(['publish', '--dry-run', '--tag', publishStagingTag], frontronPackageRoot)
}

function verifyPublishReadiness() {
  verifyRelease()
  runMatrixSmoke()
  runPackageManagerSmoke(['all', '--package'])
  dryRunPublishPackages()
  assertReleaseWorktreeClean('after release verification')
}

function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)

  if (!command) {
    throw new Error(
      'Missing release command. Pass an explicit command such as "verify" or "publish".',
    )
  }

  switch (command) {
    case 'sync-version': {
      const version = syncVersions()
      syncFrontronCreateDependency(version)
      return
    }
    case 'verify':
      verifyRelease()
      return
    case 'matrix-smoke':
      runMatrixSmoke(args)
      return
    case 'package-manager-smoke':
      runPackageManagerSmoke(args)
      return
    case 'registry-smoke':
      verifyRegistryInstall(
        args[0] ??
          readRegistryValue(
            ['create-frontron', 'dist-tags.latest'],
            'create-frontron latest dist-tag',
          ),
      )
      return
    case 'check-auth':
      assertNpmPublishAccess()
      return
    case 'check-metadata':
      assertVersionsAligned()
      assertFrontronCreateDependencySynced()
      return
    case 'publish-dry-run': {
      assertReleaseWorktreeClean('before release verification')
      const version = assertVersionsAligned()
      assertFrontronCreateDependencySynced()
      assertVersionsNotPublished(version)
      verifyPublishReadiness()
      return
    }
    case 'publish': {
      assertReleaseWorktreeClean('before release verification')
      assertOfficialPublishingMode()
      assertNpmPublishAccess()
      const version = assertVersionsAligned()
      assertFrontronCreateDependencySynced()
      verifyPublishReadiness()
      runPublishOrchestration(version)
      return
    }
    default:
      throw new Error(`Unknown release command: ${command}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
