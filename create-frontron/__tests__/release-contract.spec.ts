import { spawnSync as spawnProcessSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

interface SpawnCall {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

interface SpawnResult {
  status: number
  stdout: string
  stderr: string
}

interface ReleaseModule {
  assertNpmPublishAccess(): void
  dryRunPublishPackages(version: string, candidates: PublishCandidates): void
  main(): void
  publishPackages(version: string, candidates: PublishCandidates, tag?: string): void
  runPublishOrchestration(
    version: string,
    candidates: PublishCandidates,
    operations: PublishOperations,
  ): void
  withPublishCandidates(version: string, operation: (candidates: PublishCandidates) => void): void
}

interface ReleaseHarness {
  module: ReleaseModule
  root: string
}

type SpawnHandler = (call: SpawnCall) => SpawnResult

interface PublishOperations {
  promotePackagesToLatest(version: string): void
  publishPackages(version: string, candidates: PublishCandidates, tag?: string): void
  setDistTagForPackages(version: string, tag: string): void
  verifyPublishedPackages(version: string, tag?: string): void
  verifyPublishedProvenance(version: string): void
  verifyRegistryInstall(version: string): void
}

interface PublishCandidate {
  name: string
  version: string
  tarballPath: string
  integrity: string
}

interface PublishCandidates {
  root: string
  packages: PublishCandidate[]
}

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(createPackageRoot)
const releaseEnvironmentKeys = [
  'FRONTRON_TRUSTED_PUBLISHING',
  'FRONTRON_ALLOW_LOCAL_PUBLISH',
  'GITHUB_ACTIONS',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'FRONTRON_RELEASE_PUBLISH_TOKEN',
  'FRONTRON_RELEASE_PUBLISH_TOKEN_FILE',
] as const
const originalReleaseEnvironment = new Map<string, string | undefined>()
const spawnCalls: SpawnCall[] = []
const testCandidateRoots: string[] = []
let releaseHarness: ReleaseHarness

for (const key of releaseEnvironmentKeys) {
  originalReleaseEnvironment.set(key, process.env[key])
}

// successfulSpawnResult 함수는 자식 프로세스 성공 결과를 일관된 형태로 만든다.
function successfulSpawnResult(stdout = ''): SpawnResult {
  return { status: 0, stdout, stderr: '' }
}

// failedSpawnResult 함수는 네트워크 조회 실패를 흉내 내는 결과를 만든다.
function failedSpawnResult(stderr: string): SpawnResult {
  return { status: 1, stdout: '', stderr }
}

// failUnexpectedSpawn 함수는 계약에 없는 외부 명령이 실행되면 테스트를 즉시 실패시킨다.
function failUnexpectedSpawn(call: SpawnCall): never {
  throw new Error(`Unexpected child process: ${call.command} ${call.args.join(' ')}`)
}

let spawnHandler: SpawnHandler = failUnexpectedSpawn

// mockSpawnSync 함수는 release.mjs의 모든 외부 명령을 기록하고 테스트별 응답기로 전달한다.
function mockSpawnSync(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SpawnResult {
  const call = {
    command,
    args: [...args],
    cwd: options.cwd,
    env: options.env ? { ...options.env } : undefined,
  }
  spawnCalls.push(call)
  return spawnHandler(call)
}

// getNpmArgs 함수는 운영체제별 npm 실행 래퍼를 실제 npm 인자 목록으로 정규화한다.
function getNpmArgs(call: SpawnCall): string[] | null {
  const npmMarkerIndex = call.args.indexOf('npm')

  if (npmMarkerIndex >= 0) {
    return call.args.slice(npmMarkerIndex + 1)
  }

  if (/npm(?:\.cmd)?$/i.test(call.command)) {
    return [...call.args]
  }

  return null
}

// getNpmCalls 함수는 기록된 외부 명령 중 npm 호출만 인자와 함께 반환한다.
function getNpmCalls(): Array<{ call: SpawnCall; args: string[] }> {
  const npmCalls: Array<{ call: SpawnCall; args: string[] }> = []

  for (const call of spawnCalls) {
    const args = getNpmArgs(call)

    if (args) {
      npmCalls.push({ call, args })
    }
  }

  return npmCalls
}

// calculateTestIntegrity 함수는 테스트 tarball 바이트에서 실제 SHA-512 SRI를 만든다.
function calculateTestIntegrity(content: string | Buffer): string {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`
}

// createTestPublishCandidates 함수는 publish 계약 검증에 사용할 실제 임시 tarball 두 개를 만든다.
function createTestPublishCandidates(version: string): PublishCandidates {
  const root = mkdtempSync(join(releaseHarness.root, 'publish-candidates-'))
  testCandidateRoots.push(root)
  const packages = ['create-frontron', 'frontron'].map((name) => {
    const content = `${name}@${version} retained publish candidate`
    const tarballPath = join(root, `${name}-${version}.tgz`)
    writeFileSync(tarballPath, content)

    return {
      name,
      version,
      tarballPath,
      integrity: calculateTestIntegrity(content),
    }
  })

  return { root, packages }
}

// getTestCandidate 함수는 테스트 후보 세트에서 이름이 맞는 tarball을 반환한다.
function getTestCandidate(candidates: PublishCandidates, name: string): PublishCandidate {
  const candidate = candidates.packages.find((entry) => entry.name === name)

  if (!candidate) {
    throw new Error(`Missing test candidate for ${name}.`)
  }

  return candidate
}

// clearReleaseEnvironment 함수는 호스트 CI 환경이 테스트 분기에 영향을 주지 않게 한다.
function clearReleaseEnvironment(): void {
  for (const key of releaseEnvironmentKeys) {
    delete process.env[key]
  }
}

// restoreReleaseEnvironment 함수는 테스트 전에 존재하던 릴리스 환경 변수를 복원한다.
function restoreReleaseEnvironment(): void {
  for (const key of releaseEnvironmentKeys) {
    const originalValue = originalReleaseEnvironment.get(key)

    if (originalValue === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalValue
    }
  }
}

// loadReleaseHarness 함수는 실제 release.mjs 내부 함수만 노출하고 자식 프로세스를 가짜로 교체한다.
async function loadReleaseHarness(): Promise<ReleaseHarness> {
  const sourcePath = join(workspaceRoot, 'release.mjs')
  const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
  const childProcessImport = "import { spawnSync } from 'node:child_process'"
  const entrypointStart = source.lastIndexOf('\ntry {\n  main()')

  if (!source.includes(childProcessImport) || entrypointStart < 0) {
    throw new Error('release.mjs 테스트 하네스를 구성할 수 없습니다.')
  }

  const instrumentedSource = `${source
    .slice(0, entrypointStart)
    .replace(
      childProcessImport,
      'const spawnSync = globalThis.__FRONTRON_RELEASE_SPAWN_SYNC__',
    )}\nexport { assertNpmPublishAccess, dryRunPublishPackages, main, publishPackages, runPublishOrchestration, withPublishCandidates }\n`
  const root = mkdtempSync(join(tmpdir(), 'frontron-release-contract-'))
  const modulePath = join(root, 'release-under-test.mjs')

  writeFileSync(modulePath, instrumentedSource)
  ;(globalThis as Record<string, unknown>).__FRONTRON_RELEASE_SPAWN_SYNC__ = mockSpawnSync

  const module = (await import(
    /* @vite-ignore */ `${pathToFileURL(modulePath).href}?test=${Date.now()}`
  )) as ReleaseModule

  return { module, root }
}

// cleanGitOnlyHandler 함수는 publish 진입 가드보다 앞선 작업 트리 검사만 성공시킨다.
function cleanGitOnlyHandler(call: SpawnCall): SpawnResult {
  if (call.command === 'git' && call.args[0] === 'status') {
    return successfulSpawnResult()
  }

  return failUnexpectedSpawn(call)
}

// beforeAll 콜백은 실제 릴리스 로직을 한 번만 격리 로딩한다.
beforeAll(async () => {
  releaseHarness = await loadReleaseHarness()
})

// beforeEach 콜백은 명령 기록과 릴리스 환경을 테스트마다 초기화한다.
beforeEach(() => {
  spawnCalls.splice(0)
  spawnHandler = failUnexpectedSpawn
  clearReleaseEnvironment()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

// afterEach 콜백은 호스트 환경과 스파이를 원래 상태로 되돌린다.
afterEach(() => {
  for (const root of testCandidateRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }

  restoreReleaseEnvironment()
  vi.restoreAllMocks()
})

// afterAll 콜백은 격리 모듈과 전역 자식 프로세스 대역을 제거한다.
afterAll(() => {
  rmSync(releaseHarness.root, { recursive: true, force: true })
  delete (globalThis as Record<string, unknown>).__FRONTRON_RELEASE_SPAWN_SYNC__
})

test('release CLI requires an explicit canonical command', () => {
  const originalArgv = process.argv
  const modulePath = join(releaseHarness.root, 'release-under-test.mjs')

  try {
    process.argv = [process.execPath, modulePath]
    expect(() => releaseHarness.module.main()).toThrow('Missing release command')

    for (const alias of ['sync-dependency', 'auth', 'dry-run', 'release']) {
      process.argv = [process.execPath, modulePath, alias]
      expect(() => releaseHarness.module.main()).toThrow(`Unknown release command: ${alias}`)
    }
  } finally {
    process.argv = originalArgv
  }

  expect(spawnCalls).toHaveLength(0)
})

test('package prepublish tasks reject direct npm publish before building', () => {
  const packageRoots = [join(workspaceRoot, 'create-frontron'), join(workspaceRoot, 'frontron')]

  for (const packageRoot of packageRoots) {
    const result = spawnProcessSync(
      process.execPath,
      [join(packageRoot, 'scripts', 'tasks.mjs'), 'prepublishOnly'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: { ...process.env },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Direct npm publish is disabled')
    expect(result.stdout).not.toContain('Building')
  }
})

test('create-frontron tasks omit repository release wrappers', () => {
  const tasksSource = readFileSync(join(workspaceRoot, 'create-frontron/scripts/tasks.mjs'), 'utf8')

  for (const command of [
    'release:verify',
    'release:matrix-smoke',
    'release:package-manager-smoke',
    'version',
    'release',
  ]) {
    expect(tasksSource).not.toContain(`case '${command}'`)
  }
})

// 이 테스트는 공식 publish 진입점이 로컬 실행과 불완전한 OIDC 환경을 모두 차단하는지 확인한다.
test('official publish requires complete GitHub Actions OIDC credentials', () => {
  const originalArgv = process.argv
  const oidcEnvironment = {
    GITHUB_ACTIONS: 'true',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example.test/id-token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
  }
  process.argv = [process.execPath, join(releaseHarness.root, 'release-under-test.mjs'), 'publish']
  spawnHandler = cleanGitOnlyHandler

  try {
    expect(() => releaseHarness.module.main()).toThrow(
      'Official releases must run through .github/workflows/frontron-release.yml',
    )

    process.env.FRONTRON_TRUSTED_PUBLISHING = '1'

    expect(() => releaseHarness.module.main()).toThrow(
      'requires a GitHub-hosted Actions job with id-token: write',
    )

    // 이 반복 검증은 trusted publishing에 필요한 세 OIDC 값이 각각 필수인지 확인한다.
    for (const missingKey of Object.keys(oidcEnvironment) as Array<keyof typeof oidcEnvironment>) {
      Object.assign(process.env, oidcEnvironment)
      delete process.env[missingKey]
      expect(() => releaseHarness.module.assertNpmPublishAccess()).toThrow(
        'requires a GitHub-hosted Actions job with id-token: write',
      )
    }

    Object.assign(process.env, oidcEnvironment)
    expect(() => releaseHarness.module.assertNpmPublishAccess()).not.toThrow()
  } finally {
    process.argv = originalArgv
  }

  expect(getNpmCalls()).toHaveLength(0)
})

// 이 테스트는 재실행된 워크플로가 checkout 당시가 아닌 현재 origin/main과 HEAD를 비교하는지 확인한다.
test('release workflow requires the checked-out HEAD to equal current origin/main', () => {
  const workflow = readFileSync(
    join(workspaceRoot, '.github/workflows/frontron-release.yml'),
    'utf8',
  )
  const checkoutIndex = workflow.indexOf('- name: Checkout')
  const currentMainIndex = workflow.indexOf('- name: Require the current main commit')
  const publishIndex = workflow.indexOf('- name: Verify and publish both packages')

  expect(checkoutIndex).toBeGreaterThanOrEqual(0)
  expect(currentMainIndex).toBeGreaterThan(checkoutIndex)
  expect(publishIndex).toBeGreaterThan(currentMainIndex)
  expect(workflow).toContain(
    'git fetch --no-tags --force origin refs/heads/main:refs/remotes/origin/main',
  )
  expect(workflow).toContain(
    'test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)"',
  )
})

test('general CI keeps only release-specific verification after the matrix', () => {
  const releaseWorkflow = readFileSync(
    join(workspaceRoot, '.github/workflows/frontron-release.yml'),
    'utf8',
  )
  const ciWorkflow = readFileSync(join(workspaceRoot, '.github/workflows/frontron-ci.yml'), 'utf8')
  const releaseVerifyJob = ciWorkflow.slice(ciWorkflow.indexOf('  release-verify:'))

  expect(releaseWorkflow).not.toContain('run: npm ci')
  expect(releaseVerifyJob).not.toContain('node release.mjs verify')
  expect(releaseVerifyJob).toContain('node release.mjs check-metadata')
  expect(releaseVerifyJob.match(/npm audit --audit-level=moderate/g)).toHaveLength(2)
  expect(releaseVerifyJob.match(/npm run coverage/g)).toHaveLength(2)
  expect(releaseVerifyJob).toContain('npm run test:release-smoke')
})

test('generated template dependencies are audited and monitored', () => {
  const rehearsal = readFileSync(
    join(workspaceRoot, 'create-frontron/__tests__/release-rehearsal.spec.ts'),
    'utf8',
  )
  const dependabot = readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8')

  expect(rehearsal).toContain("runNpm(['audit', '--audit-level=moderate'], generatedAppRoot)")
  expect(dependabot).toContain('directory: /create-frontron/template')
})

// 이 테스트는 릴리스 필수 패키지 매니저 매트릭스가 major 범위 대신 정확 버전을 사용하는지 확인한다.
test('release-required package manager matrix uses exact versions', () => {
  const matrixScript = readFileSync(
    join(workspaceRoot, 'create-frontron/scripts/package-manager-matrix-smoke.mjs'),
    'utf8',
  )

  expect(matrixScript).toContain("FRONTRON_PM_MATRIX_NODE ?? 'node@22.23.1'")
  expect(matrixScript).toContain("FRONTRON_PM_MATRIX_PNPM ?? 'pnpm@11.4.0'")
  expect(matrixScript).toContain("FRONTRON_PM_MATRIX_YARN ?? '@yarnpkg/cli-dist@4.17.1'")
  expect(matrixScript).toContain("FRONTRON_PM_MATRIX_BUN ?? 'bun@1.3.14'")
})

// 이 테스트는 실제 npm pack 산출물 하나를 dry-run과 게시에 그대로 재사용하고 성공 후 정리하는지 확인한다.
test('actual pack tarballs are retained for both dry-run and publish', () => {
  const version = '1.2.3'
  const packedCandidates = new Map<string, PublishCandidate>()
  let retainedRoot = ''

  // 이 응답기는 실제 pack 파일을 만들고 두 publish 단계가 그 경로를 받는지 기록한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    if (args[0] === 'pack') {
      const packageName = call.cwd?.endsWith('create-frontron') ? 'create-frontron' : 'frontron'
      const destinationIndex = args.indexOf('--pack-destination')
      const candidateRoot = args[destinationIndex + 1]
      const filename = `${packageName}-${version}.tgz`
      const content = `${packageName}@${version} actual npm pack bytes`
      const tarballPath = join(candidateRoot, filename)
      retainedRoot ||= candidateRoot
      expect(candidateRoot).toBe(retainedRoot)
      expect(args).not.toContain('--dry-run')
      writeFileSync(tarballPath, content)
      const candidate = {
        name: packageName,
        version,
        tarballPath,
        integrity: calculateTestIntegrity(content),
      }
      packedCandidates.set(packageName, candidate)
      return successfulSpawnResult(JSON.stringify([{ ...candidate, filename }]))
    }

    if (args[0] === 'publish') {
      expect(existsSync(args[1])).toBe(true)
      return successfulSpawnResult()
    }

    const versionMatch = /^view (create-frontron|frontron)@1\.2\.3 version$/.exec(args.join(' '))

    if (versionMatch) {
      return failedSpawnResult('E404 No match found for version')
    }

    const integrityMatch = /^view (create-frontron|frontron)@1\.2\.3 dist\.integrity$/.exec(
      args.join(' '),
    )

    if (integrityMatch) {
      return successfulSpawnResult(packedCandidates.get(integrityMatch[1])?.integrity)
    }

    return failUnexpectedSpawn(call)
  }

  releaseHarness.module.withPublishCandidates(version, (candidates) => {
    expect(candidates.root).toBe(retainedRoot)
    releaseHarness.module.dryRunPublishPackages(version, candidates)
    releaseHarness.module.publishPackages(version, candidates)
  })

  const packCalls = getNpmCalls().filter(({ args }) => args[0] === 'pack')
  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  const createCandidate = packedCandidates.get('create-frontron') as PublishCandidate
  const frontronCandidate = packedCandidates.get('frontron') as PublishCandidate

  expect(packCalls).toHaveLength(2)
  expect(publishCalls.map(({ args }) => args)).toEqual([
    ['publish', createCandidate.tarballPath, '--dry-run', '--tag', 'frontron-staged'],
    ['publish', frontronCandidate.tarballPath, '--dry-run', '--tag', 'frontron-staged'],
    ['publish', createCandidate.tarballPath, '--tag', 'frontron-staged'],
    ['publish', frontronCandidate.tarballPath, '--tag', 'frontron-staged'],
  ])
  expect(
    getNpmCalls()
      .filter(({ args }) => args.at(-1) === 'dist.integrity')
      .map(({ args }) => args[1]),
  ).toEqual([`create-frontron@${version}`, `frontron@${version}`])
  expect(existsSync(retainedRoot)).toBe(false)
})

// 이 테스트는 dry-run 실패가 나도 보관한 실제 tarball 디렉터리를 정리하는지 확인한다.
test('retained tarballs are removed when dry-run fails', () => {
  const version = '1.2.3'
  let retainedRoot = ''

  // 이 응답기는 pack 두 개를 만든 뒤 첫 tarball dry-run만 실패시킨다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    if (args[0] === 'pack') {
      const packageName = call.cwd?.endsWith('create-frontron') ? 'create-frontron' : 'frontron'
      const candidateRoot = args[args.indexOf('--pack-destination') + 1]
      const filename = `${packageName}-${version}.tgz`
      const content = `${packageName} failed dry-run candidate`
      retainedRoot ||= candidateRoot
      writeFileSync(join(candidateRoot, filename), content)
      return successfulSpawnResult(
        JSON.stringify([
          {
            name: packageName,
            version,
            filename,
            integrity: calculateTestIntegrity(content),
          },
        ]),
      )
    }

    if (args[0] === 'publish' && args.includes('--dry-run')) {
      return failedSpawnResult('')
    }

    return failUnexpectedSpawn(call)
  }

  expect(() =>
    releaseHarness.module.withPublishCandidates(version, (candidates) => {
      releaseHarness.module.dryRunPublishPackages(version, candidates)
    }),
  ).toThrow('publish')
  expect(existsSync(retainedRoot)).toBe(false)
})

// 이 테스트는 두 번째 npm pack이 실패해도 먼저 만든 tarball과 후보 디렉터리를 정리하는지 확인한다.
test('retained tarballs are removed when candidate packing fails', () => {
  const version = '1.2.3'
  let retainedRoot = ''
  let packCount = 0

  // 이 응답기는 첫 tarball만 만든 뒤 두 번째 npm pack 실패를 재현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args || args[0] !== 'pack') {
      return failUnexpectedSpawn(call)
    }

    packCount += 1
    const candidateRoot = args[args.indexOf('--pack-destination') + 1]
    retainedRoot ||= candidateRoot

    if (packCount === 2) {
      return failedSpawnResult('')
    }

    const packageName = 'create-frontron'
    const filename = `${packageName}-${version}.tgz`
    const content = `${packageName} candidate before pack failure`
    writeFileSync(join(candidateRoot, filename), content)
    return successfulSpawnResult(
      JSON.stringify([
        {
          name: packageName,
          version,
          filename,
          integrity: calculateTestIntegrity(content),
        },
      ]),
    )
  }

  expect(() => releaseHarness.module.withPublishCandidates(version, () => undefined)).toThrow(
    'Unable to create the publish tarball for frontron',
  )
  expect(packCount).toBe(2)
  expect(existsSync(retainedRoot)).toBe(false)
})

// 이 테스트는 보관 이후 바뀐 tarball이 dry-run이나 외부 npm 호출에 도달하지 못하게 하는지 확인한다.
test('retained tarball mutation is rejected before dry-run', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const createCandidate = getTestCandidate(candidates, 'create-frontron')
  writeFileSync(createCandidate.tarballPath, 'mutated candidate bytes')

  expect(() => releaseHarness.module.dryRunPublishPackages(version, candidates)).toThrow(
    `Retained publish tarball changed for create-frontron@${version}`,
  )
  expect(spawnCalls).toHaveLength(0)
})

// 이 테스트는 이미 게시된 동일 tarball을 검증한 뒤 정확한 나머지 후보만 게시하는지 확인한다.
test('partial release resumes only after matching the retained candidate integrity', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const createCandidate = getTestCandidate(candidates, 'create-frontron')
  const frontronCandidate = getTestCandidate(candidates, 'frontron')

  // 이 응답기는 첫 패키지를 게시 완료 상태로, 두 번째 패키지를 미게시 상태로 표현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    switch (args.join(' ')) {
      case `view create-frontron@${version} version`:
        return successfulSpawnResult(version)
      case `view create-frontron@${version} dist.integrity`:
        return successfulSpawnResult(createCandidate.integrity)
      case `view frontron@${version} version`:
        return failedSpawnResult('E404 No match found for version')
      case `publish ${frontronCandidate.tarballPath} --tag frontron-staged`:
        return successfulSpawnResult()
      case `view frontron@${version} dist.integrity`:
        return successfulSpawnResult(frontronCandidate.integrity)
      default:
        return failUnexpectedSpawn(call)
    }
  }

  releaseHarness.module.publishPackages(version, candidates)

  expect(getNpmCalls().map(({ args }) => args)).toEqual([
    ['view', `create-frontron@${version}`, 'version'],
    ['view', `create-frontron@${version}`, 'dist.integrity'],
    ['view', `frontron@${version}`, 'version'],
    ['publish', frontronCandidate.tarballPath, '--tag', 'frontron-staged'],
    ['view', `frontron@${version}`, 'dist.integrity'],
  ])
  expect(getNpmCalls()[3]?.call.cwd).toBe(join(releaseHarness.root, 'frontron'))
})

// 이 테스트는 부분 재개 후보와 registry integrity가 다르면 후속 게시를 거부하는지 확인한다.
test('partial release rejects a published package with different integrity', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)

  // 이 응답기는 이미 게시된 첫 패키지의 integrity 불일치를 재현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    switch (args.join(' ')) {
      case `view create-frontron@${version} version`:
        return successfulSpawnResult(version)
      case `view create-frontron@${version} dist.integrity`:
        return successfulSpawnResult('sha512-published-package')
      case `view frontron@${version} version`:
        return failedSpawnResult('E404 No match found for version')
      default:
        return failUnexpectedSpawn(call)
    }
  }

  expect(() => releaseHarness.module.publishPackages(version, candidates)).toThrow(
    'registry integrity does not match the retained local release candidate tarball',
  )
  expect(getNpmCalls().some(({ args }) => args[0] === 'publish')).toBe(false)
})

// 이 테스트는 신규 게시 직후 registry integrity가 다르면 다음 패키지 게시 전에 실패하는지 확인한다.
test('new publish rejects a registry integrity mismatch before continuing', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const publishedPackages = new Set<string>()

  // 이 응답기는 첫 후보 게시 성공 뒤 registry가 다른 tarball integrity를 반환하게 한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    const command = args.join(' ')
    const versionMatch = /^view (create-frontron|frontron)@1\.2\.3 version$/.exec(command)

    if (versionMatch) {
      return publishedPackages.has(versionMatch[1])
        ? successfulSpawnResult(version)
        : failedSpawnResult('E404 No match found for version')
    }

    if (args[0] === 'publish') {
      publishedPackages.add('create-frontron')
      return successfulSpawnResult()
    }

    if (command === `view create-frontron@${version} dist.integrity`) {
      return successfulSpawnResult('sha512-different-published-bytes')
    }

    return failUnexpectedSpawn(call)
  }

  expect(() => releaseHarness.module.publishPackages(version, candidates)).toThrow(
    'registry integrity does not match the retained local release candidate tarball',
  )
  expect(getNpmCalls().filter(({ args }) => args[0] === 'publish')).toHaveLength(1)
})

// 이 테스트는 첫 게시의 부분 실패 후 같은 후보로 이미 게시된 패키지를 검증하고 나머지만 재시도하는지 확인한다.
test('partial publish failure retries only the remaining retained candidate', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const publishedPackages = new Set<string>()
  let failFrontronPublish = true

  // 이 응답기는 create-frontron 게시 후 frontron만 한 번 실패하는 레지스트리 상태를 재현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    const command = args.join(' ')
    const versionMatch = /^view (create-frontron|frontron)@1\.2\.3 version$/.exec(command)

    if (versionMatch) {
      return publishedPackages.has(versionMatch[1])
        ? successfulSpawnResult(version)
        : failedSpawnResult('E404 No match found for version')
    }

    const integrityMatch = /^view (create-frontron|frontron)@1\.2\.3 dist\.integrity$/.exec(command)

    if (integrityMatch) {
      return successfulSpawnResult(getTestCandidate(candidates, integrityMatch[1]).integrity)
    }

    if (args[0] === 'publish') {
      const packageName =
        args[1] === getTestCandidate(candidates, 'create-frontron').tarballPath
          ? 'create-frontron'
          : 'frontron'

      if (packageName === 'frontron' && failFrontronPublish) {
        failFrontronPublish = false
        return failedSpawnResult('')
      }

      publishedPackages.add(packageName)
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  expect(() => releaseHarness.module.publishPackages(version, candidates)).toThrow(
    'Publish failed after create-frontron published and no packages skipped',
  )

  releaseHarness.module.publishPackages(version, candidates)

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ args }) => args[1])).toEqual([
    getTestCandidate(candidates, 'create-frontron').tarballPath,
    getTestCandidate(candidates, 'frontron').tarballPath,
    getTestCandidate(candidates, 'frontron').tarballPath,
  ])
  expect(publishedPackages).toEqual(new Set(['create-frontron', 'frontron']))
})

// 이 테스트는 로컬 emergency 게시가 보관 후보, staging tag, 패키지 순서와 guard를 지키는지 확인한다.
test('local publishing uses retained tarballs and staging without provenance', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const guardFiles: string[] = []

  // 이 응답기는 두 패키지가 아직 게시되지 않은 로컬 token 게시를 표현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    if (args[0] === 'view' && args.at(-1) === 'version') {
      return failedSpawnResult('E404 No match found for version')
    }

    if (args[0] === 'view' && args.at(-1) === 'dist.integrity') {
      return successfulSpawnResult(getTestCandidate(candidates, args[1].split('@')[0]).integrity)
    }

    if (args[0] === 'publish') {
      const token = call.env?.FRONTRON_RELEASE_PUBLISH_TOKEN
      const tokenPath = call.env?.FRONTRON_RELEASE_PUBLISH_TOKEN_FILE

      expect(token).toMatch(/^[a-f0-9]{64}$/)
      expect(tokenPath).toBeTypeOf('string')
      expect(readFileSync(tokenPath as string, 'utf8')).toBe(token)
      guardFiles.push(tokenPath as string)
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  releaseHarness.module.publishPackages(version, candidates)

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ args }) => args)).toEqual([
    [
      'publish',
      getTestCandidate(candidates, 'create-frontron').tarballPath,
      '--tag',
      'frontron-staged',
    ],
    ['publish', getTestCandidate(candidates, 'frontron').tarballPath, '--tag', 'frontron-staged'],
  ])
  expect(publishCalls.map(({ call }) => call.cwd)).toEqual([
    join(releaseHarness.root, 'create-frontron'),
    join(releaseHarness.root, 'frontron'),
  ])
  expect(guardFiles).toHaveLength(2)
  expect(guardFiles.every((path) => !existsSync(path))).toBe(true)
})

// 이 테스트는 trusted publishing이 보관 후보 두 개 모두에 provenance와 public access를 강제하는지 확인한다.
test('trusted publishing adds provenance to both retained tarballs', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  process.env.FRONTRON_TRUSTED_PUBLISHING = '1'

  // 이 응답기는 두 패키지가 아직 게시되지 않은 trusted publishing 실행을 표현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    if (args[0] === 'view' && args.at(-1) === 'version') {
      return failedSpawnResult('E404 No match found for version')
    }

    if (args[0] === 'view' && args.at(-1) === 'dist.integrity') {
      return successfulSpawnResult(getTestCandidate(candidates, args[1].split('@')[0]).integrity)
    }

    if (args[0] === 'publish') {
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  releaseHarness.module.publishPackages(version, candidates, 'latest')

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ args }) => args)).toEqual([
    [
      'publish',
      getTestCandidate(candidates, 'create-frontron').tarballPath,
      '--tag',
      'latest',
      '--provenance',
      '--access',
      'public',
    ],
    [
      'publish',
      getTestCandidate(candidates, 'frontron').tarballPath,
      '--tag',
      'latest',
      '--provenance',
      '--access',
      'public',
    ],
  ])
  expect(publishCalls.map(({ call }) => call.cwd)).toEqual([
    join(releaseHarness.root, 'create-frontron'),
    join(releaseHarness.root, 'frontron'),
  ])
})

// 이 테스트는 trusted 오케스트레이션이 게시 검증, provenance 검증, 설치 검증 순서로 끝나는지 확인한다.
test('trusted publish orchestration verifies provenance before registry install', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const operations = {
    promotePackagesToLatest: vi.fn(),
    publishPackages: vi.fn(),
    setDistTagForPackages: vi.fn(),
    verifyPublishedPackages: vi.fn(),
    verifyPublishedProvenance: vi.fn(),
    verifyRegistryInstall: vi.fn(),
  }
  process.env.FRONTRON_TRUSTED_PUBLISHING = '1'

  releaseHarness.module.runPublishOrchestration(version, candidates, operations)

  expect(operations.publishPackages).toHaveBeenCalledWith(version, candidates, 'latest')
  expect(operations.verifyPublishedPackages).toHaveBeenCalledWith(version)
  expect(operations.verifyPublishedProvenance).toHaveBeenCalledWith(version)
  expect(operations.verifyRegistryInstall).toHaveBeenCalledWith(version)
  expect(operations.setDistTagForPackages).not.toHaveBeenCalled()
  expect(operations.promotePackagesToLatest).not.toHaveBeenCalled()
  const invocationOrder = [
    operations.publishPackages.mock.invocationCallOrder[0],
    operations.verifyPublishedPackages.mock.invocationCallOrder[0],
    operations.verifyPublishedProvenance.mock.invocationCallOrder[0],
    operations.verifyRegistryInstall.mock.invocationCallOrder[0],
  ]
  expect(invocationOrder).toEqual([...invocationOrder].sort((left, right) => left - right))
})

// 이 테스트는 로컬 오케스트레이션이 staging 검증 후에만 latest로 승격하고 다시 검증하는지 확인한다.
test('local publish orchestration verifies staging before latest promotion', () => {
  const version = '1.2.3'
  const candidates = createTestPublishCandidates(version)
  const operations = {
    promotePackagesToLatest: vi.fn(),
    publishPackages: vi.fn(),
    setDistTagForPackages: vi.fn(),
    verifyPublishedPackages: vi.fn(),
    verifyPublishedProvenance: vi.fn(),
    verifyRegistryInstall: vi.fn(),
  }

  releaseHarness.module.runPublishOrchestration(version, candidates, operations)

  expect(operations.publishPackages).toHaveBeenCalledWith(version, candidates, 'frontron-staged')
  expect(operations.setDistTagForPackages).toHaveBeenCalledWith(version, 'frontron-staged')
  expect(operations.verifyPublishedPackages).toHaveBeenNthCalledWith(1, version, 'frontron-staged')
  expect(operations.verifyRegistryInstall).toHaveBeenCalledTimes(2)
  expect(operations.promotePackagesToLatest).toHaveBeenCalledWith(version)
  expect(operations.verifyPublishedPackages).toHaveBeenNthCalledWith(2, version)
  expect(operations.verifyPublishedProvenance).not.toHaveBeenCalled()

  const invocationOrder = [
    operations.publishPackages.mock.invocationCallOrder[0],
    operations.setDistTagForPackages.mock.invocationCallOrder[0],
    operations.verifyPublishedPackages.mock.invocationCallOrder[0],
    operations.verifyRegistryInstall.mock.invocationCallOrder[0],
    operations.promotePackagesToLatest.mock.invocationCallOrder[0],
    operations.verifyPublishedPackages.mock.invocationCallOrder[1],
    operations.verifyRegistryInstall.mock.invocationCallOrder[1],
  ]
  expect(invocationOrder).toEqual([...invocationOrder].sort((left, right) => left - right))
})
