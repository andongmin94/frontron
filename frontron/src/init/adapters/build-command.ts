import type { PackageJson } from '../shared'
import { findScriptByCommand, getScriptCommand } from '../detect'

// resolveBuildCommandOrThrow 함수는 선택한 web build script의 실제 명령을 찾거나 오류를 낸다.
export function resolveBuildCommandOrThrow(packageJson: PackageJson, webBuildScript: string) {
  const command = getScriptCommand(packageJson, webBuildScript)

  if (!command) {
    throw new Error(`Selected web build script "${webBuildScript}" was not found.`)
  }

  return command
}

// resolveNextExportBuildCommand 함수는 Next static export에 필요한 build/export 명령을 만든다.
export function resolveNextExportBuildCommand(packageJson: PackageJson, webBuildScript: string) {
  const selectedCommand = resolveBuildCommandOrThrow(packageJson, webBuildScript)

  if (!/\bnext\s+export\b/i.test(selectedCommand)) {
    return selectedCommand
  }

  const nextBuildScriptName = findScriptByCommand(packageJson, /\bnext\s+build\b/i)
  const nextBuildCommand =
    nextBuildScriptName && nextBuildScriptName !== webBuildScript
      ? getScriptCommand(packageJson, nextBuildScriptName)
      : null

  // Historical Next export projects often split build/export scripts; keep that
  // compatibility rule near the generic "script must exist" guard above.
  return nextBuildCommand ? `${nextBuildCommand} && ${selectedCommand}` : selectedCommand
}
