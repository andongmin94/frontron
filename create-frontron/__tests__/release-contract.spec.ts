import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

interface SpawnCall {
  command: string
  args: string[]
  cwd?: string
}

interface SpawnResult {
  status: number
  stdout: string
  stderr: string
}

interface ReleaseModule {
  assertNpmPublishAccess(): void
  main(): void
  publishPackages(version: string, tag?: string): void
  runPublishOrchestration(version: string, operations: PublishOperations): void
}

interface ReleaseHarness {
  module: ReleaseModule
  root: string
}

type SpawnHandler = (call: SpawnCall) => SpawnResult

interface PublishOperations {
  promotePackagesToLatest(version: string): void
  publishPackages(version: string, tag?: string): void
  setDistTagForPackages(version: string, tag: string): void
  verifyPublishedPackages(version: string, tag?: string): void
  verifyPublishedProvenance(version: string): void
  verifyRegistryInstall(version: string): void
}

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(createPackageRoot)
const releaseEnvironmentKeys = [
  'FRONTRON_TRUSTED_PUBLISHING',
  'FRONTRON_ALLOW_LOCAL_PUBLISH',
  'GITHUB_ACTIONS',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
] as const
const originalReleaseEnvironment = new Map<string, string | undefined>()
const spawnCalls: SpawnCall[] = []
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
  options: { cwd?: string } = {},
): SpawnResult {
  const call = { command, args: [...args], cwd: options.cwd }
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
    )}\nexport { assertNpmPublishAccess, main, publishPackages, runPublishOrchestration }\n`
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
  restoreReleaseEnvironment()
  vi.restoreAllMocks()
})

// afterAll 콜백은 격리 모듈과 전역 자식 프로세스 대역을 제거한다.
afterAll(() => {
  rmSync(releaseHarness.root, { recursive: true, force: true })
  delete (globalThis as Record<string, unknown>).__FRONTRON_RELEASE_SPAWN_SYNC__
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

// 이 테스트는 이미 게시된 동일 tarball을 검증한 뒤 나머지 패키지만 게시하는지 확인한다.
test('partial release resumes only after matching the published package integrity', () => {
  const version = '1.2.3'
  const integrity = 'sha512-identical-release-candidate'

  // 이 응답기는 첫 패키지를 게시 완료 상태로, 두 번째 패키지를 미게시 상태로 표현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    switch (args.join(' ')) {
      case `view create-frontron@${version} version`:
        return successfulSpawnResult(version)
      case 'pack --json --dry-run --ignore-scripts':
        return successfulSpawnResult(JSON.stringify([{ integrity }]))
      case `view create-frontron@${version} dist.integrity`:
        return successfulSpawnResult(integrity)
      case `view frontron@${version} version`:
        return failedSpawnResult('E404 No match found for version')
      case 'publish --tag frontron-staged':
        return successfulSpawnResult()
      default:
        return failUnexpectedSpawn(call)
    }
  }

  releaseHarness.module.publishPackages(version)

  const npmCalls = getNpmCalls()
  expect(npmCalls.map(({ args }) => args)).toEqual([
    ['view', `create-frontron@${version}`, 'version'],
    ['pack', '--json', '--dry-run', '--ignore-scripts'],
    ['view', `create-frontron@${version}`, 'dist.integrity'],
    ['view', `frontron@${version}`, 'version'],
    ['publish', '--tag', 'frontron-staged'],
  ])
  expect(npmCalls.at(-1)?.call.cwd).toBe(join(releaseHarness.root, 'frontron'))
})

// 이 테스트는 레지스트리와 로컬 tarball의 integrity가 다르면 재개와 publish를 모두 거부하는지 확인한다.
test('partial release rejects a published package with different integrity', () => {
  const version = '1.2.3'

  // 이 응답기는 이미 게시된 첫 패키지의 integrity 불일치를 재현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    switch (args.join(' ')) {
      case `view create-frontron@${version} version`:
        return successfulSpawnResult(version)
      case 'pack --json --dry-run --ignore-scripts':
        return successfulSpawnResult(
          JSON.stringify([{ integrity: 'sha512-local-release-candidate' }]),
        )
      case `view create-frontron@${version} dist.integrity`:
        return successfulSpawnResult('sha512-published-package')
      case `view frontron@${version} version`:
        return failedSpawnResult('E404 No match found for version')
      case 'publish --tag frontron-staged':
        return successfulSpawnResult()
      default:
        return failUnexpectedSpawn(call)
    }
  }

  expect(() => releaseHarness.module.publishPackages(version)).toThrow(
    'registry integrity does not match the local release candidate',
  )
  expect(getNpmCalls().some(({ args }) => args[0] === 'publish')).toBe(false)
})

// 이 테스트는 첫 게시의 부분 실패를 보고하고 재시도 시 이미 게시된 동일 패키지를 검증해 건너뛰는지 확인한다.
test('partial publish failure retries only the remaining package', () => {
  const version = '1.2.3'
  const integrity = 'sha512-retry-release-candidate'
  const publishedPackages = new Set<string>()
  let failFrontronPublish = true

  // 이 응답기는 create-frontron 게시 후 frontron만 한 번 실패하는 레지스트리 상태를 재현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    const command = args.join(' ')

    if (command === 'pack --json --dry-run --ignore-scripts') {
      return successfulSpawnResult(JSON.stringify([{ integrity }]))
    }

    if (command === `view create-frontron@${version} dist.integrity`) {
      return successfulSpawnResult(integrity)
    }

    const versionMatch = /^view (create-frontron|frontron)@1\.2\.3 version$/.exec(command)

    if (versionMatch) {
      return publishedPackages.has(versionMatch[1])
        ? successfulSpawnResult(version)
        : failedSpawnResult('E404 No match found for version')
    }

    if (command === 'publish --tag frontron-staged') {
      const packageName = call.cwd?.endsWith('create-frontron') ? 'create-frontron' : 'frontron'

      if (packageName === 'frontron' && failFrontronPublish) {
        failFrontronPublish = false
        return failedSpawnResult('')
      }

      publishedPackages.add(packageName)
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  expect(() => releaseHarness.module.publishPackages(version)).toThrow(
    'Publish failed after create-frontron published and no packages skipped',
  )

  releaseHarness.module.publishPackages(version)

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ call }) => call.cwd)).toEqual([
    join(releaseHarness.root, 'create-frontron'),
    join(releaseHarness.root, 'frontron'),
    join(releaseHarness.root, 'frontron'),
  ])
  expect(publishedPackages).toEqual(new Set(['create-frontron', 'frontron']))
})

// 이 테스트는 로컬 emergency 게시가 staging tag와 패키지 순서를 지키고 provenance를 넣지 않는지 확인한다.
test('local publishing uses staging without provenance in package order', () => {
  const version = '1.2.3'

  // 이 응답기는 두 패키지가 아직 게시되지 않은 로컬 token 게시를 표현한다.
  spawnHandler = (call) => {
    const args = getNpmArgs(call)

    if (!args) {
      return failUnexpectedSpawn(call)
    }

    if (args[0] === 'view' && args.at(-1) === 'version') {
      return failedSpawnResult('E404 No match found for version')
    }

    if (args[0] === 'publish') {
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  releaseHarness.module.publishPackages(version)

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ args }) => args)).toEqual([
    ['publish', '--tag', 'frontron-staged'],
    ['publish', '--tag', 'frontron-staged'],
  ])
  expect(publishCalls.map(({ call }) => call.cwd)).toEqual([
    join(releaseHarness.root, 'create-frontron'),
    join(releaseHarness.root, 'frontron'),
  ])
})

// 이 테스트는 trusted publishing이 두 패키지 모두에 provenance와 public access를 강제하는지 확인한다.
test('trusted publishing adds provenance to both package publishes', () => {
  const version = '1.2.3'
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

    if (args[0] === 'publish') {
      return successfulSpawnResult()
    }

    return failUnexpectedSpawn(call)
  }

  releaseHarness.module.publishPackages(version, 'latest')

  const publishCalls = getNpmCalls().filter(({ args }) => args[0] === 'publish')
  expect(publishCalls.map(({ args }) => args)).toEqual([
    ['publish', '--tag', 'latest', '--provenance', '--access', 'public'],
    ['publish', '--tag', 'latest', '--provenance', '--access', 'public'],
  ])
  expect(publishCalls.map(({ call }) => call.cwd)).toEqual([
    join(releaseHarness.root, 'create-frontron'),
    join(releaseHarness.root, 'frontron'),
  ])
})

// 이 테스트는 trusted 오케스트레이션이 게시 검증, provenance 검증, 설치 검증 순서로 끝나는지 확인한다.
test('trusted publish orchestration verifies provenance before registry install', () => {
  const version = '1.2.3'
  const operations = {
    promotePackagesToLatest: vi.fn(),
    publishPackages: vi.fn(),
    setDistTagForPackages: vi.fn(),
    verifyPublishedPackages: vi.fn(),
    verifyPublishedProvenance: vi.fn(),
    verifyRegistryInstall: vi.fn(),
  }
  process.env.FRONTRON_TRUSTED_PUBLISHING = '1'

  releaseHarness.module.runPublishOrchestration(version, operations)

  expect(operations.publishPackages).toHaveBeenCalledWith(version, 'latest')
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
  const operations = {
    promotePackagesToLatest: vi.fn(),
    publishPackages: vi.fn(),
    setDistTagForPackages: vi.fn(),
    verifyPublishedPackages: vi.fn(),
    verifyPublishedProvenance: vi.fn(),
    verifyRegistryInstall: vi.fn(),
  }

  releaseHarness.module.runPublishOrchestration(version, operations)

  expect(operations.publishPackages).toHaveBeenCalledWith(version, 'frontron-staged')
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
