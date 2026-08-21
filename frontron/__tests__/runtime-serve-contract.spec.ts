import { join } from 'node:path'

import * as ts from 'typescript'
import { describe, expect, test } from 'vitest'

import { renderCreateFrontronElectronFile } from '../src/init/runtime/create-frontron-template'
import { renderServeSource } from '../src/init/runtime/serve-source'
import type { InitConfig } from '../src/init/shared'

type Variant = Pick<
  InitConfig,
  | 'adapter'
  | 'runtimeStrategy'
  | 'outDir'
  | 'nodeServerSourceRoot'
  | 'nodeServerSourceEntry'
  | 'nodeServerEntry'
  | 'nodeServerCopyTargets'
>

const variants: Array<{ name: string; config: Variant }> = [
  {
    name: 'static export',
    config: {
      adapter: 'generic-static',
      runtimeStrategy: 'static-export',
      outDir: 'dist-web',
      nodeServerSourceRoot: null,
      nodeServerSourceEntry: null,
      nodeServerEntry: null,
      nodeServerCopyTargets: [],
    },
  },
  {
    name: 'generic node server',
    config: {
      adapter: 'generic-node-server',
      runtimeStrategy: 'node-server',
      outDir: '.frontron/runtime/node-server',
      nodeServerSourceRoot: 'build',
      nodeServerSourceEntry: null,
      nodeServerEntry: 'server/index.js',
      nodeServerCopyTargets: [{ from: 'public', to: 'public' }],
    },
  },
  {
    name: 'Remix node server',
    config: {
      adapter: 'remix-node-server',
      runtimeStrategy: 'node-server',
      outDir: '.frontron/runtime/remix-node-server',
      nodeServerSourceRoot: 'build',
      nodeServerSourceEntry: 'server/index.js',
      nodeServerEntry: 'server.cjs',
      nodeServerCopyTargets: [],
    },
  },
]

function createConfig(variant: Variant): InitConfig {
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
    webDevScript: 'dev',
    webBuildScript: 'build',
    webBuildCommand: 'npm run build',
    outDir: variant.outDir,
    nodeServerSourceRoot: variant.nodeServerSourceRoot,
    nodeServerSourceEntry: variant.nodeServerSourceEntry,
    nodeServerEntry: variant.nodeServerEntry,
    nodeServerCopyTargets: variant.nodeServerCopyTargets,
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

function normalizePath(fileName: string) {
  const normalized = fileName.replaceAll('\\', '/')
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase()
}

function diagnosticsFor(source: string, includeStaticServer: boolean) {
  const virtualRoot = join(process.cwd(), '.frontron-contract', 'electron')
  const virtualFiles = new Map<string, string>([
    [join(virtualRoot, 'serve.ts'), source],
  ])
  if (includeStaticServer) {
    virtualFiles.set(
      join(virtualRoot, 'static-server.ts'),
      renderCreateFrontronElectronFile('static-server.ts'),
    )
  }
  const normalizedFiles = new Map(
    [...virtualFiles].map(([fileName, content]) => [normalizePath(fileName), content]),
  )
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
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  const virtualContent = (fileName: string) => normalizedFiles.get(normalizePath(fileName))

  host.fileExists = (fileName) => virtualContent(fileName) !== undefined || fileExists(fileName)
  host.readFile = (fileName) => virtualContent(fileName) ?? readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = virtualContent(fileName)
    return content !== undefined
      ? ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (moduleName === './static-server.js') {
        return {
          resolvedFileName: join(virtualRoot, 'static-server.ts'),
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        }
      }

      return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host)
        .resolvedModule
    })

  return ts.getPreEmitDiagnostics(
    ts.createProgram([...virtualFiles.keys()], compilerOptions, host),
  )
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  })
}

describe('generated serve runtime contract', () => {
  test.each(variants)('$name passes strict semantic type-checking', ({ config }) => {
    const source = renderServeSource(createConfig(config))
    const usesStaticServer = config.runtimeStrategy === 'static-export'

    expect(formatDiagnostics(diagnosticsFor(source, usesStaticServer))).toBe('')
    expect(source).toContain('waitForUrlReady')

    if (usesStaticServer) {
      expect(source).toContain('startStaticRendererServer')
      expect(source).not.toContain('startNodeServerRuntime')
    } else {
      expect(source).toContain('startNodeServerRuntime')
      expect(source).toContain('getAvailablePort')
      expect(source).not.toContain('static-server.js')
    }
  })
})
