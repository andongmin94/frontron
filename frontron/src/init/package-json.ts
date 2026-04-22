import {
  type InitConfig,
  type PackageJson,
  ELECTRON_BUILDER_VERSION,
  ELECTRON_VERSION,
  NODE_TYPES_VERSION,
  TYPESCRIPT_VERSION,
} from './shared'

function ensureArray(value: unknown, label: string) {
  if (typeof value === 'undefined') {
    return []
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing packaging rules.`)
  }

  return [...value]
}

function ensureObject<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

export function patchPackageJson(config: InitConfig) {
  const packageJson = config.packageJson
  const scripts = { ...(packageJson.scripts ?? {}) }
  const devDependencies = { ...(packageJson.devDependencies ?? {}) }
  const build = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, {})
  const directories = ensureObject<{ output?: string }>(build.directories, {})
  const extraMetadata = ensureObject<Record<string, unknown>>(build.extraMetadata, {})
  const files = ensureArray(build.files, 'build.files')

  scripts[config.appScript] = 'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app'
  scripts[config.buildScript] =
    `${config.webBuildCommand} && tsc -p tsconfig.electron.json && node dist-electron/serve.js --prepare-build && electron-builder`

  devDependencies.electron ??= ELECTRON_VERSION
  devDependencies['electron-builder'] ??= ELECTRON_BUILDER_VERSION
  devDependencies['@types/node'] ??= NODE_TYPES_VERSION
  devDependencies.typescript ??= TYPESCRIPT_VERSION

  build.appId ??= config.appId
  build.productName ??= config.productName

  for (const pattern of ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']) {
    if (!files.includes(pattern)) {
      files.push(pattern)
    }
  }

  build.files = files

  if (config.runtimeStrategy === 'node-server') {
    const asarUnpack = ensureArray(build.asarUnpack, 'build.asarUnpack')
    const unpackPattern = `${config.outDir}{,/**/*}`

    if (!asarUnpack.includes(unpackPattern)) {
      asarUnpack.push(unpackPattern)
    }

    build.asarUnpack = asarUnpack
  }

  directories.output ??= 'release'
  build.directories = directories

  if (typeof extraMetadata.main === 'undefined' || config.allowExtraMetadataMainOverride) {
    extraMetadata.main = 'dist-electron/main.js'
  }

  build.extraMetadata = extraMetadata

  packageJson.scripts = scripts
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}
