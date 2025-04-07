import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { PackageJson } from './shared'
import { normalizePathValue } from './shared'

const VITE_CONFIG_FILE_NAMES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']

export function inferOutDir(cwd: string, fileNames = VITE_CONFIG_FILE_NAMES) {
  for (const fileName of fileNames) {
    const filePath = resolve(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')
    const outDirMatch = source.match(/outDir\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/)
    const outDir = outDirMatch?.slice(1).find(Boolean)

    if (outDir) {
      return normalizePathValue(outDir, 'dist')
    }
  }

  return null
}

export function findScriptByCommand(packageJson: PackageJson, pattern: RegExp) {
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (pattern.test(command)) {
      return name
    }
  }

  return null
}

export function getScriptCommand(packageJson: PackageJson, scriptName: string) {
  return packageJson.scripts?.[scriptName] ?? null
}

export function hasPackageDependency(packageJson: PackageJson, packageName: string) {
  return Boolean(
    packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName],
  )
}

export function hasNextConfigOutput(cwd: string, output: 'export' | 'standalone') {
  for (const fileName of [
    'next.config.ts',
    'next.config.mts',
    'next.config.js',
    'next.config.mjs',
    'next.config.cjs',
  ]) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')
    const pattern = new RegExp(`output\\s*:\\s*(?:"${output}"|'${output}'|\`${output}\`)`, 'm')

    if (pattern.test(source)) {
      return true
    }
  }

  return false
}

export function hasNuxtConfig(cwd: string) {
  for (const fileName of [
    'nuxt.config.ts',
    'nuxt.config.mts',
    'nuxt.config.js',
    'nuxt.config.mjs',
    'nuxt.config.cjs',
  ]) {
    if (existsSync(join(cwd, fileName))) {
      return true
    }
  }

  return false
}

function readFirstExistingConfigSource(cwd: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    const filePath = join(cwd, fileName)

    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf8')
    }
  }

  return null
}

export function hasRemixConfig(cwd: string) {
  return Boolean(
    readFirstExistingConfigSource(cwd, [
      'remix.config.ts',
      'remix.config.mts',
      'remix.config.js',
      'remix.config.mjs',
      'remix.config.cjs',
    ]),
  )
}

export function hasSvelteKitAdapterConfig(
  cwd: string,
  adapterPackage: '@sveltejs/adapter-static' | '@sveltejs/adapter-node',
) {
  const source = readFirstExistingConfigSource(cwd, [
    'svelte.config.ts',
    'svelte.config.js',
    'svelte.config.mjs',
    'svelte.config.cjs',
  ])

  return Boolean(source && source.includes(adapterPackage))
}

export function inferScriptName(packageJson: PackageJson, kind: 'dev' | 'build') {
  const scripts = packageJson.scripts ?? {}
  const preferredCandidates =
    kind === 'dev'
      ? ['dev', 'web:dev', 'frontend:dev', 'client:dev', 'start']
      : ['build', 'web:build', 'frontend:build', 'client:build']

  for (const candidate of preferredCandidates) {
    if (scripts[candidate]) {
      return candidate
    }
  }

  const viteCandidates = Object.entries(scripts)
    .filter(([, command]) =>
      kind === 'dev'
        ? /\bvite(?:\s|$)/i.test(command) && !/\bbuild\b/i.test(command)
        : /\bvite\s+build\b/i.test(command),
    )
    .map(([name]) => name)

  return viteCandidates.length === 1 ? viteCandidates[0] : (kind === 'dev' ? 'dev' : 'build')
}

function isViteBuildCommand(command: string | null | undefined) {
  return Boolean(command && /\bvite\s+build\b/i.test(command))
}

export function hasViteBuildCommand(command: string | null | undefined) {
  return isViteBuildCommand(command)
}

export function inferOutDirFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command || !isViteBuildCommand(command)) {
    return null
  }

  const match = command.match(/(?:--outDir|--outdir|-o)(?:\s+|=)([^\s"'`&]+)/i)
  return match?.[1] ? normalizePathValue(match[1], 'dist') : null
}

export function inferViteConfigPathFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!isViteBuildCommand(command) || !command) {
    return null
  }

  const match = command.match(/(?:^|[\s"'`])(?:--config|-c)(?:\s+|=)([^\s"'`&]+)/i)
  const configPath = match?.[1]
  return configPath ? normalizePathValue(configPath, configPath) : null
}

export function inferNextExportOutDirFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command || !/\bnext\s+export\b/i.test(command)) {
    return null
  }

  const match = command.match(/(?:--outdir|-o)(?:\s+|=)([^\s"'`&]+)/i)
  return match?.[1] ? normalizePathValue(match[1], 'out') : 'out'
}

export function inferViteServerValue(cwd: string, key: 'port' | 'host') {
  for (const fileName of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')

    if (key === 'port') {
      const portMatch = source.match(/server\s*:\s*\{[\s\S]*?port\s*:\s*(\d{1,5})/m)
      const port = Number.parseInt(portMatch?.[1] ?? '', 10)

      if (Number.isInteger(port) && port > 0 && port <= 65_535) {
        return String(port)
      }
    } else {
      const hostMatch = source.match(
        /server\s*:\s*\{[\s\S]*?host\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_.:-]+))/m,
      )
      const host = hostMatch?.slice(1).find(Boolean)

      if (host) {
        return host
      }
    }
  }

  return null
}

export function normalizeLoopbackHost(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^["'`]|["'`]$/g, '') ?? ''

  if (!normalized) {
    return null
  }

  if (normalized === '0.0.0.0' || normalized === '::' || normalized === 'true') {
    return '127.0.0.1'
  }

  return normalized
}

export function inferPort(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command) {
    return null
  }

  for (const pattern of [
    /(?:^|[\s"'`])PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])set\s+PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])--port(?:\s+|=)(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])-p(?:\s+|=)?(\d{1,5})(?=$|[\s"'`&])/i,
  ]) {
    const value = Number.parseInt(command.match(pattern)?.[1] ?? '', 10)

    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      return value
    }
  }

  return null
}

export function inferHost(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command) {
    return null
  }

  for (const pattern of [
    /(?:^|[\s"'`])HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])set\s+HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--hostname(?:\s+|=)([^\s"'`&]+)/i,
    /(?:^|[\s"'`])--host(?:\s+|=)([^\s"'`&]+)/i,
  ]) {
    const host = command.match(pattern)?.[1]

    if (host) {
      return normalizeLoopbackHost(host)
    }
  }

  return null
}
