import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { extname, join, relative } from 'node:path'

export interface DoctorMigrationBlocker {
  code:
    | 'legacy-electron-contract'
    | 'legacy-renderer-global'
    | 'closed-browserwindow-options'
    | 'overlay-clickthrough'
    | 'modal-parent-graph'
    | 'remote-content'
    | 'webview-element'
  message: string
}

const DOCTOR_SCAN_IGNORED_DIRS = new Set([
  '.frontron',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'build',
  'docs',
  'node_modules',
  'output',
  'release',
  'release-output',
])

const DOCTOR_SCAN_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

const DOCTOR_SCAN_MAX_BYTES = 256 * 1024

type DoctorMigrationBlockerCode = DoctorMigrationBlocker['code']

function normalizeDoctorPath(rootDir: string, targetPath: string) {
  return formatDoctorPath(rootDir, targetPath).replace(/\\/g, '/')
}

function collectDoctorScanFiles(rootDir: string) {
  const files: string[] = []
  const pendingDirs = [rootDir]

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()

    if (!currentDir) {
      continue
    }

    let entries: Dirent<string>[]

    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!DOCTOR_SCAN_IGNORED_DIRS.has(entry.name)) {
          pendingDirs.push(absolutePath)
        }

        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const extension = extname(entry.name)

      if (!DOCTOR_SCAN_EXTENSIONS.has(extension) || entry.name.endsWith('.d.ts')) {
        continue
      }

      try {
        const fileSource = readFileSync(absolutePath, 'utf8')

        if (Buffer.byteLength(fileSource, 'utf8') <= DOCTOR_SCAN_MAX_BYTES) {
          files.push(absolutePath)
        }
      } catch {
        continue
      }
    }
  }

  return files
}

function formatMatchedDoctorPaths(paths: Set<string>) {
  const sortedPaths = [...paths].sort()

  if (sortedPaths.length <= 3) {
    return sortedPaths.join(', ')
  }

  return `${sortedPaths.slice(0, 3).join(', ')}, +${sortedPaths.length - 3} more`
}

function registerDoctorMatch(
  matches: Map<DoctorMigrationBlockerCode, Set<string>>,
  code: DoctorMigrationBlockerCode,
  pathText: string,
) {
  const nextMatches = matches.get(code) ?? new Set<string>()
  nextMatches.add(pathText)
  matches.set(code, nextMatches)
}

function createDoctorMigrationBlocker(
  code: DoctorMigrationBlockerCode,
  matchedPaths: Set<string>,
): DoctorMigrationBlocker {
  const pathList = formatMatchedDoctorPaths(matchedPaths)

  switch (code) {
    case 'legacy-electron-contract':
      return {
        code,
        message:
          `[Frontron] Migration blocker: legacy raw-Electron project files were found under ${pathList}. ` +
          'Move Electron-specific logic into the official root `frontron.config.ts` and `frontron/` app layer instead of keeping `src/electron/*` or top-level `electron/` runtime code.',
      }

    case 'legacy-renderer-global':
      return {
        code,
        message:
          `[Frontron] Migration blocker: legacy renderer globals were found in ${pathList}. ` +
          'Replace `window.electron`-style access with the public `frontron/client` bridge surface.',
      }

    case 'closed-browserwindow-options':
      return {
        code,
        message:
          `[Frontron] Migration blocker: raw BrowserWindow security/runtime options were found in ${pathList}. ` +
          'Frontron keeps `preload`, `webPreferences`, `nodeIntegration`, `contextIsolation`, `webviewTag`, and raw session ownership under framework control.',
      }

    case 'overlay-clickthrough':
      return {
        code,
        message:
          `[Frontron] Migration blocker: overlay or click-through APIs were found in ${pathList}. ` +
          'Frontron does not currently support `setIgnoreMouseEvents`-style overlay behavior.',
      }

    case 'modal-parent-graph':
      return {
        code,
        message:
          `[Frontron] Migration blocker: parent/modal BrowserWindow relationships were found in ${pathList}. ` +
          'Frontron does not currently model parent-child or modal window graphs.',
      }

    case 'remote-content':
      return {
        code,
        message:
          `[Frontron] Migration blocker: remote URL or file-backed window content was found in ${pathList}. ` +
          'The current Frontron window contract is route-based and app-origin oriented, not raw `loadURL()` or `loadFile()` driven.',
      }

    case 'webview-element':
      return {
        code,
        message:
          `[Frontron] Migration blocker: Electron <webview> usage was found in ${pathList}. ` +
          'Frontron does not currently support `webviewTag` or webview-based renderer content.',
      }
  }
}

export function formatDoctorPath(rootDir: string, targetPath: string) {
  const relativePath = relative(rootDir, targetPath).replace(/\\/g, '/')

  if (!relativePath) {
    return '.'
  }

  return relativePath.startsWith('..') ? targetPath : relativePath
}

export function readDirectoryEntries(targetDir: string) {
  if (!existsSync(targetDir)) {
    return []
  }

  try {
    return readdirSync(targetDir)
  } catch {
    return []
  }
}

export function scanDoctorMigrationBlockers(rootDir: string) {
  const matches = new Map<DoctorMigrationBlockerCode, Set<string>>()

  for (const legacyDir of [join(rootDir, 'src', 'electron'), join(rootDir, 'electron')]) {
    if (existsSync(legacyDir)) {
      registerDoctorMatch(matches, 'legacy-electron-contract', normalizeDoctorPath(rootDir, legacyDir))
    }
  }

  for (const filePath of collectDoctorScanFiles(rootDir)) {
    let source: string

    try {
      source = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }

    const normalizedPath = normalizeDoctorPath(rootDir, filePath)

    if (source.includes('window.electron')) {
      registerDoctorMatch(matches, 'legacy-renderer-global', normalizedPath)
    }

    if (/<webview\b/i.test(source) || /createElement\(\s*['"`]webview['"`]\s*\)/i.test(source)) {
      registerDoctorMatch(matches, 'webview-element', normalizedPath)
    }

    if (/\.setIgnoreMouseEvents\s*\(/.test(source)) {
      registerDoctorMatch(matches, 'overlay-clickthrough', normalizedPath)
    }

    const referencesRawElectronWindow =
      /\bBrowserWindow\b/.test(source) ||
      /from\s+['"`]electron['"`]/.test(source) ||
      /require\(\s*['"`]electron['"`]\s*\)/.test(source)

    if (!referencesRawElectronWindow) {
      continue
    }

    if (
      /\bwebPreferences\s*:/.test(source) ||
      /\bpreload\s*:/.test(source) ||
      /\bnodeIntegration\s*:/.test(source) ||
      /\bcontextIsolation\s*:/.test(source) ||
      /\bwebviewTag\s*:/.test(source) ||
      /\bpartition\s*:/.test(source)
    ) {
      registerDoctorMatch(matches, 'closed-browserwindow-options', normalizedPath)
    }

    if (/\bmodal\s*:\s*true\b/.test(source) || /\bparent\s*:/.test(source)) {
      registerDoctorMatch(matches, 'modal-parent-graph', normalizedPath)
    }

    if (/\.loadURL\s*\(\s*['"`]https?:\/\//.test(source) || /\.loadFile\s*\(/.test(source)) {
      registerDoctorMatch(matches, 'remote-content', normalizedPath)
    }
  }

  const orderedCodes: DoctorMigrationBlockerCode[] = [
    'legacy-electron-contract',
    'legacy-renderer-global',
    'closed-browserwindow-options',
    'webview-element',
    'overlay-clickthrough',
    'modal-parent-graph',
    'remote-content',
  ]

  return orderedCodes
    .map((code) => {
      const matchedPaths = matches.get(code)
      return matchedPaths ? createDoctorMigrationBlocker(code, matchedPaths) : null
    })
    .filter((blocker): blocker is DoctorMigrationBlocker => blocker !== null)
}
