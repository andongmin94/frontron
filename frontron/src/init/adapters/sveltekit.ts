import {
  type InitAdapter,
  DEFAULT_SVELTEKIT_NODE_OUT_DIR,
  DEFAULT_SVELTEKIT_STATIC_OUT_DIR,
} from '../shared'
import {
  findScriptByCommand,
  hasPackageDependency,
  hasSvelteKitAdapterConfig,
  inferOutDir,
  inferOutDirFromScript,
  inferScriptName,
} from '../detect'
import { resolveBuildCommandOrThrow } from './build-command'
import { detected, notDetected } from './detection-result'

export const svelteKitStaticAdapter: InitAdapter = {
  id: 'sveltekit-static',
  runtimeStrategy: 'static-export',
  // detect 메서드는 SvelteKit static adapter 신호가 있는지 확인한다.
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
  // inferDefaults 메서드는 SvelteKit static 빌드에 필요한 script와 출력 폴더를 추론한다.
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
  // resolveBuildCommand 메서드는 선택된 SvelteKit static build script의 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}

export const svelteKitNodeAdapter: InitAdapter = {
  id: 'sveltekit-node',
  runtimeStrategy: 'node-server',
  // detect 메서드는 SvelteKit node adapter 신호가 있는지 확인한다.
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
  // inferDefaults 메서드는 SvelteKit node 런타임의 출력 폴더와 entry를 기본값으로 준비한다.
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
  // resolveBuildCommand 메서드는 선택된 SvelteKit node build script의 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}
