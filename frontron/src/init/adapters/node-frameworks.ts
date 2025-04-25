import {
  type InitAdapter,
  DEFAULT_NUXT_NODE_SERVER_OUT_DIR,
  DEFAULT_REMIX_NODE_SERVER_OUT_DIR,
} from '../shared'
import {
  findScriptByCommand,
  hasNuxtConfig,
  hasPackageDependency,
  hasRemixConfig,
  inferScriptName,
} from '../detect'
import { resolveBuildCommandOrThrow } from './build-command'
import { detected, notDetected } from './detection-result'

export const nuxtNodeServerAdapter: InitAdapter = {
  id: 'nuxt-node-server',
  runtimeStrategy: 'node-server',
  // detect 메서드는 Nuxt 의존성이나 설정 파일을 보고 Nuxt node-server 프로젝트인지 판단한다.
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
  // inferDefaults 메서드는 Nuxt build 결과의 서버 런타임 위치와 entry를 기본값으로 잡는다.
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnuxt\s+dev\b/i) ?? inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bnuxt\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_NUXT_NODE_SERVER_OUT_DIR,
      nodeServerSourceRoot: '.output',
      nodeServerEntry: 'server/index.mjs',
      nodeServerCopyTargets: [],
    }
  },
  // resolveBuildCommand 메서드는 선택된 Nuxt build script의 실제 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}

export const remixNodeServerAdapter: InitAdapter = {
  id: 'remix-node-server',
  runtimeStrategy: 'node-server',
  // detect 메서드는 Remix 의존성이나 설정 파일을 보고 Remix node-server 프로젝트인지 판단한다.
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
  // inferDefaults 메서드는 Remix 서버 빌드 결과와 public 복사 대상을 기본값으로 준비한다.
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bremix\s+dev\b/i) ?? inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bremix\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_REMIX_NODE_SERVER_OUT_DIR,
      nodeServerSourceRoot: 'build',
      nodeServerEntry: 'server.cjs',
      nodeServerCopyTargets: [{ from: 'public', to: 'public' }],
    }
  },
  // resolveBuildCommand 메서드는 선택된 Remix build script의 실제 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}
