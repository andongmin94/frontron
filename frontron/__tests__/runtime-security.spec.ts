import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderMainSource, renderWindowSource } from '../src/init/runtime/renderers'
import type { InitPreset } from '../src/init/shared'

type ProtocolHandler = (request: Request) => Promise<Response>
type NavigationHandler = (details: {
  url: string
  isMainFrame: boolean
  preventDefault(): void
}) => void
type WindowOpenHandler = (details: { url: string }) => { action: string }
type ElectronMockState = {
  schemes?: Array<{
    scheme: string
    privileges: Record<string, boolean>
  }>
  protocolHandler?: ProtocolHandler
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  externalUrls: string[]
  webContentsHandlers: Map<string, unknown>
  windowOpenHandler?: WindowOpenHandler
  loadedUrls: string[]
}

type MainRuntimeModule = {
  rendererOrigin: string
  registerRendererProtocol(rendererTargetUrl: string): Promise<void>
}

type WindowRuntimeModule = {
  createMainWindow?: (rendererUrl: string) => unknown
  createWindow?: (rendererUrl: string) => unknown
}

const tempDirs: string[] = []
const mockGlobal = globalThis as typeof globalThis & {
  __frontronElectronMock?: ElectronMockState
}

const electronStubSource = `const state = globalThis.__frontronElectronMock

export const app = {
  dock: undefined,
  on() {},
  quit() {},
  requestSingleInstanceLock() { return false },
  whenReady() { return Promise.resolve() },
}

export const Menu = {
  setApplicationMenu() {},
}

export const net = {
  fetch(input, init) { return state.fetch(input, init) },
}

export const protocol = {
  registerSchemesAsPrivileged(schemes) { state.schemes = schemes },
  async handle(_scheme, handler) { state.protocolHandler = handler },
}

export const shell = {
  openExternal(url) {
    state.externalUrls.push(url)
    return Promise.resolve()
  },
}

class MockWebContents {
  on(eventName, handler) {
    state.webContentsHandlers.set(eventName, handler)
    return this
  }

  setWindowOpenHandler(handler) {
    state.windowOpenHandler = handler
  }

  executeJavaScript() { return Promise.resolve(true) }
  toggleDevTools() {}
}

export class BrowserWindow {
  webContents = new MockWebContents()

  constructor() {}
  focus() {}
  hide() {}
  isMinimized() { return false }
  loadURL(url) {
    state.loadedUrls.push(url)
    return Promise.resolve()
  }
  on() { return this }
  once() { return this }
  reload() {}
  restore() {}
  show() {}
}
`

// createElectronMockState 함수는 프로토콜과 창 이벤트를 기록할 Electron mock 상태를 만든다.
function createElectronMockState(): ElectronMockState {
  return {
    fetch: async () => new Response('ok'),
    externalUrls: [],
    webContentsHandlers: new Map(),
    loadedUrls: [],
  }
}

// writeElectronStub 함수는 생성 소스를 Node에서 불러올 수 있는 Electron ESM stub을 만든다.
function writeElectronStub(projectRoot: string) {
  const electronModuleDir = join(projectRoot, 'node_modules', 'electron')

  mkdirSync(electronModuleDir, { recursive: true })
  writeFileSync(
    join(electronModuleDir, 'package.json'),
    '{"name":"electron","type":"module","exports":"./index.js"}\n',
    'utf8',
  )
  writeFileSync(join(electronModuleDir, 'index.js'), electronStubSource, 'utf8')
}

// transpileRuntimeSource 함수는 생성된 Electron TypeScript 소스를 실행 가능한 ESM으로 바꾼다.
function transpileRuntimeSource(source: string, fileName: string) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  })

  expect(
    (transpiled.diagnostics ?? []).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ),
  ).toEqual([])

  return transpiled.outputText
}

// createRuntimeProject 함수는 생성 소스와 sibling module stub을 담을 임시 ESM 프로젝트를 만든다.
function createRuntimeProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-security-'))
  const electronDir = join(projectRoot, 'electron')

  tempDirs.push(projectRoot)
  mkdirSync(electronDir, { recursive: true })
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}\n', 'utf8')
  writeElectronStub(projectRoot)

  return { projectRoot, electronDir }
}

// importMainRuntime 함수는 preset별 main.ts를 protocol 테스트용 sibling stub과 함께 불러온다.
async function importMainRuntime(preset: InitPreset) {
  const { electronDir } = createRuntimeProject()
  const mainPath = join(electronDir, 'main.js')

  writeFileSync(
    join(electronDir, 'window.js'),
    `export const mainWindow = null
export function createMainWindow() {}
export function createWindow() {}
export function getMainWindow() { return null }
`,
    'utf8',
  )
  writeFileSync(
    join(electronDir, 'serve.js'),
    `export async function inferDevUrl() { return 'http://localhost:5173' }
export async function startRendererRuntime() { return 'http://127.0.0.1:4321' }
export async function startRendererServer() { return 'http://127.0.0.1:4321' }
export async function stopRendererRuntime() {}
export async function stopRendererServer() {}
export async function waitForUrlReady(url) { return url }
`,
    'utf8',
  )
  writeFileSync(join(electronDir, 'dev.js'), 'export function setupDevMenu() {}\n', 'utf8')
  writeFileSync(join(electronDir, 'ipc.js'), 'export function setupIpcHandlers() {}\n', 'utf8')
  writeFileSync(
    join(electronDir, 'splash.js'),
    'export function closeSplash() {}\nexport function createSplash() {}\n',
    'utf8',
  )
  writeFileSync(
    join(electronDir, 'tray.js'),
    'export function createTray() {}\nexport function destroyTray() {}\n',
    'utf8',
  )
  writeFileSync(mainPath, transpileRuntimeSource(renderMainSource(preset), 'main.ts'), 'utf8')

  return (await import(
    `${pathToFileURL(mainPath).href}?test=${Date.now()}-${Math.random()}`
  )) as MainRuntimeModule
}

// importWindowRuntime 함수는 preset별 window.ts를 Electron 창 mock과 함께 불러온다.
async function importWindowRuntime(preset: InitPreset) {
  const { electronDir } = createRuntimeProject()
  const windowPath = join(electronDir, 'window.js')

  writeFileSync(join(electronDir, 'preload.js'), '', 'utf8')
  writeFileSync(
    join(electronDir, 'main.js'),
    `export const __dirname = ${JSON.stringify(electronDir)}
export const isDev = false
export const isQuitting = false
`,
    'utf8',
  )
  writeFileSync(join(electronDir, 'splash.js'), 'export function closeSplash() {}\n', 'utf8')
  writeFileSync(windowPath, transpileRuntimeSource(renderWindowSource(preset), 'window.ts'), 'utf8')

  return (await import(
    `${pathToFileURL(windowPath).href}?test=${Date.now()}-${Math.random()}`
  )) as WindowRuntimeModule
}

afterEach(() => {
  delete mockGlobal.__frontronElectronMock

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe.each<InitPreset>(['minimal', 'starter-like'])('%s runtime security', (preset) => {
  test('uses a secure stable protocol and preserves proxy request and response semantics', async () => {
    const state = createElectronMockState()
    let capturedRequest: {
      url: string
      method?: string
      body: string
      token: string | null
      origin: string | null
      referer: string | null
    } | null = null

    state.fetch = async (input, init) => {
      capturedRequest = {
        url: input,
        method: init?.method,
        body: init?.body ? await new Response(init.body).text() : '',
        token: new Headers(init?.headers).get('x-token'),
        origin: new Headers(init?.headers).get('origin'),
        referer: new Headers(init?.headers).get('referer'),
      }

      return new Response('proxied', {
        status: 201,
        headers: {
          'content-security-policy': "default-src 'self'; script-src 'self'",
          'x-upstream': 'yes',
        },
      })
    }
    mockGlobal.__frontronElectronMock = state

    const runtime = await importMainRuntime(preset)
    await runtime.registerRendererProtocol('http://127.0.0.1:4321')

    const handler = state.protocolHandler
    expect(handler).toBeTypeOf('function')

    const response = await handler!(
      new Request('frontron://app/api/items?filter=active', {
        method: 'POST',
        headers: {
          'x-token': 'runtime-token',
          origin: 'frontron://app',
          referer: 'frontron://app/account?tab=security',
        },
        body: 'request-body',
      }),
    )

    expect(runtime.rendererOrigin).toBe('frontron://app')
    expect(state.schemes?.[0]).toMatchObject({
      scheme: 'frontron',
      privileges: {
        standard: true,
        secure: true,
        allowServiceWorkers: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    })
    expect(state.schemes?.[0]?.privileges).not.toHaveProperty('bypassCSP')
    expect(capturedRequest).toEqual({
      url: 'http://127.0.0.1:4321/api/items?filter=active',
      method: 'POST',
      body: 'request-body',
      token: 'runtime-token',
      origin: 'http://127.0.0.1:4321',
      referer: 'http://127.0.0.1:4321/account?tab=security',
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'",
    )
    expect(await response.text()).toBe('proxied')

    let doubleSlashProxyUrl: string | null = null
    state.fetch = async (input) => {
      doubleSlashProxyUrl = input
      return new Response('same-origin')
    }

    const fallbackCspResponse = await handler!(
      new Request('frontron://app//evil.example/collect?token=secret'),
    )
    expect(doubleSlashProxyUrl).not.toBeNull()
    expect(new URL(doubleSlashProxyUrl!).origin).toBe('http://127.0.0.1:4321')
    expect(new URL(doubleSlashProxyUrl!).pathname).toBe('//evil.example/collect')
    expect(fallbackCspResponse.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    )

    const rejectedResponse = await handler!(new Request('frontron://other/private'))
    expect(rejectedResponse.status).toBe(404)

    state.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: '/login?next=%2Fdesktop' },
      })

    const redirectResponse = await handler!(new Request('frontron://app/account'))
    expect(redirectResponse.headers.get('location')).toBe('frontron://app/login?next=%2Fdesktop')
  })

  test('blocks non-renderer navigation and opens only external HTTP URLs', async () => {
    const state = createElectronMockState()
    mockGlobal.__frontronElectronMock = state

    const runtime = await importWindowRuntime(preset)
    const createWindow = runtime.createMainWindow ?? runtime.createWindow

    expect(createWindow).toBeTypeOf('function')
    createWindow!('frontron://app/')

    const navigate = state.webContentsHandlers.get('will-frame-navigate') as NavigationHandler
    const redirect = state.webContentsHandlers.get('will-redirect') as NavigationHandler
    const internalDetails = {
      url: 'frontron://app/settings',
      isMainFrame: true,
      preventDefault: vi.fn(),
    }
    const externalDetails = {
      url: 'https://example.com/docs',
      isMainFrame: true,
      preventDefault: vi.fn(),
    }
    const subframeDetails = {
      url: 'https://example.com/embed',
      isMainFrame: false,
      preventDefault: vi.fn(),
    }

    navigate(internalDetails)
    navigate(externalDetails)
    navigate(subframeDetails)

    expect(internalDetails.preventDefault).not.toHaveBeenCalled()
    expect(externalDetails.preventDefault).toHaveBeenCalledOnce()
    expect(subframeDetails.preventDefault).toHaveBeenCalledOnce()
    expect(state.externalUrls).toEqual(['https://example.com/docs'])

    const unsafeDetails = {
      url: 'file:///private.txt',
      isMainFrame: true,
      preventDefault: vi.fn(),
    }
    const otherOriginDetails = {
      url: 'frontron://other/private',
      isMainFrame: true,
      preventDefault: vi.fn(),
    }
    navigate(unsafeDetails)
    navigate(otherOriginDetails)

    expect(unsafeDetails.preventDefault).toHaveBeenCalledOnce()
    expect(otherOriginDetails.preventDefault).toHaveBeenCalledOnce()
    expect(state.externalUrls).toEqual(['https://example.com/docs'])

    redirect({
      url: 'https://example.com/redirect',
      isMainFrame: true,
      preventDefault: vi.fn(),
    })
    expect(state.externalUrls).toContain('https://example.com/redirect')

    expect(state.windowOpenHandler?.({ url: 'frontron://app/popup' })).toEqual({ action: 'deny' })
    expect(state.windowOpenHandler?.({ url: 'https://example.com/new' })).toEqual({
      action: 'deny',
    })
    expect(state.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(state.externalUrls).toContain('https://example.com/new')
    expect(state.externalUrls).not.toContain('javascript:alert(1)')
  })
})
