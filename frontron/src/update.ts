import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { createFileHash, MANIFEST_PATH, readManifest } from './init/manifest'
import { runInit, type InitContext, type InitOptions } from './init'
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
  isInsideDirectory,
} from './project-paths'

type Manifest = NonNullable<ReturnType<typeof readManifest>>

// hasOwnString 함수는 객체가 특정 문자열 키를 직접 가지고 있는지 확인한다.
function hasOwnString(record: Record<string, string> | undefined, key: string) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key))
}

// resolveManifestProjectFile 함수는 manifest 파일 항목을 링크 없는 프로젝트 내부 경로로 해석한다.
function resolveManifestProjectFile(cwd: string, filePath: string, label: string) {
  if (isAbsolute(filePath)) {
    throw new Error(`${label} must be relative: ${filePath}`)
  }

  const root = resolve(cwd)
  const absolutePath = resolve(root, filePath)

  if (!isInsideDirectory(root, absolutePath) || absolutePath === root) {
    throw new Error(`${label} points outside the project: ${filePath}`)
  }

  const inspection = inspectProjectPath(root, absolutePath)

  if (!inspection.safe) {
    throw new Error(formatProjectPathBlocker(root, `${label} (${filePath})`, inspection))
  }

  return absolutePath
}

// collectUpdateLocalEditBlockers 함수는 강제 갱신 전에 manifest 기준과 다른 로컬 파일과 script를 찾는다.
function collectUpdateLocalEditBlockers(cwd: string, manifest: Manifest) {
  const blockers: string[] = []
  const packageJsonPath = resolve(cwd, 'package.json')

  assertProjectPathSafe(cwd, packageJsonPath, 'package.json')

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>
  }

  for (const filePath of new Set(manifest.createdFiles)) {
    if (filePath === MANIFEST_PATH) {
      continue
    }

    const label = filePath.endsWith('/serve.ts') ? 'Manifest serve entry' : 'Manifest file entry'
    const absolutePath = resolveManifestProjectFile(cwd, filePath, label)

    if (!existsSync(absolutePath)) {
      continue
    }

    const stats = lstatSync(absolutePath)

    if (!stats.isFile()) {
      throw new Error(`Manifest file entry is not a regular file: ${filePath}`)
    }

    const expectedHash = manifest.fileHashes?.[filePath]

    if (!expectedHash) {
      blockers.push(`Manifest-owned file has no recorded hash: ${filePath}`)
      continue
    }

    if (createFileHash(readFileSync(absolutePath)) !== expectedHash) {
      blockers.push(`Manifest-owned file has local edits: ${filePath}`)
    }
  }

  for (const scriptName of new Set(manifest.scripts)) {
    if (!hasOwnString(packageJson.scripts, scriptName)) {
      continue
    }

    if (!hasOwnString(manifest.scriptCommands, scriptName)) {
      blockers.push(`Manifest-owned script has no recorded command: ${scriptName}`)
      continue
    }

    if (packageJson.scripts?.[scriptName] !== manifest.scriptCommands?.[scriptName]) {
      blockers.push(`Manifest-owned script has local edits: ${scriptName}`)
    }
  }

  return blockers
}

// inferDesktopDirFromManifest 함수는 manifest의 생성 파일 목록에서 Electron 소스 디렉터리를 추론한다.
function inferDesktopDirFromManifest(manifest: Manifest) {
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
function inferOutDirFromManifest(manifest: Manifest) {
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
function readServeSource(cwd: string, manifest: Manifest) {
  const serveFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/serve.ts'))

  if (!serveFile) {
    return null
  }

  const servePath = resolveManifestProjectFile(cwd, serveFile, 'Manifest serve entry')

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
function createManifestOptions(manifest: Manifest, cwd: string): Partial<InitOptions> {
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
  const manifestPath = resolve(context.cwd, MANIFEST_PATH)

  assertProjectPathSafe(context.cwd, manifestPath, 'Frontron manifest')

  const manifest = readManifest(context.cwd)

  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Run "frontron init" before update.`)
  }

  const localEditBlockers = collectUpdateLocalEditBlockers(context.cwd, manifest)

  if (localEditBlockers.length > 0 && !options.force) {
    throw new Error(
      `Update aborted because manifest-owned local changes would be overwritten: ${localEditBlockers.join('; ')}. Re-run with --force to replace them.`,
    )
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
