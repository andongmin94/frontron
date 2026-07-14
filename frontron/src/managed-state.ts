import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { createFileHash } from './init/manifest'
import { hasOwnString } from './init/package-json-path'
import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from './project-paths'

/**
 * manifest 소유 항목은 이 다섯 상태 중 하나로만 해석한다.
 * unverifiable은 이전 값이 기록되지 않은 레거시 상태이며 modified와 구분해 안내한다.
 */
export type ManagedState = 'unchanged' | 'modified' | 'missing' | 'unverifiable' | 'unsafe'

export type ManagedFileInspection = {
  state: ManagedState
  absolutePath: string
  currentHash?: string
  blocker?: string
}

// manifest 상대 경로를 프로젝트 내부의 안전한 절대 경로로 해석한다.
export function resolveManagedProjectFile(cwd: string, filePath: string, label: string) {
  const root = resolve(cwd)

  if (isAbsolute(filePath)) {
    return {
      state: 'unsafe' as const,
      absolutePath: resolve(filePath),
      blocker: `${label} must be relative: ${filePath}`,
    }
  }

  const absolutePath = resolve(root, filePath)

  if (!isInsideDirectory(root, absolutePath) || absolutePath === root) {
    return {
      state: 'unsafe' as const,
      absolutePath,
      blocker: `${label} points outside the project: ${filePath}`,
    }
  }

  const pathInspection = inspectProjectPath(root, absolutePath)

  if (!pathInspection.safe) {
    return {
      state: 'unsafe' as const,
      absolutePath,
      blocker: formatProjectPathBlocker(root, `${label} (${filePath})`, pathInspection),
    }
  }

  return { state: 'unchanged' as const, absolutePath }
}

// manifest가 소유한 파일의 경로·종류·hard link·내용 해시를 한 번에 검사한다.
export function inspectManagedFile(
  cwd: string,
  filePath: string,
  expectedHash: string | undefined,
  label = 'Manifest file entry',
): ManagedFileInspection {
  const resolved = resolveManagedProjectFile(cwd, filePath, label)
  if (resolved.state === 'unsafe') return resolved

  if (!existsSync(resolved.absolutePath)) {
    return { state: 'missing', absolutePath: resolved.absolutePath }
  }

  const stats = lstatSync(resolved.absolutePath)

  if (!stats.isFile()) {
    return {
      state: 'unsafe',
      absolutePath: resolved.absolutePath,
      blocker: `${label} is not a regular file: ${filePath}`,
    }
  }

  if (stats.nlink !== 1) {
    return {
      state: 'unsafe',
      absolutePath: resolved.absolutePath,
      blocker: `${label} must have exactly one hard link: ${filePath}`,
    }
  }

  const currentHash = createFileHash(readFileSync(resolved.absolutePath))

  if (!expectedHash) {
    return { state: 'unverifiable', absolutePath: resolved.absolutePath, currentHash }
  }

  return {
    state: currentHash === expectedHash ? 'unchanged' : 'modified',
    absolutePath: resolved.absolutePath,
    currentHash,
  }
}

// package.json script를 manifest에 기록된 원래 명령과 비교한다.
export function inspectManagedScript(
  scripts: Record<string, string> | undefined,
  expectedCommands: Record<string, string> | undefined,
  scriptName: string,
): ManagedState {
  if (!hasOwnString(scripts, scriptName)) return 'missing'
  if (!hasOwnString(expectedCommands, scriptName)) return 'unverifiable'

  return scripts?.[scriptName] === expectedCommands?.[scriptName] ? 'unchanged' : 'modified'
}
