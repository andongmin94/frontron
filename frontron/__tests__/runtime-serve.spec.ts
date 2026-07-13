import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { afterEach, describe, expect, test } from 'vitest'

import { renderServeSource } from '../src/init/runtime/serve-source'
import type { InitConfig } from '../src/init/shared'

type RuntimeModule = {
  startRendererRuntime(): Promise<string>
  stopRendererRuntime(): Promise<void>
}

type RuntimeResponse = {
  statusCode: number
  headers: IncomingHttpHeaders
  body: string
}

const tempDirs: string[] = []
const stopRuntimeCallbacks: Array<() => Promise<void>> = []

// createStaticConfig 함수는 테스트용 static-export 생성 설정을 만든다.
function createStaticConfig(cwd: string): InitConfig {
  return {
    cwd,
    packageJson: { name: 'runtime-test' },
    packageManager: 'npm',
    adapter: 'generic-static',
    adapterConfidence: 'high',
    adapterReasons: [],
    runtimeStrategy: 'static-export',
    desktopDir: 'electron',
    appScript: 'frontron:dev',
    buildScript: 'frontron:build',
    packageScript: 'frontron:package',
    webDevScript: 'dev',
    webBuildScript: 'build',
    webBuildCommand: 'npm run build',
    outDir: 'dist-web',
    nodeServerSourceRoot: null,
    nodeServerEntry: null,
    nodeServerCopyTargets: [],
    productName: 'Runtime Test',
    appId: 'com.local.runtime-test',
    preset: 'minimal',
    templateInfo: { source: 'frontron:minimal' },
    allowExtraMetadataMainOverride: false,
  }
}

// createNodeConfig 함수는 일반 Node 또는 Remix 런타임 생성 설정을 만든다.
function createNodeConfig(
  cwd: string,
  adapter: 'generic-node-server' | 'remix-node-server' = 'generic-node-server',
): InitConfig {
  const usesRemixRuntime = adapter === 'remix-node-server'

  return {
    ...createStaticConfig(cwd),
    adapter,
    runtimeStrategy: 'node-server',
    outDir: usesRemixRuntime
      ? '.frontron/runtime/remix-node-server'
      : '.frontron/runtime/node-server',
    nodeServerSourceRoot: 'build',
    nodeServerEntry: usesRemixRuntime ? 'server.cjs' : 'server/index.js',
    nodeServerCopyTargets: [{ from: 'public', to: 'public' }],
  }
}

// expectSourceToTranspile 함수는 생성된 TypeScript에 문법 진단이 없는지 확인한다.
function expectSourceToTranspile(source: string) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'serve.ts',
    reportDiagnostics: true,
  })

  expect(
    (result.diagnostics ?? []).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ),
  ).toEqual([])
}

// createStaticRuntime 함수는 생성된 serve.ts를 컴파일해 실제 HTTP 런타임을 준비한다.
async function createStaticRuntime() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-runtime-'))
  const distElectronDir = join(projectRoot, 'dist-electron')
  const distWebDir = join(projectRoot, 'dist-web')

  tempDirs.push(projectRoot)
  mkdirSync(distElectronDir, { recursive: true })
  mkdirSync(join(distWebDir, 'folder'), { recursive: true })
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}\n', 'utf8')
  writeFileSync(join(distWebDir, 'index.html'), '<h1>runtime index</h1>', 'utf8')
  writeFileSync(join(distWebDir, 'asset.txt'), '0123456789', 'utf8')

  const transpiled = ts.transpileModule(renderServeSource(createStaticConfig(projectRoot)), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'serve.ts',
    reportDiagnostics: true,
  })
  const diagnostics = transpiled.diagnostics ?? []

  expect(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])

  const servePath = join(distElectronDir, 'serve.js')
  writeFileSync(servePath, transpiled.outputText, 'utf8')

  const runtime = (await import(
    `${pathToFileURL(servePath).href}?test=${Date.now()}-${Math.random()}`
  )) as RuntimeModule
  const rendererUrl = await runtime.startRendererRuntime()

  stopRuntimeCallbacks.push(() => runtime.stopRendererRuntime())

  return { projectRoot, distWebDir, rendererUrl }
}

// requestRuntime 함수는 URL 정규화를 거치지 않은 경로로 생성 서버에 요청한다.
function requestRuntime(
  rendererUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
) {
  const url = new URL(rendererUrl)

  return new Promise<RuntimeResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    request.once('error', reject)
    request.end()
  })
}

afterEach(async () => {
  await Promise.allSettled(stopRuntimeCallbacks.splice(0).map((stopRuntime) => stopRuntime()))

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('generated renderer runtime source selection', () => {
  test('static strategy excludes Node and Remix production code', () => {
    const source = renderServeSource(createStaticConfig('C:/runtime-test'))

    expectSourceToTranspile(source)
    expect(source).toContain('function startStaticServer')
    expect(source).toContain('function prepareStaticBuild')
    expect(source).not.toContain('function startNodeServerRuntime')
    expect(source).not.toContain('NODE_SERVER_ENTRY')
    expect(source).not.toContain('RemixBundleMetafile')
    expect(source).not.toContain("require.resolve('@remix-run/serve/package.json')")
  })

  test('generic Node strategy excludes static and Remix production code', () => {
    const source = renderServeSource(createNodeConfig('C:/runtime-test'))

    expectSourceToTranspile(source)
    expect(source).toContain('function startNodeServerRuntime')
    expect(source).toContain('function prepareNodeServerBuild')
    expect(source).not.toContain('function startStaticServer')
    expect(source).not.toContain('function parseByteRange')
    expect(source).not.toContain('RemixBundleMetafile')
    expect(source).not.toContain("require.resolve('@remix-run/serve/package.json')")
  })

  test('Remix Node strategy includes Remix preparation without static code or runtime branches', () => {
    const source = renderServeSource(createNodeConfig('C:/runtime-test', 'remix-node-server'))

    expectSourceToTranspile(source)
    expect(source).toContain('function startNodeServerRuntime')
    expect(source).toContain('function stageRemixRuntimeDependencies')
    expect(source).toContain("require.resolve('@remix-run/serve/package.json')")
    expect(source).toContain('THIRD_PARTY_LICENSES.json')
    expect(source).not.toContain('function startStaticServer')
    expect(source).not.toContain("ADAPTER === 'remix-node-server'")
    expect(source).not.toContain("RUNTIME_STRATEGY === 'node-server'")
  })
})

describe('generated static renderer runtime', () => {
  test('serves query paths, HEAD, and byte ranges with correct metadata', async () => {
    const { rendererUrl } = await createStaticRuntime()

    const fullResponse = await requestRuntime(rendererUrl, '/asset.txt?cache=1')
    const headResponse = await requestRuntime(rendererUrl, '/asset.txt', { method: 'HEAD' })
    const rangeResponse = await requestRuntime(rendererUrl, '/asset.txt', {
      headers: { Range: 'bytes=2-5' },
    })
    const invalidRangeResponse = await requestRuntime(rendererUrl, '/asset.txt', {
      headers: { Range: 'bytes=20-30' },
    })

    expect(fullResponse).toMatchObject({ statusCode: 200, body: '0123456789' })
    expect(fullResponse.headers['accept-ranges']).toBe('bytes')
    expect(fullResponse.headers['content-length']).toBe('10')
    expect(headResponse).toMatchObject({ statusCode: 200, body: '' })
    expect(headResponse.headers['content-length']).toBe('10')
    expect(rangeResponse).toMatchObject({ statusCode: 206, body: '2345' })
    expect(rangeResponse.headers['content-range']).toBe('bytes 2-5/10')
    expect(rangeResponse.headers['content-length']).toBe('4')
    expect(invalidRangeResponse.statusCode).toBe(416)
    expect(invalidRangeResponse.headers['content-range']).toBe('bytes */10')
  })

  test('handles directories, malformed paths, and unsupported methods without stream failures', async () => {
    const { rendererUrl } = await createStaticRuntime()

    const directoryResponse = await requestRuntime(rendererUrl, '/folder/')
    const malformedResponse = await requestRuntime(rendererUrl, '/%E0%A4%A')
    const missingResponse = await requestRuntime(rendererUrl, '/missing.js')
    const methodResponse = await requestRuntime(rendererUrl, '/', { method: 'POST' })

    expect(directoryResponse).toMatchObject({ statusCode: 200, body: '<h1>runtime index</h1>' })
    expect(malformedResponse.statusCode).toBe(400)
    expect(missingResponse.statusCode).toBe(404)
    expect(methodResponse.statusCode).toBe(405)
    expect(methodResponse.headers.allow).toBe('GET, HEAD')
  })

  test('blocks encoded traversal, Windows separator traversal, and escaping symlinks', async () => {
    const { projectRoot, distWebDir, rendererUrl } = await createStaticRuntime()
    const outsideDir = join(projectRoot, 'outside')

    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret', 'utf8')
    symlinkSync(
      outsideDir,
      join(distWebDir, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const traversalResponse = await requestRuntime(rendererUrl, '/..%2foutside%2fsecret.txt')
    const separatorResponse = await requestRuntime(rendererUrl, '/%5c..%5coutside%5csecret.txt')
    const symlinkResponse = await requestRuntime(rendererUrl, '/linked/secret.txt')

    expect(traversalResponse.statusCode).toBe(403)
    expect(separatorResponse.statusCode).toBe(403)
    expect(symlinkResponse.statusCode).toBe(403)
  })
})
