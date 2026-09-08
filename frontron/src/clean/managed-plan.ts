import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createFileHash, MANIFEST_PATH, type FrontronManifest } from '../init/manifest'
import type { PackageJson } from '../init/shared'
import { inspectManagedFile, inspectManagedScript } from '../managed-state'
import type { CleanFileChange, CleanOptions, CleanScriptChange } from './types'

type ManagedCleanPlan = {
  files: CleanFileChange[]
  scripts: CleanScriptChange[]
  warnings: string[]
  blockers: string[]
}

// manifest가 소유한 파일을 현재 해시·경로 안전성과 비교해 삭제 계획으로 바꾼다.
function planManagedFiles(
  cwd: string,
  manifest: FrontronManifest,
  options: CleanOptions,
  warnings: string[],
  blockers: string[],
) {
  const files: CleanFileChange[] = []
  // manifest는 자기 자신을 fileHashes에 넣지 않으므로 현재 원문 해시를 별도로 계획 기준으로 잡는다.
  const manifestSourceHash = createFileHash(readFileSync(resolve(cwd, MANIFEST_PATH)))
  const manifestFiles = [...manifest.createdFiles].sort((left, right) => {
    if (left === MANIFEST_PATH) return 1
    if (right === MANIFEST_PATH) return -1
    return 0
  })

  for (const manifestPath of manifestFiles) {
    const expectedHash =
      manifestPath === MANIFEST_PATH ? manifestSourceHash : manifest.fileHashes[manifestPath]
    const inspection = inspectManagedFile(cwd, manifestPath, expectedHash)

    if (inspection.state === 'unsafe') {
      const blocker = inspection.blocker ?? `Manifest file entry is unsafe: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (inspection.state === 'missing') {
      warnings.push(`Manifest file is already missing: ${manifestPath}`)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'missing',
        reason: 'File is already missing.',
      })
      continue
    }

    if (inspection.state === 'modified' && !options.force) {
      const blocker = `Manifest-owned file was modified and will not be removed without --force: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (inspection.state === 'modified') {
      warnings.push(
        `Modified manifest-owned file will be removed because --force was used: ${manifestPath}`,
      )
    }

    files.push({
      manifestPath,
      absolutePath: inspection.absolutePath,
      action: 'delete',
      reason: 'File is recorded in the Frontron manifest.',
      expectedHash: inspection.currentHash,
    })
  }

  return files
}

// manifest가 소유한 npm script를 현재 명령과 비교해 제거 계획으로 바꾼다.
function planManagedScripts(
  packageJson: PackageJson,
  manifest: FrontronManifest,
  options: CleanOptions,
  warnings: string[],
  blockers: string[],
) {
  const scripts: CleanScriptChange[] = []

  for (const scriptName of manifest.scripts) {
    const state = inspectManagedScript(packageJson.scripts, manifest.scriptCommands, scriptName)

    if (state === 'missing') {
      warnings.push(`Package script is already missing: ${scriptName}`)
      scripts.push({ name: scriptName, action: 'missing' })
      continue
    }

    if (state === 'modified' && !options.force) {
      const blocker = `Manifest-owned script was modified and will not be removed without --force: ${scriptName}`
      blockers.push(blocker)
      scripts.push({ name: scriptName, action: 'blocked' })
      continue
    }

    if (state === 'modified') {
      warnings.push(
        `Modified manifest-owned script will be removed because --force was used: ${scriptName}`,
      )
    }

    scripts.push({ name: scriptName, action: 'remove' })
  }

  return scripts
}

// 파일과 script 소유권만 다룬다. package.json/설정 claim 복구는 claim-plan이 담당한다.
export function createManagedCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  manifest: FrontronManifest,
  options: CleanOptions,
): ManagedCleanPlan {
  const warnings: string[] = []
  const blockers: string[] = []
  const files = planManagedFiles(cwd, manifest, options, warnings, blockers)
  const scripts = planManagedScripts(packageJson, manifest, options, warnings, blockers)

  return { files, scripts, warnings, blockers }
}
