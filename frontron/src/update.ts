import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MANIFEST_PATH, readManifest } from './init/manifest'
import { runInit, type InitContext, type InitOptions } from './init'

function inferDesktopDirFromManifest(manifest: NonNullable<ReturnType<typeof readManifest>>) {
  const mainFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/main.ts'))

  if (!mainFile) {
    return undefined
  }

  const directory = mainFile.slice(0, -'/main.ts'.length)

  return directory || undefined
}

function stripPackageGlob(value: string) {
  return value.endsWith('{,/**/*}') ? value.slice(0, -'{,/**/*}'.length) : value
}

function inferOutDirFromManifest(manifest: NonNullable<ReturnType<typeof readManifest>>) {
  for (const claim of manifest.packageJsonClaims ?? []) {
    if (claim.path !== 'build.files' || claim.action !== 'array-value' || typeof claim.value !== 'string') {
      continue
    }

    const outDir = stripPackageGlob(claim.value)

    if (outDir !== 'dist-electron' && outDir !== 'package.json') {
      return outDir
    }
  }

  return undefined
}

function readServeSource(cwd: string, manifest: NonNullable<ReturnType<typeof readManifest>>) {
  const serveFile = manifest.createdFiles.find((filePath) => filePath.endsWith('/serve.ts'))

  if (!serveFile) {
    return null
  }

  const servePath = join(cwd, serveFile)

  return existsSync(servePath) ? readFileSync(servePath, 'utf8') : null
}

function readEmbeddedJson(source: string | null, name: string) {
  const match = source?.match(new RegExp(`const ${name} = readEmbeddedJson<[^>]+>\\((\"(?:\\\\.|[^\"])*\")\\)`))
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

function readEmbeddedString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)

  return typeof value === 'string' ? value : undefined
}

function readEmbeddedNullableString(source: string | null, name: string) {
  const value = readEmbeddedJson(source, name)

  return value === null || typeof value === 'string' ? value : undefined
}

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
    outDir: manifest.outDir ?? readEmbeddedString(serveSource, 'WEB_OUT_DIR') ?? inferOutDirFromManifest(manifest),
    serverRoot: manifest.nodeServerSourceRoot ?? readEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT') ?? undefined,
    serverEntry: manifest.nodeServerEntry ?? readEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY') ?? undefined,
    productName: manifest.productName,
    appId: manifest.appId,
  }
}

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
