import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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

// getNpmInvocation 함수는 운영체제에 맞는 npm 실행 명령과 인자를 만든다.
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

// readJson 함수는 UTF-8 JSON 파일을 객체로 읽는다.
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// writeJson 함수는 객체를 저장소 표준 개행을 포함한 JSON으로 기록한다.
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

// writeFormattedPackageJson 함수는 package.json을 기록하고 저장소 형식으로 정렬한다.
function writeFormattedPackageJson(packageRoot, packagePath, value) {
  writeJson(packagePath, value)
  runNode([join(packageRoot, 'scripts', 'tasks.mjs'), 'format-package-json'], packageRoot)
}

// createScratchDir 함수는 저장소의 무시된 임시 루트 아래에 고유 디렉터리를 만든다.
function createScratchDir(prefix) {
  mkdirSync(tempRoot, { recursive: true })
  return mkdtempSync(join(tempRoot, prefix))
}

// parseVersion 함수는 단순한 x.y.z 버전을 숫자 배열로 해석한다.
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)

  if (!match) {
    throw new Error(`Unsupported package version "${version}". Use a plain x.y.z version.`)
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10))
}

// compareVersions 함수는 두 x.y.z 버전의 우선순위를 비교한다.
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

// getHighestVersion 함수는 패키지 버전 목록에서 가장 높은 값을 고른다.
function getHighestVersion(versions) {
  return versions.reduce((highest, version) =>
    compareVersions(version, highest) > 0 ? version : highest,
  )
}

// writePackageVersion 함수는 패키지와 lockfile의 루트 버전을 함께 맞춘다.
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

// syncFrontronCreateDependency 함수는 frontron이 같은 create-frontron 후보를 참조하게 맞춘다.
function syncFrontronCreateDependency(version) {
  const dependencyVersion = version
  const lockPath = join(frontronPackageRoot, 'package-lock.json')
  const originalPackageSource = readFileSync(frontronPackagePath, 'utf8')
  const originalLockSource = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null
  const packageJson = readJson(frontronPackagePath)
  packageJson.dependencies ??= {}
  packageJson.dependencies['create-frontron'] = dependencyVersion

  try {
    writeFormattedPackageJson(frontronPackageRoot, frontronPackagePath, packageJson)

    if (!existsSync(lockPath)) {
      logStep(`synced frontron dependency create-frontron to ${dependencyVersion}`)
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
    lockJson.packages[''].dependencies['create-frontron'] = dependencyVersion
    writeJson(lockPath, lockJson)

    logStep(`synced frontron dependency and lockfile to create-frontron ${dependencyVersion}`)
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

// assertFrontronCreateDependencySynced 함수는 manifest와 lockfile의 로컬 후보 연결을 검증한다.
function assertFrontronCreateDependencySynced() {
  const packageJson = readJson(frontronPackagePath)
  const expectedVersion = packageJson.version
  const actualVersion = packageJson.dependencies?.['create-frontron']

  if (actualVersion !== expectedVersion) {
    throw new Error(
      `frontron must depend on the exact create-frontron version "${expectedVersion}" before publish. Run "node release.mjs publish" so the release script can sync and stage both packages safely.`,
    )
  }

  const lockJson = readJson(join(frontronPackageRoot, 'package-lock.json'))
  const lockVersion = lockJson.packages?.['']?.dependencies?.['create-frontron']
  const localPackageVersion = lockJson.packages?.['../create-frontron']?.version
  const linkedPackage = lockJson.packages?.['node_modules/create-frontron']

  if (
    lockVersion !== expectedVersion ||
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

// logStep 함수는 릴리스 단계 로그에 공통 접두사를 붙인다.
function logStep(message) {
  console.log(`[release] ${message}`)
}

// run 함수는 외부 명령 출력을 전달하고 실패 상태를 예외로 바꾼다.
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

// runQuiet 함수는 외부 명령 결과를 출력하지 않고 호출자에게 반환한다.
function runQuiet(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    // 큰 바이너리 변경이 있는 로컬 검증에서도 Git diff를 끝까지 비교한다.
    maxBuffer: 64 * 1024 * 1024,
  })
}

// runNpm 함수는 운영체제별 npm 명령을 일반 실행 경로로 호출한다.
function runNpm(args, cwd, env) {
  const invocation = getNpmInvocation(args)
  run(invocation.command, invocation.args, cwd, env)
}

// runNpmQuiet 함수는 npm 결과를 출력하지 않고 검사할 수 있게 반환한다.
function runNpmQuiet(args, cwd) {
  const invocation = getNpmInvocation(args)
  return runQuiet(invocation.command, invocation.args, cwd)
}

// runNode 함수는 현재 Node.js 실행 파일로 저장소 스크립트를 호출한다.
function runNode(args, cwd) {
  run(process.execPath, args, cwd)
}

// runGuardedNpmPublish 함수는 일회용 파일 토큰으로 직접 npm publish 가드를 통과시킨다.
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

// readTrackedDiff 함수는 지정한 추적 경로의 바이너리 포함 diff를 읽는다.
function readTrackedDiff(paths) {
  const result = runQuiet('git', ['diff', '--no-ext-diff', '--binary', '--', ...paths], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to inspect the tracked diff for ${paths.join(', ')}.`)
  }

  return result.stdout
}

// runLintGate 함수는 검사와 자동 수정이 추적 파일을 바꾸지 않는지 검증한다.
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

// getPackageVersions 함수는 두 npm 패키지의 현재 버전과 최고 버전을 읽는다.
function getPackageVersions() {
  const packageVersions = packageSpecs.map((spec) => readJson(spec.packagePath).version)
  const nextVersion = getHighestVersion(packageVersions)

  return { packageVersions, nextVersion }
}

// assertNpmPublishAccess 함수는 OIDC 조건 또는 로컬 npm 소유자 권한을 검증한다.
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

// versionExistsOnRegistry 함수는 특정 패키지 버전의 npm registry 존재 여부를 확인한다.
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

// assertVersionsNotPublished 함수는 dry-run 대상 버전이 아직 게시되지 않았는지 확인한다.
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

// calculateTarballIntegrity 함수는 보관된 tarball 바이트의 SHA-512 SRI를 직접 계산한다.
function calculateTarballIntegrity(tarballPath) {
  return `sha512-${createHash('sha512').update(readFileSync(tarballPath)).digest('base64')}`
}

// createPublishCandidate 함수는 실제 npm pack 파일과 npm 메타데이터가 같은 후보인지 검증한다.
function createPublishCandidate(spec, version, candidateRoot) {
  const result = runNpmQuiet(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', candidateRoot],
    spec.root,
  )

  if (result.status !== 0) {
    throw new Error(`Unable to create the publish tarball for ${spec.name}.`)
  }

  let packResults

  try {
    packResults = JSON.parse(result.stdout)
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${spec.name}.`)
  }

  if (!Array.isArray(packResults) || packResults.length !== 1) {
    throw new Error(`npm pack did not return exactly one tarball for ${spec.name}.`)
  }

  const packResult = packResults[0]
  const filename = packResult?.filename

  if (packResult?.name !== spec.name || packResult?.version !== version) {
    throw new Error(`npm pack returned unexpected package metadata for ${spec.name}@${version}.`)
  }

  if (typeof filename !== 'string' || !filename || basename(filename) !== filename) {
    throw new Error(`npm pack returned an invalid tarball filename for ${spec.name}.`)
  }

  const tarballPath = join(candidateRoot, filename)

  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create the reported tarball for ${spec.name}.`)
  }

  const integrity = calculateTarballIntegrity(tarballPath)

  if (packResult.integrity !== integrity) {
    throw new Error(`npm pack reported an integrity mismatch for ${spec.name}.`)
  }

  return {
    name: spec.name,
    version,
    tarballPath,
    integrity,
  }
}

// createPublishCandidates 함수는 검증 뒤 게시할 두 실제 tarball을 하나의 임시 후보 세트로 보관한다.
function createPublishCandidates(version) {
  const root = createScratchDir('publish-candidates-')

  try {
    const packages = packageSpecs.map((spec) => createPublishCandidate(spec, version, root))
    return { root, packages }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

// withPublishCandidates 함수는 성공과 실패 모두에서 임시 tarball 후보를 반드시 정리한다.
function withPublishCandidates(version, operation) {
  const candidates = createPublishCandidates(version)

  try {
    return operation(candidates)
  } finally {
    rmSync(candidates.root, { recursive: true, force: true })
  }
}

// getPublishCandidate 함수는 패키지와 버전에 정확히 대응하는 보관 후보 하나를 찾는다.
function getPublishCandidate(candidates, spec, version) {
  const candidate = candidates.packages.find((entry) => entry.name === spec.name)

  if (!candidate || candidate.version !== version) {
    throw new Error(`Missing retained publish candidate for ${spec.name}@${version}.`)
  }

  return candidate
}

// assertPublishCandidateUnchanged 함수는 dry-run 또는 게시 직전까지 후보 바이트가 그대로인지 확인한다.
function assertPublishCandidateUnchanged(candidate) {
  let currentIntegrity

  try {
    currentIntegrity = calculateTarballIntegrity(candidate.tarballPath)
  } catch {
    throw new Error(
      `Retained publish tarball is unavailable for ${candidate.name}@${candidate.version}.`,
    )
  }

  if (currentIntegrity !== candidate.integrity) {
    throw new Error(`Retained publish tarball changed for ${candidate.name}@${candidate.version}.`)
  }
}

// assertPublishedPackageMatchesCandidate 함수는 신규 게시와 부분 재개 모두 registry tarball을 후보와 비교한다.
function assertPublishedPackageMatchesCandidate(spec, version, candidate) {
  assertPublishCandidateUnchanged(candidate)
  const registryIntegrity = readRegistryValue(
    [`${spec.name}@${version}`, 'dist.integrity'],
    `${spec.name}@${version} integrity`,
  )

  if (registryIntegrity !== candidate.integrity) {
    throw new Error(
      `${spec.name}@${version} registry integrity does not match the retained local release candidate tarball. Bump the version instead of overwriting an immutable npm release.`,
    )
  }
}

// readRegistryValue 함수는 npm registry 값을 읽고 조회 실패에 설명을 덧붙인다.
function readRegistryValue(args, description) {
  const result = runNpmQuiet(['view', ...args], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to verify ${description} on npm registry.`)
  }

  return result.stdout.trim()
}

// verifyPublishedPackages 함수는 게시 버전과 요구한 dist-tag가 모두 일치하는지 확인한다.
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

// installNpm 함수는 registry smoke에 공통 npm install 옵션을 적용한다.
function installNpm(args, cwd) {
  runNpm(['install', '--fund=false', '--audit=false', '--loglevel=error', ...args], cwd)
}

// verifyRegistryInstall 함수는 게시 패키지로 생성과 기존 프로젝트 적용을 실제 검증한다.
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
    runNpm(['exec', '--', 'frontron', 'init', '--yes', '--out-dir', 'dist'], retrofitRoot)
    runNpm(['exec', '--', 'frontron', 'doctor'], retrofitRoot)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

// describeRegistryVersionState 함수는 부분 게시 오류에 넣을 현재 registry 상태를 설명한다.
function describeRegistryVersionState(spec, version) {
  try {
    return `${spec.name}@${version}: ${versionExistsOnRegistry(spec, version) ? 'published' : 'not published'}`
  } catch (error) {
    return `${spec.name}@${version}: unable to verify (${error instanceof Error ? error.message : error})`
  }
}

// syncVersions 함수는 두 패키지를 현재 최고 버전으로 맞춘다.
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

// verifyRelease 함수는 설치부터 빌드와 패키지 smoke까지 소스 릴리스 검증을 수행한다.
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

// runMatrixSmoke 함수는 지원 프레임워크 조합의 릴리스 smoke를 실행한다.
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

// publishPackages 함수는 보관된 동일 tarball을 순서대로 게시하고 각 registry integrity를 즉시 검증한다.
function publishPackages(version, candidates, tag = publishStagingTag) {
  const publishOrder = [
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
    packageSpecs.find((spec) => spec.name === 'frontron'),
  ].filter(Boolean)
  const published = []
  const skipped = []

  try {
    for (const spec of publishOrder) {
      const candidate = getPublishCandidate(candidates, spec, version)
      assertPublishCandidateUnchanged(candidate)

      if (versionExistsOnRegistry(spec, version)) {
        assertPublishedPackageMatchesCandidate(spec, version, candidate)
        logStep(
          `${spec.name}@${version} matches the retained tarball; resuming the partial release`,
        )
        logStep(`${spec.name}@${version} is already published; skipping package publish`)
        skipped.push(spec.name)
        continue
      }

      logStep(`publishing ${spec.name} with dist-tag "${tag}"`)
      const publishArgs = ['publish', candidate.tarballPath, '--tag', tag]

      if (isTrustedPublishing()) {
        publishArgs.push('--provenance', '--access', 'public')
      }

      runGuardedNpmPublish(publishArgs, spec.root)
      published.push(spec.name)
      assertPublishedPackageMatchesCandidate(spec, version, candidate)
      logStep(`verified registry integrity for ${spec.name}@${version}`)
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

// setDistTagForPackages 함수는 지정한 패키지 버전에 같은 npm dist-tag를 설정한다.
function setDistTagForPackages(version, tag, specs = packageSpecs) {
  for (const spec of specs) {
    logStep(`setting ${spec.name}@${version} dist-tag "${tag}"`)
    runNpm(['dist-tag', 'add', `${spec.name}@${version}`, tag], repoRoot)
  }
}

// promotePackagesToLatest 함수는 의존 순서대로 두 패키지를 latest에 승격한다.
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

// runPublishOrchestration 함수는 같은 후보를 유지한 채 trusted 또는 staging 게시 순서를 실행한다.
function runPublishOrchestration(version, candidates, operations = productionPublishOperations) {
  if (isTrustedPublishing()) {
    operations.publishPackages(version, candidates, latestTag)
    operations.verifyPublishedPackages(version)
    operations.verifyPublishedProvenance(version)
    operations.verifyRegistryInstall(version)
    return
  }

  operations.publishPackages(version, candidates, publishStagingTag)
  operations.setDistTagForPackages(version, publishStagingTag)
  operations.verifyPublishedPackages(version, publishStagingTag)
  operations.verifyRegistryInstall(version)
  operations.promotePackagesToLatest(version)
  operations.verifyPublishedPackages(version)
  operations.verifyRegistryInstall(version)
}

// dryRunPublishPackages 함수는 실제 게시에 쓸 보관 tarball 자체를 재패킹 없이 점검한다.
function dryRunPublishPackages(version, candidates) {
  for (const spec of packageSpecs) {
    const candidate = getPublishCandidate(candidates, spec, version)
    assertPublishCandidateUnchanged(candidate)
    logStep(`dry-running ${spec.name} publish`)
    runGuardedNpmPublish(
      ['publish', candidate.tarballPath, '--dry-run', '--tag', publishStagingTag],
      spec.root,
    )
  }
}

// verifyPublishReadiness 함수는 tarball을 만들기 전에 소스 기반 릴리스 검증을 모두 마친다.
function verifyPublishReadiness() {
  verifyRelease()
  runMatrixSmoke()
  runPackageManagerSmoke(['all', '--package'])
  assertReleaseWorktreeClean('after release verification')
}

// main 함수는 명시된 릴리스 명령의 가드와 실행 순서를 조율한다.
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
      withPublishCandidates(version, (candidates) => {
        dryRunPublishPackages(version, candidates)
      })
      assertReleaseWorktreeClean('after retained tarball publish dry-run')
      return
    }
    case 'publish': {
      assertReleaseWorktreeClean('before release verification')
      assertOfficialPublishingMode()
      assertNpmPublishAccess()
      const version = assertVersionsAligned()
      assertFrontronCreateDependencySynced()
      verifyPublishReadiness()
      withPublishCandidates(version, (candidates) => {
        dryRunPublishPackages(version, candidates)
        assertReleaseWorktreeClean('after retained tarball publish dry-run')
        runPublishOrchestration(version, candidates)
      })
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
