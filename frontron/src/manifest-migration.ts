import { existsSync, readFileSync } from 'node:fs'

import type { InitOptions } from './init/shared'
import type { FrontronManifest, LegacyFrontronManifest } from './init/manifest'
import { resolveManagedProjectFile } from './managed-state'

// 예전 manifest의 생성 파일 목록에서 Electron 소스 디렉터리를 추론한다.
function inferDesktopDir(manifest: LegacyFrontronManifest) {
  const mainFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/main.ts'))
  if (!mainFile) return undefined

  return mainFile.slice(0, -'/main.ts'.length) || undefined
}

// electron-builder의 디렉터리 glob에서 원래 출력 디렉터리를 분리한다.
function stripPackageGlob(value: string) {
  return value.endsWith('{,/**/*}') ? value.slice(0, -'{,/**/*}'.length) : value
}

// 예전 package.json 소유권 기록에서 웹 출력 디렉터리를 추론한다.
function inferOutDir(manifest: LegacyFrontronManifest) {
  for (const claim of manifest.packageJsonClaims ?? []) {
    if (
      claim.path !== 'build.files' ||
      claim.action !== 'array-value' ||
      typeof claim.value !== 'string'
    ) {
      continue
    }

    const outDir = stripPackageGlob(claim.value)
    if (outDir !== 'dist-electron' && outDir !== 'package.json') return outDir
  }

  return undefined
}

// v1에서 설정 저장소 역할도 했던 생성 serve.ts를 안전한 프로젝트 경로에서 읽는다.
function readLegacyServeSource(cwd: string, manifest: LegacyFrontronManifest) {
  const serveFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/serve.ts'))
  if (!serveFile) return null

  const resolved = resolveManagedProjectFile(cwd, serveFile, 'Manifest serve entry')
  if (resolved.state === 'unsafe') throw new Error(resolved.blocker)

  return existsSync(resolved.absolutePath) ? readFileSync(resolved.absolutePath, 'utf8') : null
}

// v1 serve.ts에 JSON 문자열로 박혀 있던 설정 하나를 복원한다.
function readEmbeddedJson(source: string | null, name: string) {
  const match = source?.match(
    new RegExp(`const ${name} = readEmbeddedJson<[^>]+>\\(("(?:\\\\.|[^"])*")\\)`),
  )
  const encodedValue = match?.[1]
  if (!encodedValue) return undefined

  try {
    return JSON.parse(JSON.parse(encodedValue)) as unknown
  } catch {
    return undefined
  }
}

// v1 serve.ts의 문자열 설정을 타입이 맞을 때만 반환한다.
function readEmbeddedString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)
  return typeof value === 'string' ? value : undefined
}

// v1 serve.ts의 문자열 또는 null 설정을 타입이 맞을 때만 반환한다.
function readEmbeddedNullableString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)
  return value === null || typeof value === 'string' ? value : undefined
}

// v1 manifest의 선택 필드와 생성 소스에서 최신 init 옵션을 복원한다.
function createLegacyManifestOptions(manifest: LegacyFrontronManifest, cwd: string) {
  const serveSource = readLegacyServeSource(cwd, manifest)

  return {
    adapter: manifest.adapter,
    desktopDir: manifest.desktopDir ?? inferDesktopDir(manifest),
    appScript: manifest.appScript ?? manifest.scripts[0],
    buildScript: manifest.buildScript ?? manifest.scripts[1],
    packageScript: manifest.packageScript ?? manifest.scripts[2],
    webDevScript: manifest.webDevScript ?? readEmbeddedString(serveSource, 'WEB_DEV_SCRIPT'),
    webBuildScript: manifest.webBuildScript,
    outDir:
      manifest.outDir ?? readEmbeddedString(serveSource, 'WEB_OUT_DIR') ?? inferOutDir(manifest),
    serverRoot:
      manifest.nodeServerSourceRoot ??
      readEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT') ??
      undefined,
    serverEntry:
      manifest.adapter === 'remix-node-server'
        ? undefined
        : (manifest.nodeServerEntry ??
          readEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY') ??
          undefined),
    productName: manifest.productName,
    appId: manifest.appId,
  } satisfies Partial<InitOptions>
}

// v2는 manifest 자체만 사용하고, v1에 한해서만 생성 소스 기반 마이그레이션을 수행한다.
export function createManifestInitOptions(
  manifest: FrontronManifest,
  cwd: string,
): Partial<InitOptions> {
  if (manifest.schemaVersion === 1) return createLegacyManifestOptions(manifest, cwd)

  return {
    adapter: manifest.adapter,
    desktopDir: manifest.desktopDir,
    appScript: manifest.appScript,
    buildScript: manifest.buildScript,
    packageScript: manifest.packageScript,
    webDevScript: manifest.webDevScript,
    webBuildScript: manifest.webBuildScript,
    outDir: manifest.outDir,
    serverRoot: manifest.nodeServerSourceRoot ?? undefined,
    serverEntry:
      manifest.adapter === 'remix-node-server'
        ? (manifest.nodeServerSourceEntry ?? undefined)
        : (manifest.nodeServerEntry ?? undefined),
    productName: manifest.productName,
    appId: manifest.appId,
  }
}
