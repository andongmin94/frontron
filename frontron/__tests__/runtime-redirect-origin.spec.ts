import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { expect, test, vi } from 'vitest'
import { renderCreateFrontronElectronFile } from '../src/init/runtime/create-frontron-template'

type State = { handler?: (request: Request) => Promise<Response> }
const runtimeGlobal = globalThis as typeof globalThis & { __frontronRedirectOrigin?: State }

const cases: Array<[string, string, string, string | null]> = [
  ['relative', 'http://127.0.0.1:4321', '/second?q=1#section', 'frontron://app/second?q=1#section'],
  ['exact origin', 'http://127.0.0.1:4321', 'http://127.0.0.1:4321/second', 'frontron://app/second'],
  ['Next localhost alias', 'http://127.0.0.1:4321', 'http://localhost:4321/second?q=1#s', 'frontron://app/second?q=1#s'],
  ['reverse alias', 'http://localhost:4321', 'http://127.0.0.1:4321/second', 'frontron://app/second'],
  ['scheme-relative alias', 'http://127.0.0.1:4321', '//LOCALHOST:4321/second', 'frontron://app/second'],
  ['different port', 'http://127.0.0.1:4321', 'http://localhost:4322/second', 'http://localhost:4322/second'],
  ['different scheme', 'http://127.0.0.1:4321', 'https://localhost:4321/second', 'https://localhost:4321/second'],
  ['other IPv4 loopback', 'http://127.0.0.1:4321', 'http://127.0.0.2:4321/second', 'http://127.0.0.2:4321/second'],
  ['IPv6 is not this listener', 'http://127.0.0.1:4321', 'http://[::1]:4321/second', 'http://[::1]:4321/second'],
  ['lookalike hostname', 'http://127.0.0.1:4321', 'http://localhost.example.invalid:4321/second', 'http://localhost.example.invalid:4321/second'],
  ['external origin', 'http://127.0.0.1:4321', 'https://example.invalid/second', 'https://example.invalid/second'],
  ['credentials', 'http://127.0.0.1:4321', 'http://user:secret@localhost:4321/second', 'http://user:secret@localhost:4321/second'],
  ['non-loopback target', 'http://example.invalid:4321', 'http://localhost:4321/second', 'http://localhost:4321/second'],
  ['invalid URL', 'http://127.0.0.1:4321', 'http://[invalid', null],
]

test.each(cases)('redirect boundary: %s', async (_label, target, location, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'frontron-redirect-origin-'))
  const state: State = {}
  runtimeGlobal.__frontronRedirectOrigin = state
  const upstream = vi.fn(async () => new Response(null, {
    status: 307,
    headers: { location, 'content-security-policy': "default-src 'self'; connect-src 'self'" },
  }))
  vi.stubGlobal('fetch', upstream)
  try {
    mkdirSync(join(root, 'node_modules/electron'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    writeFileSync(join(root, 'node_modules/electron/package.json'), '{"type":"module","exports":"./index.js"}\n')
    writeFileSync(join(root, 'node_modules/electron/index.js'), `
const state = globalThis.__frontronRedirectOrigin;
export const app = { requestSingleInstanceLock: () => false, quit() {} };
export const Menu = {};
export const protocol = {
  registerSchemesAsPrivileged() {},
  handle(_scheme, handler) { state.handler = handler; },
};
`)
    writeFileSync(join(root, 'dev.js'), 'export function setupDevMenu() {}\n')
    writeFileSync(join(root, 'ipc.js'), 'export function setupIpcHandlers() {}\n')
    writeFileSync(join(root, 'serve.js'), 'export function startRendererServer() {}\nexport function stopRendererServer() {}\n')
    writeFileSync(join(root, 'window.js'), 'export const mainWindow = null;\nexport function createWindow() {}\n')
    const compiled = ts.transpileModule(renderCreateFrontronElectronFile('main.ts'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    })
    expect(compiled.diagnostics).toEqual([])
    writeFileSync(join(root, 'main.js'), compiled.outputText)
    const runtime = await import(pathToFileURL(join(root, 'main.js')).href) as {
      registerRendererProtocol(url: string): Promise<void>
    }
    await runtime.registerRendererProtocol(target)
    const response = await state.handler!(new Request('frontron://app/redirect'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(expected)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'; connect-src 'self'")
    expect(upstream).toHaveBeenCalledOnce()
    expect(upstream).toHaveBeenCalledWith(`${target}/redirect`, expect.objectContaining({ redirect: 'manual' }))
  } finally {
    vi.unstubAllGlobals()
    delete runtimeGlobal.__frontronRedirectOrigin
    rmSync(root, { recursive: true, force: true })
  }
})
