import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { PackageJson } from './shared'
import { normalizePathValue } from './shared'

const VITE_CONFIG_FILE_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
]

// hasViteConfig 함수는 일반 Vite 계열 프로젝트의 설정 파일 존재 여부를 확인한다.
export function hasViteConfig(cwd: string, fileNames = VITE_CONFIG_FILE_NAMES) {
  return fileNames.some((fileName) => existsSync(resolve(cwd, fileName)))
}

// inferOutDir 함수는 Vite 설정 파일에서 프론트엔드 빌드 출력 경로를 추론한다.
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

// findScriptByCommand 함수는 package.json scripts에서 특정 명령 패턴과 맞는 script 이름을 찾는다.
export function findScriptByCommand(packageJson: PackageJson, pattern: RegExp) {
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (pattern.test(command)) {
      return name
    }
  }

  return null
}

// getScriptCommand 함수는 package.json에서 지정한 script 명령 문자열을 읽는다.
export function getScriptCommand(packageJson: PackageJson, scriptName: string) {
  return packageJson.scripts?.[scriptName] ?? null
}

// splitCommandSegments 함수는 따옴표와 Windows 역슬래시를 보존하며 shell 명령 구간을 나눈다.
function splitCommandSegments(command: string) {
  const segments: string[][] = []
  let args: string[] = []
  let current = ''
  let quote: '"' | "'" | '`' | null = null

  // flushArg 함수는 현재까지 읽은 명령 인자를 현재 구간에 확정한다.
  const flushArg = () => {
    if (!current) return
    args.push(current)
    current = ''
  }

  // flushSegment 함수는 shell 연산자 앞까지의 인자를 독립된 명령으로 확정한다.
  const flushSegment = () => {
    flushArg()
    if (args.length > 0) segments.push(args)
    args = []
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]

    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === '\\' && quote !== "'") {
        const next = command[index + 1]

        if (next === quote || next === '\\') {
          current += next
          index += 1
        } else {
          current += char
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '\\') {
      const next = command[index + 1]

      if (next && (/\s/.test(next) || next === '"' || next === "'" || next === '`')) {
        current += next
        index += 1
      } else {
        current += char
      }
      continue
    }

    if (/\s/.test(char)) {
      flushArg()
      continue
    }

    if (char === ';' || char === '&' || char === '|') {
      flushSegment()
      if (command[index + 1] === char) index += 1
      continue
    }

    current += char
  }

  flushSegment()
  return segments
}

// findCommandSegment 함수는 대상 도구가 있는 shell 구간만 골라 뒤 명령의 flag 혼입을 막는다.
function findCommandSegment(command: string, commandPattern?: RegExp) {
  const segments = splitCommandSegments(command)

  if (!commandPattern) return segments[0] ?? []

  return (
    segments.find((segment) => {
      commandPattern.lastIndex = 0
      return commandPattern.test(segment.join(' '))
    }) ??
    segments[0] ??
    []
  )
}

// readCommandOption 함수는 선택한 명령 구간에서 --flag value와 --flag=value 값을 찾는다.
function readCommandOption(command: string, flags: string[], commandPattern?: RegExp) {
  const args = findCommandSegment(command, commandPattern)

  for (const [index, arg] of args.entries()) {
    for (const flag of flags) {
      if (arg === flag) {
        return args[index + 1] ?? null
      }

      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1) || null
      }
    }
  }

  return null
}

// hasPackageDependency 함수는 package.json에 특정 패키지 의존성이 있는지 확인한다.
export function hasPackageDependency(packageJson: PackageJson, packageName: string) {
  return Boolean(
    packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName],
  )
}

// hasNextConfigOutput 함수는 Next 설정 파일에 지정한 output 모드가 있는지 확인한다.
export function hasNextConfigOutput(cwd: string, output: 'export' | 'standalone') {
  for (const fileName of [
    'next.config.ts',
    'next.config.mts',
    'next.config.cts',
    'next.config.js',
    'next.config.mjs',
    'next.config.cjs',
  ]) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')
    const pattern = new RegExp(
      `(?:"output"|'output'|output)\\s*:\\s*(?:"${output}"|'${output}'|\`${output}\`)`,
      'm',
    )

    if (pattern.test(source)) {
      return true
    }
  }

  return false
}

// hasNuxtConfig 함수는 Nuxt 설정 파일이 프로젝트에 있는지 확인한다.
export function hasNuxtConfig(cwd: string) {
  for (const fileName of [
    'nuxt.config.ts',
    'nuxt.config.mts',
    'nuxt.config.cts',
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

// readFirstExistingConfigSource 함수는 후보 설정 파일 중 처음 존재하는 파일의 내용을 읽는다.
function readFirstExistingConfigSource(cwd: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    const filePath = join(cwd, fileName)

    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf8')
    }
  }

  return null
}

// someConfigSourceIncludes 함수는 여러 설정 파일 중 하나라도 찾는 문자열을 포함하는지 확인한다.
function someConfigSourceIncludes(cwd: string, fileNames: string[], expectedSource: string) {
  return fileNames.some((fileName) => {
    const filePath = join(cwd, fileName)

    return existsSync(filePath) && readFileSync(filePath, 'utf8').includes(expectedSource)
  })
}

// hasRemixConfig 함수는 Remix 설정 파일이 프로젝트에 있는지 확인한다.
export function hasRemixConfig(cwd: string) {
  return Boolean(
    readFirstExistingConfigSource(cwd, [
      'remix.config.ts',
      'remix.config.mts',
      'remix.config.cts',
      'remix.config.js',
      'remix.config.mjs',
      'remix.config.cjs',
    ]),
  )
}

// hasSvelteKitAdapterConfig 함수는 SvelteKit 설정 파일에 특정 adapter 설정이 있는지 확인한다.
export function hasSvelteKitAdapterConfig(
  cwd: string,
  adapterPackage: '@sveltejs/adapter-static' | '@sveltejs/adapter-node',
) {
  const extensions = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']
  const fileNames = extensions.flatMap((extension) => [
    `svelte.config.${extension}`,
    `vite.config.${extension}`,
  ])

  return someConfigSourceIncludes(cwd, fileNames, adapterPackage)
}

// inferScriptName 함수는 package.json scripts에서 dev 또는 build에 알맞은 script 이름을 추론한다.
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

  return viteCandidates.length === 1 ? viteCandidates[0] : kind === 'dev' ? 'dev' : 'build'
}

// hasViteBuildCommand 함수는 script 명령이 Vite 빌드 명령인지 확인한다.
export function hasViteBuildCommand(command: string | null | undefined) {
  return Boolean(command && /\bvite\s+build\b/i.test(command))
}

// inferOutDirFromScript 함수는 build script 명령에서 출력 디렉터리를 추론한다.
export function inferOutDirFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command || !hasViteBuildCommand(command)) {
    return null
  }

  const outDir = readCommandOption(command, ['--outDir', '--outdir', '-o'], /\bvite\s+build\b/i)
  return outDir ? normalizePathValue(outDir, 'dist') : null
}

// inferViteConfigPathFromScript 함수는 Vite build script의 --config 값에서 설정 파일 경로를 추론한다.
export function inferViteConfigPathFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command || !hasViteBuildCommand(command)) {
    return null
  }

  const configPath = readCommandOption(command, ['--config', '-c'], /\bvite\s+build\b/i)
  return configPath ? normalizePathValue(configPath, configPath) : null
}

// inferNextExportOutDirFromScript 함수는 Next export script에서 출력 디렉터리를 추론한다.
export function inferNextExportOutDirFromScript(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command || !/\bnext\s+export\b/i.test(command)) {
    return null
  }

  return normalizePathValue(
    readCommandOption(command, ['--outdir', '-o'], /\bnext\s+export\b/i) ?? 'out',
    'out',
  )
}

// inferViteServerConfig 함수는 Vite 설정 파일을 한 번 순회해 server host와 port를 추론한다.
export function inferViteServerConfig(cwd: string) {
  let host: string | null = null
  let port: string | null = null

  for (const fileName of [
    'vite.config.ts',
    'vite.config.mts',
    'vite.config.cts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.cjs',
  ]) {
    const filePath = join(cwd, fileName)

    if (!existsSync(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')

    if (port === null) {
      const portMatch = source.match(/server\s*:\s*\{[\s\S]*?port\s*:\s*(\d{1,5})/m)
      const parsedPort = Number.parseInt(portMatch?.[1] ?? '', 10)

      if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65_535) {
        port = String(parsedPort)
      }
    }

    if (host === null) {
      const hostMatch = source.match(
        /server\s*:\s*\{[\s\S]*?host\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_.:-]+))/m,
      )
      host = hostMatch?.slice(1).find(Boolean) ?? null
    }

    if (host !== null && port !== null) {
      break
    }
  }

  return { host, port }
}

// normalizeLoopbackHost 함수는 host 값을 Electron dev server용 loopback host로 정규화한다.
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

// inferPort 함수는 개발 script나 Vite 설정에서 dev server port를 추론한다.
export function inferPort(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command) {
    return null
  }

  const commandPattern = /\b(?:vite|next|nuxt|remix|svelte-kit|astro)\b/i
  const commandSegment = findCommandSegment(command, commandPattern).join(' ')
  const portOption = readCommandOption(command, ['--port', '-p'], commandPattern)
  const optionValue = Number.parseInt(portOption ?? '', 10)

  if (Number.isInteger(optionValue) && optionValue > 0 && optionValue <= 65_535) {
    return optionValue
  }

  for (const pattern of [
    /(?:^|[\s"'`])PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])set\s+PORT=(\d{1,5})(?=$|[\s"'`&])/i,
    /(?:^|[\s"'`])-p(\d{1,5})(?=$|[\s"'`&])/i,
  ]) {
    const value = Number.parseInt(commandSegment.match(pattern)?.[1] ?? '', 10)

    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      return value
    }
  }

  return null
}

// inferHost 함수는 개발 script나 Vite 설정에서 dev server host를 추론한다.
export function inferHost(packageJson: PackageJson, scriptName: string) {
  const command = getScriptCommand(packageJson, scriptName)

  if (!command) {
    return null
  }

  const commandPattern = /\b(?:vite|next|nuxt|remix|svelte-kit|astro)\b/i
  const commandSegment = findCommandSegment(command, commandPattern).join(' ')
  const hostOption = readCommandOption(command, ['--hostname', '--host'], commandPattern)

  if (hostOption) {
    return normalizeLoopbackHost(hostOption)
  }

  for (const pattern of [
    /(?:^|[\s"'`])HOST=([^\s"'`&]+)/i,
    /(?:^|[\s"'`])set\s+HOST=([^\s"'`&]+)/i,
  ]) {
    const host = commandSegment.match(pattern)?.[1]

    if (host) {
      return normalizeLoopbackHost(host)
    }
  }

  return null
}
