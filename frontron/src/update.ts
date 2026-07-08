import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { MANIFEST_PATH, readManifest } from './init/manifest'
import { runInit, type InitContext, type InitOptions } from './init'
import { isInsideDirectory } from './project-paths'

// inferDesktopDirFromManifest 함수는 manifest의 생성 파일 목록에서 Electron 소스 디렉터리를 추론한다.
function inferDesktopDirFromManifest(manifest: NonNullable<ReturnType<typeof readManifest>>) {
  const mainFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/main.ts'))

  if (!mainFile) {
    return undefined
  }

  const directory = mainFile.slice(0, -'/main.ts'.length)

  return directory || undefined
}

// stripPackageGlob 함수는 패키징 glob에서 원래 디렉터리 경로를 분리한다.
function stripPackageGlob(value: string) {
  return value.endsWith('{,/**/*}') ? value.slice(0, -'{,/**/*}'.length) : value
}

// inferOutDirFromManifest 함수는 manifest의 package.json 소유권 기록에서 렌더러 출력 경로를 추론한다.
function inferOutDirFromManifest(manifest: NonNullable<ReturnType<typeof readManifest>>) {
  for (const claim of manifest.packageJsonClaims ?? []) {
    if (
      claim.path !== 'build.files' ||
      claim.action !== 'array-value' ||
      typeof claim.value !== 'string'
    ) {
      continue
    }

    const outDir = stripPackageGlob(claim.value)

    if (outDir !== 'dist-electron' && outDir !== 'package.json') {
      return outDir
    }
  }

  return undefined
}

// readServeSource 함수는 manifest가 가리키는 생성된 serve.ts 원문을 안전하게 읽는다.
function readServeSource(cwd: string, manifest: NonNullable<ReturnType<typeof readManifest>>) {
  const serveFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/serve.ts'))

  if (!serveFile) {
    return null
  }

  if (isAbsolute(serveFile)) {
    throw new Error(`Manifest serve entry must be relative: ${serveFile}`)
  }

  const root = resolve(cwd)
  const servePath = resolve(root, serveFile)

  // update는 기존 manifest를 신뢰하되, 파일을 읽기 전에는 항상 프로젝트 안쪽인지 확인한다.
  // 악의적이거나 손상된 manifest가 프로젝트 밖의 파일을 읽게 만들면 안 된다.
  if (!isInsideDirectory(root, servePath)) {
    throw new Error(`Manifest serve entry points outside the project: ${serveFile}`)
  }

  return existsSync(servePath) ? readFileSync(servePath, 'utf8') : null
}

// readEmbeddedJson 함수는 생성된 serve.ts에 박힌 JSON 상수 값을 읽는다.
function readEmbeddedJson(source: string | null, name: string) {
  const match = source?.match(
    new RegExp(`const ${name} = readEmbeddedJson<[^>]+>\\((\"(?:\\\\.|[^\"])*\")\\)`),
  )
  const encodedValue = match?.[1]

  if (!encodedValue) {
    return undefined
  }

  try {
    return JSON.parse(JSON.parse(encodedValue)) as unknown
  } catch {
    return undefined
  }
}

// readEmbeddedString 함수는 생성된 serve.ts에서 문자열 상수 값을 읽는다.
function readEmbeddedString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)

  return typeof value === 'string' ? value : undefined
}

// readEmbeddedNullableString 함수는 생성된 serve.ts에서 문자열 또는 null 상수 값을 읽는다.
function readEmbeddedNullableString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)

  return value === null || typeof value === 'string' ? value : undefined
}

// createManifestOptions 함수는 기존 manifest와 생성된 serve.ts에서 update에 재사용할 init 옵션을 복원한다.
function createManifestOptions(
  manifest: NonNullable<ReturnType<typeof readManifest>>,
  cwd: string,
): Partial<InitOptions> {
  const serveSource = readServeSource(cwd, manifest)

  return {
    adapter: manifest.adapter,
    preset: manifest.preset,
    desktopDir: manifest.desktopDir ?? inferDesktopDirFromManifest(manifest),
    appScript: manifest.appScript ?? manifest.scripts[0],
    buildScript: manifest.buildScript ?? manifest.scripts[1],
    packageScript: manifest.packageScript ?? manifest.scripts[2],
    webDevScript: manifest.webDevScript ?? readEmbeddedString(serveSource, 'WEB_DEV_SCRIPT'),
    webBuildScript: manifest.webBuildScript,
    outDir:
      manifest.outDir ??
      readEmbeddedString(serveSource, 'WEB_OUT_DIR') ??
      inferOutDirFromManifest(manifest),
    serverRoot:
      manifest.nodeServerSourceRoot ??
      readEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT') ??
      undefined,
    serverEntry:
      manifest.nodeServerEntry ??
      readEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY') ??
      undefined,
    productName: manifest.productName,
    appId: manifest.appId,
  }
}

// runUpdate 함수는 manifest 설정을 바탕으로 Frontron 생성 파일과 설정을 갱신한다.
export async function runUpdate(options: InitOptions, context: InitContext) {
  const manifest = readManifest(context.cwd)

  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Run "frontron init" before update.`)
  }

  const shouldApply = options.yes && !options.dryRun
  const manifestOptions = createManifestOptions(manifest, context.cwd)
  const exitCode = await runInit(
    {
      ...manifestOptions,
      ...options,
      yes: true,
      force: true,
      dryRun: !shouldApply,
    },
    context,
  )

  if (!shouldApply && exitCode === 0) {
    context.output.info('')
    context.output.info('Run "frontron update --yes" to apply this plan.')
  }

  return exitCode
}
