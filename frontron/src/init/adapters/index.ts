import {
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
  hasNextConfigOutput,
  hasNuxtConfig,
  hasPackageDependency,
  hasRemixConfig,
  hasSvelteKitAdapterConfig,
  inferNextExportOutDirFromScript,
  inferOutDir,
  inferOutDirFromScript,
  inferScriptName,
} from '../detect'

const genericStaticAdapter: InitAdapter = {
  id: 'generic-static',
  runtimeStrategy: 'static-export',
  detect() {
    return true
  },
  inferDefaults(cwd, packageJson) {
    const webBuildScript = inferScriptName(packageJson, 'build')

    return {
      webDevScript: inferScriptName(packageJson, 'dev'),
      webBuildScript,
      outDir: inferOutDirFromScript(packageJson, webBuildScript) ?? inferOutDir(cwd),
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
      return false
    }

    return (
      hasNextConfigOutput(cwd, 'export') ||
      findScriptByCommand(packageJson, /\bnext\s+export\b/i) !== null
    )
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
    return hasPackageDependency(packageJson, 'next') && hasNextConfigOutput(cwd, 'standalone')
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
    return hasPackageDependency(packageJson, 'nuxt') || hasNuxtConfig(cwd)
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
    return (
      hasPackageDependency(packageJson, '@remix-run/dev') ||
      hasPackageDependency(packageJson, '@remix-run/node') ||
      hasRemixConfig(cwd)
    )
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
    return (
      hasPackageDependency(packageJson, '@sveltejs/adapter-static') ||
      hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-static')
    )
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
    return (
      hasPackageDependency(packageJson, '@sveltejs/adapter-node') ||
      hasSvelteKitAdapterConfig(cwd, '@sveltejs/adapter-node')
    )
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
    return false
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

  return INIT_ADAPTERS.find((adapter) => adapter.detect(cwd, packageJson)) ?? genericStaticAdapter
}
