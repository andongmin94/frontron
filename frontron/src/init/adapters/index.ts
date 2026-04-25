import {
  type AdapterConfidence,
  type AdapterDetectionResult,
  type InitAdapter,
  type InitAdapterId,
  type PackageJson,
  DEFAULT_GENERIC_NODE_SERVER_OUT_DIR,
  DEFAULT_NEXT_STANDALONE_OUT_DIR,
  DEFAULT_NUXT_NODE_SERVER_OUT_DIR,
  DEFAULT_REMIX_NODE_SERVER_OUT_DIR,
  DEFAULT_SVELTEKIT_NODE_OUT_DIR,
  DEFAULT_SVELTEKIT_STATIC_OUT_DIR,
  normalizeAdapterValue,
} from '../shared'
import {
  findScriptByCommand,
  getScriptCommand,
  hasViteBuildCommand,
  hasNextConfigOutput,
  hasNuxtConfig,
  hasPackageDependency,
  hasRemixConfig,
  hasSvelteKitAdapterConfig,
  inferNextExportOutDirFromScript,
  inferOutDir,
  inferOutDirFromScript,
  inferScriptName,
  inferViteConfigPathFromScript,
} from '../detect'

function detected(
  confidence: AdapterConfidence,
  reasons: string[],
  warnings: string[] = [],
): AdapterDetectionResult {
  return {
    matched: true,
    confidence,
    reasons,
    warnings,
  }
}

function notDetected(reason: string): AdapterDetectionResult {
  return {
    matched: false,
    confidence: 'low',
    reasons: [reason],
    warnings: [],
  }
}

function inferGenericViteOutDir(cwd: string, packageJson: PackageJson, webBuildScript: string) {
  const command = getScriptCommand(packageJson, webBuildScript)
  const configPath = inferViteConfigPathFromScript(packageJson, webBuildScript)
  const configuredOutDir = configPath ? inferOutDir(cwd, [configPath]) : inferOutDir(cwd)

  if (configuredOutDir) {
    return configuredOutDir
  }

  if (configPath) {
    return null
  }

  return hasViteBuildCommand(command) && hasPackageDependency(packageJson, 'vite') ? 'dist' : null
}

const genericStaticAdapter: InitAdapter = {
  id: 'generic-static',
  runtimeStrategy: 'static-export',
  detect() {
    return detected('low', ['No specific framework adapter matched; using generic static fallback.'])
  },
  inferDefaults(cwd, packageJson) {
    const webBuildScript = inferScriptName(packageJson, 'build')

    return {
      webDevScript: inferScriptName(packageJson, 'dev'),
      webBuildScript,
      outDir:
        inferOutDirFromScript(packageJson, webBuildScript) ??
        inferGenericViteOutDir(cwd, packageJson, webBuildScript),
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const nextExportAdapter: InitAdapter = {
  id: 'next-export',
  runtimeStrategy: 'static-export',
  detect(cwd, packageJson) {
    if (!hasPackageDependency(packageJson, 'next')) {
      return notDetected('next dependency was not found.')
    }

    if (hasNextConfigOutput(cwd, 'export')) {
      return detected('high', ['next dependency found.', 'next config declares output: export.'])
    }

    if (findScriptByCommand(packageJson, /\bnext\s+export\b/i) !== null) {
      return detected('medium', ['next dependency found.', 'package.json has a next export script.'])
    }

    return notDetected('next dependency found, but no static export signal was found.')
  },
  inferDefaults(_cwd, packageJson) {
    const webBuildScript =
      findScriptByCommand(packageJson, /\bnext\s+export\b/i) ??
      findScriptByCommand(packageJson, /\bnext\s+build\b/i) ??
      inferScriptName(packageJson, 'build')

    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnext\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript,
      outDir:
        inferNextExportOutDirFromScript(packageJson, webBuildScript) ??
        inferOutDirFromScript(packageJson, webBuildScript) ??
        'out',
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const selectedCommand = getScriptCommand(packageJson, webBuildScript)

    if (!selectedCommand) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    if (!/\bnext\s+export\b/i.test(selectedCommand)) {
      return selectedCommand
    }

    const nextBuildScriptName = findScriptByCommand(packageJson, /\bnext\s+build\b/i)
    const nextBuildCommand =
      nextBuildScriptName && nextBuildScriptName !== webBuildScript
        ? getScriptCommand(packageJson, nextBuildScriptName)
        : null

    return nextBuildCommand
      ? `${nextBuildCommand} && ${selectedCommand}`
      : selectedCommand
  },
}

const nextStandaloneAdapter: InitAdapter = {
  id: 'next-standalone',
  runtimeStrategy: 'node-server',
  detect(cwd, packageJson) {
    if (!hasPackageDependency(packageJson, 'next')) {
      return notDetected('next dependency was not found.')
    }

    if (!hasNextConfigOutput(cwd, 'standalone')) {
      return notDetected('next dependency found, but next config does not declare output: standalone.')
    }

    return detected('high', ['next dependency found.', 'next config declares output: standalone.'])
  },
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnext\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bnext\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_NEXT_STANDALONE_OUT_DIR,
      nodeServerSourceRoot: '.next/standalone',
      nodeServerEntry: 'server.js',
      nodeServerCopyTargets: [
        { from: '.next/static', to: '.next/static' },
        { from: 'public', to: 'public' },
      ],
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const nuxtNodeServerAdapter: InitAdapter = {
  id: 'nuxt-node-server',
  runtimeStrategy: 'node-server',
  detect(cwd, packageJson) {
    if (hasPackageDependency(packageJson, 'nuxt') && hasNuxtConfig(cwd)) {
      return detected('high', ['nuxt dependency found.', 'nuxt config file found.'])
    }

    if (hasPackageDependency(packageJson, 'nuxt')) {
      return detected('medium', ['nuxt dependency found.'])
    }

    if (hasNuxtConfig(cwd)) {
      return detected('medium', ['nuxt config file found.'])
    }

    return notDetected('nuxt dependency or config was not found.')
  },
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnuxt\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bnuxt\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_NUXT_NODE_SERVER_OUT_DIR,
      nodeServerSourceRoot: '.output',
      nodeServerEntry: 'server/index.mjs',
      nodeServerCopyTargets: [],
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const remixNodeServerAdapter: InitAdapter = {
  id: 'remix-node-server',
  runtimeStrategy: 'node-server',
  detect(cwd, packageJson) {
    const reasons: string[] = []

    if (hasPackageDependency(packageJson, '@remix-run/dev')) {
      reasons.push('@remix-run/dev dependency found.')
    }

    if (hasPackageDependency(packageJson, '@remix-run/node')) {
      reasons.push('@remix-run/node dependency found.')
    }

    if (hasRemixConfig(cwd)) {
      reasons.push('remix config file found.')
    }

    return reasons.length > 0
      ? detected(reasons.length > 1 ? 'high' : 'medium', reasons)
      : notDetected('remix dependency or config was not found.')
  },
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bremix\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bremix\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_REMIX_NODE_SERVER_OUT_DIR,
      nodeServerSourceRoot: 'build',
      nodeServerEntry: 'server/index.js',
      nodeServerCopyTargets: [{ from: 'public', to: 'public' }],
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const svelteKitStaticAdapter: InitAdapter = {
  id: 'sveltekit-static',
  runtimeStrategy: 'static-export',
  detect(cwd, packageJson) {
    if (
      hasPackageDependency(packageJson, '@sveltejs/adapter-static') &&
      hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-static')
    ) {
      return detected('high', [
        '@sveltejs/adapter-static dependency found.',
        'svelte config uses @sveltejs/adapter-static.',
      ])
    }

    if (hasPackageDependency(packageJson, '@sveltejs/adapter-static')) {
      return detected('medium', ['@sveltejs/adapter-static dependency found.'])
    }

    if (hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-static')) {
      return detected('medium', ['svelte config uses @sveltejs/adapter-static.'])
    }

    return notDetected('SvelteKit static adapter signal was not found.')
  },
  inferDefaults(cwd, packageJson) {
    const webBuildScript = inferScriptName(packageJson, 'build')

    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bsvelte-kit\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript,
      outDir:
        inferOutDirFromScript(packageJson, webBuildScript) ??
        inferOutDir(cwd) ??
        DEFAULT_SVELTEKIT_STATIC_OUT_DIR,
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const svelteKitNodeAdapter: InitAdapter = {
  id: 'sveltekit-node',
  runtimeStrategy: 'node-server',
  detect(cwd, packageJson) {
    if (
      hasPackageDependency(packageJson, '@sveltejs/adapter-node') &&
      hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-node')
    ) {
      return detected('high', [
        '@sveltejs/adapter-node dependency found.',
        'svelte config uses @sveltejs/adapter-node.',
      ])
    }

    if (hasPackageDependency(packageJson, '@sveltejs/adapter-node')) {
      return detected('medium', ['@sveltejs/adapter-node dependency found.'])
    }

    if (hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-node')) {
      return detected('medium', ['svelte config uses @sveltejs/adapter-node.'])
    }

    return notDetected('SvelteKit node adapter signal was not found.')
  },
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bsvelte-kit\s+dev\b/i) ??
        inferScriptName(packageJson, 'dev'),
      webBuildScript: inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_SVELTEKIT_NODE_OUT_DIR,
      nodeServerSourceRoot: 'build',
      nodeServerEntry: 'index.js',
      nodeServerCopyTargets: [],
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const genericNodeServerAdapter: InitAdapter = {
  id: 'generic-node-server',
  runtimeStrategy: 'node-server',
  detect() {
    return notDetected('generic-node-server is only selected by --adapter.')
  },
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript: inferScriptName(packageJson, 'dev'),
      webBuildScript: inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_GENERIC_NODE_SERVER_OUT_DIR,
      nodeServerSourceRoot: null,
      nodeServerEntry: null,
      nodeServerCopyTargets: [],
    }
  },
  resolveBuildCommand(packageJson, webBuildScript) {
    const command = getScriptCommand(packageJson, webBuildScript)

    if (!command) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
    }

    return command
  },
}

const INIT_ADAPTERS: readonly InitAdapter[] = [
  nextStandaloneAdapter,
  nuxtNodeServerAdapter,
  remixNodeServerAdapter,
  nextExportAdapter,
  svelteKitNodeAdapter,
  svelteKitStaticAdapter,
  genericNodeServerAdapter,
  genericStaticAdapter,
]

function getInitAdapterById(id: InitAdapterId) {
  const adapter = INIT_ADAPTERS.find((entry) => entry.id === id)

  if (!adapter) {
    throw new Error(`Unsupported adapter "${id}".`)
  }

  return adapter
}

export function resolveInitAdapter(
  cwd: string,
  packageJson: PackageJson,
  requestedAdapter: string | undefined,
) {
  if (requestedAdapter) {
    return getInitAdapterById(normalizeAdapterValue(requestedAdapter))
  }

  return INIT_ADAPTERS.find((adapter) => adapter.detect(cwd, packageJson).matched) ?? genericStaticAdapter
}

export function describeInitAdapterSelection(
  adapter: InitAdapter,
  requestedAdapter: string | undefined,
  cwd: string,
  packageJson: PackageJson,
): {
  confidence: AdapterConfidence
  reasons: string[]
  warnings: string[]
} {
  if (requestedAdapter) {
    return {
      confidence: 'high',
      reasons: [`Adapter was explicitly selected with --adapter ${requestedAdapter}.`],
      warnings: [],
    }
  }

  const detection = adapter.detect(cwd, packageJson)

  return {
    confidence: detection.confidence,
    reasons: detection.reasons,
    warnings: detection.warnings,
  }
}
