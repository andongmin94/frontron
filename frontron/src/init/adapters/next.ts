import { type InitAdapter, DEFAULT_NEXT_STANDALONE_OUT_DIR } from '../shared'
import {
  findScriptByCommand,
  hasNextConfigOutput,
  hasPackageDependency,
  inferNextExportOutDirFromScript,
  inferOutDirFromScript,
  inferScriptName,
} from '../detect'
import { resolveBuildCommandOrThrow, resolveNextExportBuildCommand } from './build-command'
import { detected, notDetected } from './detection-result'

export const nextExportAdapter: InitAdapter = {
  id: 'next-export',
  runtimeStrategy: 'static-export',
  // detect 메서드는 Next static export 프로젝트인지 의존성과 설정 파일로 판단한다.
  detect(cwd, packageJson) {
    if (!hasPackageDependency(packageJson, 'next')) {
      return notDetected('next dependency was not found.')
    }

    if (hasNextConfigOutput(cwd, 'export')) {
      return detected('high', ['next dependency found.', 'next config declares output: export.'])
    }

    if (findScriptByCommand(packageJson, /\bnext\s+export\b/i) !== null) {
      return detected('medium', [
        'next dependency found.',
        'package.json has a next export script.',
      ])
    }

    return notDetected('next dependency found, but no static export signal was found.')
  },
  // inferDefaults 메서드는 Next export에 맞는 dev/build script와 출력 폴더를 추론한다.
  inferDefaults(_cwd, packageJson) {
    const webBuildScript =
      findScriptByCommand(packageJson, /\bnext\s+export\b/i) ??
      findScriptByCommand(packageJson, /\bnext\s+build\b/i) ??
      inferScriptName(packageJson, 'build')

    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnext\s+dev\b/i) ?? inferScriptName(packageJson, 'dev'),
      webBuildScript,
      outDir:
        inferNextExportOutDirFromScript(packageJson, webBuildScript) ??
        inferOutDirFromScript(packageJson, webBuildScript) ??
        'out',
    }
  },
  // resolveBuildCommand 메서드는 Next build와 export가 필요한 경우 함께 실행되도록 명령을 만든다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveNextExportBuildCommand(packageJson, webBuildScript)
  },
}

export const nextStandaloneAdapter: InitAdapter = {
  id: 'next-standalone',
  runtimeStrategy: 'node-server',
  // detect 메서드는 Next standalone 출력 모드 프로젝트인지 확인한다.
  detect(cwd, packageJson) {
    if (!hasPackageDependency(packageJson, 'next')) {
      return notDetected('next dependency was not found.')
    }

    if (!hasNextConfigOutput(cwd, 'standalone')) {
      return notDetected(
        'next dependency found, but next config does not declare output: standalone.',
      )
    }

    return detected('high', ['next dependency found.', 'next config declares output: standalone.'])
  },
  // inferDefaults 메서드는 Next standalone 런타임을 패키징할 기본 경로를 준비한다.
  inferDefaults(_cwd, packageJson) {
    return {
      webDevScript:
        findScriptByCommand(packageJson, /\bnext\s+dev\b/i) ?? inferScriptName(packageJson, 'dev'),
      webBuildScript:
        findScriptByCommand(packageJson, /\bnext\s+build\b/i) ??
        inferScriptName(packageJson, 'build'),
      outDir: DEFAULT_NEXT_STANDALONE_OUT_DIR,
      nodeServerSourceRoot: '.next/standalone',
      nodeServerEntry: 'server.js',
      // Next standalone은 static/public asset을 server.js 바깥에 두므로 별도 복사한다.
      nodeServerCopyTargets: [
        { from: '.next/static', to: '.next/static' },
        { from: 'public', to: 'public' },
      ],
    }
  },
  // resolveBuildCommand 메서드는 선택된 Next build script의 실제 실행 명령을 돌려준다.
  resolveBuildCommand(packageJson, webBuildScript) {
    return resolveBuildCommandOrThrow(packageJson, webBuildScript)
  },
}
