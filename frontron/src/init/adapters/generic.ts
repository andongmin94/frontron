import { type InitAdapter, type PackageJson, DEFAULT_GENERIC_NODE_SERVER_OUT_DIR } from '../shared'
import {
  findScriptByCommand,
  getScriptCommand,
  hasPackageDependency,
  hasViteConfig,
  hasViteBuildCommand,
  inferOutDir,
  inferOutDirFromScript,
  inferScriptName,
  inferViteConfigPathFromScript,
} from '../detect'
import { resolveBuildCommandOrThrow } from './build-command'
import { detected, notDetected } from './detection-result'

// inferGenericViteOutDir 함수는 일반 Vite 계열 프로젝트의 빌드 출력 경로를 추론한다.
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

export const genericStaticAdapter: InitAdapter = {
  id: 'generic-static',
  runtimeStrategy: 'static-export',
  // detect 메서드는 특정 프레임워크 신호가 없을 때 generic static fallback으로 감지한다.
  // detect 메서드는 특정 프레임워크가 아니어도 Vite 정적 앱 신호가 있으면 확신도를 올린다.
  detect(cwd, packageJson) {
    const reasons: string[] = []

    if (hasPackageDependency(packageJson, 'vite')) {
      reasons.push('vite dependency found.')
    }

    if (hasViteConfig(cwd)) {
      reasons.push('vite config file found.')
    }

    if (findScriptByCommand(packageJson, /\bvite\s+build\b/i)) {
      reasons.push('package.json has a Vite build script.')
    }

    if (reasons.length > 0) {
      return detected(reasons.length > 1 ? 'high' : 'medium', reasons)
    }

    return detected('low', [
      'No specific framework adapter matched; using generic static fallback.',
    ])
  },
  // inferDefaults 메서드는 일반 정적 앱에 필요한 script 이름과 outDir 기본값을 추론한다.
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
  // resolveBuildCommand 메서드는 선택된 build script의 실제 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}

export const genericNodeServerAdapter: InitAdapter = {
  id: 'generic-node-server',
  runtimeStrategy: 'node-server',
  // detect 메서드는 generic node-server가 자동 선택되지 않도록 감지 실패로 표시한다.
  detect() {
    return notDetected('generic-node-server is only selected by --adapter.')
  },
  // inferDefaults 메서드는 수동 node-server 어댑터에 필요한 기본 경로 값을 준비한다.
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
  // resolveBuildCommand 메서드는 선택된 build script의 실제 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}
