import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { renderCreateFrontronElectronFile } from '../src/init/runtime/create-frontron-template'

type Handler = (request: Request) => Promise<Response>
type State = { handler?: Handler; fetch(input: string, init?: RequestInit): Promise<Response> }
const runtimeGlobal = globalThis as typeof globalThis & { __frontronRequestContract?: State }

test.each(['POST', 'PUT', 'PATCH', 'GET', 'HEAD'])(
  'forwards %s through the real Request stream constructor',
  async (method) => {
    const root = mkdtempSync(join(tmpdir(), 'frontron-request-stream-'))
    const bytes = new Uint8Array([0, 255, 128, 42, 10])
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const abort = new AbortController()
    let forwarded: Request | undefined
    const state: State = {
      async fetch(input, init) {
        // Electron's net.fetch constructs Request. A Response-only mock does
        // not check the duplex requirement and incorrectly accepts bad uploads.
        forwarded = new Request(input, init)
        expect(forwarded.method).toBe(method)
        expect(forwarded.url).toBe('http://127.0.0.1:4321/api/binary?part=1')
        expect(forwarded.redirect).toBe('manual')
        expect(forwarded.headers.get('origin')).toBe('http://127.0.0.1:4321')
        expect(forwarded.headers.get('referer')).toBe('http://127.0.0.1:4321/form?q=1')
        expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(
          hasBody ? bytes : new Uint8Array(),
        )
        return new Response(null, { status: 204 })
      },
    }
    runtimeGlobal.__frontronRequestContract = state
    try {
      mkdirSync(join(root, 'node_modules', 'electron'), { recursive: true })
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
      writeFileSync(join(root, 'node_modules/electron/package.json'),
        '{"type":"module","exports":"./index.js"}\n')
      writeFileSync(join(root, 'node_modules/electron/index.js'), `
const state = globalThis.__frontronRequestContract;
export const app = { requestSingleInstanceLock: () => false, quit() {} };
export const Menu = {};
export const net = { fetch: (input, init) => state.fetch(input, init) };
export const protocol = {
  registerSchemesAsPrivileged() {},
  handle(_scheme, handler) { state.handler = handler; },
};
`)
      writeFileSync(join(root, 'dev.js'), 'export function setupDevMenu() {}\n')
      writeFileSync(join(root, 'ipc.js'), 'export function setupIpcHandlers() {}\n')
      writeFileSync(join(root, 'serve.js'),
        'export function startRendererServer() {}\nexport function stopRendererServer() {}\n')
      writeFileSync(join(root, 'window.js'),
        'export const mainWindow = null;\nexport function createWindow() {}\n')
      const compiled = ts.transpileModule(renderCreateFrontronElectronFile('main.ts'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      })
      expect(compiled.diagnostics).toEqual([])
      writeFileSync(join(root, 'main.js'), compiled.outputText)
      const runtime = await import(pathToFileURL(join(root, 'main.js')).href) as {
        registerRendererProtocol(url: string): Promise<void>
      }
      await runtime.registerRendererProtocol('http://127.0.0.1:4321')
      const response = await state.handler!(new Request('frontron://app/api/binary?part=1', {
        method, body: hasBody ? bytes : undefined, signal: abort.signal,
        headers: { origin: 'frontron://app', referer: 'frontron://app/form?q=1' },
      }))
      expect(response.status).toBe(204)
      expect(forwarded).toBeDefined()
      abort.abort()
      expect(forwarded?.signal.aborted).toBe(true)
    } finally {
      delete runtimeGlobal.__frontronRequestContract
      rmSync(root, { recursive: true, force: true })
    }
  },
)
