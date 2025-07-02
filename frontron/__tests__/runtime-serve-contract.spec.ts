import { join } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, test } from 'vitest'

import { resolveDevServerUrl } from '../src/init/runtime/dev-server-url'
import { renderServeSource } from '../src/init/runtime/serve-source'
import { assembleServeSource } from '../src/init/runtime/serve-source/assemble-source'
import { renderServeDevAndBuildSource } from '../src/init/runtime/serve-source/dev-build-source'
import { renderServeHeaderAndConfigSource } from '../src/init/runtime/serve-source/header-config-source'
import {
  renderChildProcessRuntimeSource,
  renderNodeServerRuntimeSource,
} from '../src/init/runtime/serve-source/node-process-runtime-source'
import { renderStaticServerSource } from '../src/init/runtime/serve-source/static-server-source'
import type { InitConfig } from '../src/init/shared'

type RuntimeVariant = Readonly<{
  name: string
  adapter: InitConfig['adapter']
  runtimeStrategy: InitConfig['runtimeStrategy']
  outDir: string
  nodeServerSourceRoot: string | null
  nodeServerEntry: string | null
}>

const runtimeVariants = [
  {
    name: 'static export',
    adapter: 'generic-static',
    runtimeStrategy: 'static-export',
    outDir: 'dist-web',
    nodeServerSourceRoot: null,
    nodeServerEntry: null,
  },
  {
    name: 'generic node server',
    adapter: 'generic-node-server',
    runtimeStrategy: 'node-server',
    outDir: '.frontron/runtime/node-server',
    nodeServerSourceRoot: 'build',
    nodeServerEntry: 'server/index.js',
  },
  {
    name: 'Remix node server',
    adapter: 'remix-node-server',
    runtimeStrategy: 'node-server',
    outDir: '.frontron/runtime/remix-node-server',
    nodeServerSourceRoot: 'build',
    nodeServerEntry: 'server.cjs',
  },
] as const satisfies readonly RuntimeVariant[]

// createRuntimeConfig 함수는 생성 런타임의 세 코드 경로를 검증할 최소 설정을 만든다.
function createRuntimeConfig(variant: RuntimeVariant): InitConfig {
  return {
    cwd: process.cwd(),
    packageJson: { name: 'runtime-contract-test' },
    packageManager: 'npm',
    adapter: variant.adapter,
    adapterConfidence: 'high',
    adapterReasons: [],
    runtimeStrategy: variant.runtimeStrategy,
    desktopDir: 'electron',
    appScript: 'frontron:dev',
    buildScript: 'frontron:build',
    packageScript: 'frontron:package',
    webDevScript: 'dev',
    webBuildScript: 'build',
    webBuildCommand: 'npm run build',
    outDir: variant.outDir,
    nodeServerSourceRoot: variant.nodeServerSourceRoot,
    nodeServerEntry: variant.nodeServerEntry,
    nodeServerCopyTargets:
      variant.runtimeStrategy === 'node-server' ? [{ from: 'public', to: 'public' }] : [],
    productName: 'Runtime Contract Test',
    appId: 'com.local.runtime-contract-test',
    templateInfo: {
      source: 'create-frontron',
      packageName: 'create-frontron',
      packageVersion: '0.0.0-test',
      resolvedFrom: 'repo',
    },
    allowExtraMetadataMainOverride: false,
  }
}

// normalizeCompilerPath 함수는 TypeScript가 Windows 구분자를 바꿔도 가상 파일을 식별하게 한다.
function normalizeCompilerPath(fileName: string) {
  const normalized = fileName.replaceAll('\\', '/')

  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase()
}

// collectSemanticDiagnostics 함수는 문자열 생성 결과를 실제 파일처럼 strict TypeScript로 검사한다.
function collectSemanticDiagnostics(source: string) {
  const virtualFileName = join(process.cwd(), '.frontron-contract', 'electron', 'serve.ts')
  const normalizedVirtualFileName = normalizeCompilerPath(virtualFileName)
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
    types: ['node'],
    typeRoots: [join(process.cwd(), 'node_modules', '@types')],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
  }
  const host = ts.createCompilerHost(compilerOptions)
  const originalFileExists = host.fileExists.bind(host)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const isVirtualFile = (fileName: string) =>
    normalizeCompilerPath(fileName) === normalizedVirtualFileName

  host.fileExists = (fileName) => isVirtualFile(fileName) || originalFileExists(fileName)
  host.readFile = (fileName) => (isVirtualFile(fileName) ? source : originalReadFile(fileName))
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    isVirtualFile(fileName)
      ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)

  const program = ts.createProgram([virtualFileName], compilerOptions, host)

  return ts.getPreEmitDiagnostics(program)
}

// formatDiagnostics 함수는 실패 시 생성 런타임의 정확한 파일 위치와 원인을 보여준다.
function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  }

  return ts.formatDiagnostics(diagnostics, formatHost)
}

describe('generated serve runtime TypeScript contract', () => {
  test.each(runtimeVariants)('$name output passes strict semantic type-checking', (variant) => {
    const config = createRuntimeConfig(variant)
    const source = renderServeSource(config)
    const diagnostics = collectSemanticDiagnostics(source)

    expect(formatDiagnostics(diagnostics)).toBe('')

    const expectedSource = [
      renderServeHeaderAndConfigSource(config, resolveDevServerUrl(config)),
      renderChildProcessRuntimeSource(),
      variant.runtimeStrategy === 'node-server'
        ? renderNodeServerRuntimeSource()
        : renderStaticServerSource(),
      renderServeDevAndBuildSource(config),
    ].join('\n\n')

    expect(source).toBe(`${expectedSource}\n`)
  })

  test('assembler rejects a missing required runtime section', () => {
    expect(() =>
      assembleServeSource({
        headerAndConfig: 'const header = true',
        childProcessRuntime: 'const processRuntime = true',
        rendererRuntime: '   ',
        devAndBuild: 'const devAndBuild = true',
      }),
    ).toThrow('Generated serve source section "rendererRuntime" must not be empty.')
  })
})
